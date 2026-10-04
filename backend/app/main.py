import asyncio
import shutil
import struct
import time
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from . import audio, config, db
from .auth import current_user
from .engine import load_engine

state = {}


def _new_id() -> str:
    return uuid.uuid4().hex


def _voice_dir(voice_id):
    return config.VOICES_DIR / voice_id


def _generated(result_id):
    return config.GENERATED_DIR / f"{result_id}.wav"


def _now():
    return datetime.now(timezone.utc)


def _public(doc) -> dict:
    return {"id": doc["_id"], **{k: v for k, v in doc.items() if k != "_id"}}


def _size(path) -> int:
    return path.stat().st_size if path.exists() else 0


def _delete_jobs(query: dict) -> int:
    """Remove generation records together with their audio files."""
    for j in db.jobs.find(query, {"result_id": 1}):
        if j.get("result_id"):
            with suppress(OSError):  # a file still being streamed is left for cleanup_generated
                _generated(j["result_id"]).unlink(missing_ok=True)
    return db.jobs.delete_many(query).deleted_count


async def worker():
    """Single GPU worker: jobs run one at a time so requests never collide on the card."""
    loop = asyncio.get_running_loop()
    while True:
        job_id = await state["queue"].get()
        try:
            job = await asyncio.to_thread(db.jobs.find_one_and_update, {"_id": job_id}, {"$set": {"status": "running"}})
            if job is None:  # cancelled, or its voice was deleted, while queued
                continue
            emb = _voice_dir(job["voice_id"]) / "embedding.pt"
            t0 = time.perf_counter()
            wav = await loop.run_in_executor(None, state["engine"].synthesize, job["text"], job["language"], emb)
            result_id = _new_id()
            audio.write_wav(_generated(result_id), wav)
            print(f"[job {job_id[:8]}] {len(job['text'])} chars -> "
                  f"{len(wav) / config.SAMPLE_RATE:.1f}s audio in {time.perf_counter() - t0:.2f}s")
            res = await asyncio.to_thread(db.jobs.update_one, {"_id": job_id}, {"$set": {
                "status": "done", "result_id": result_id, "filename": f"{result_id}.wav",
                "audio_url": f"/audio/{result_id}", "duration": len(wav) / config.SAMPLE_RATE,
                "completed_at": _now()}})
            if res.matched_count == 0:  # cancelled while running: nobody is waiting for this audio
                _generated(result_id).unlink(missing_ok=True)
        except Exception as e:  # noqa: BLE001 - surface any failure on the job row
            msg = "GPU out of memory; try shorter text" if "out of memory" in str(e).lower() else str(e)
            await asyncio.to_thread(db.jobs.update_one, {"_id": job_id},
                                    {"$set": {"status": "failed", "error": msg, "completed_at": _now()}})
            state["engine"].free_cache()


def cleanup_generated():
    """Unsaved clips expire; clips saved to the library stay until the user deletes them."""
    cutoff = time.time() - config.GENERATED_TTL_HOURS * 3600
    saved = {j["result_id"] for j in db.jobs.find({"saved": {"$exists": True}}, {"result_id": 1})}
    for f in config.GENERATED_DIR.glob("*.wav"):
        if f.stem not in saved and f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)


def backfill_durations():
    """Clips generated before `duration` was recorded: derive it from the 16-bit mono WAV size."""
    for j in db.jobs.find({"status": "done", "duration": {"$exists": False}}, {"result_id": 1}):
        size = _size(_generated(j["result_id"]))
        if size > 44:
            db.jobs.update_one({"_id": j["_id"]}, {"$set": {"duration": (size - 44) / (2 * config.SAMPLE_RATE)}})


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    backfill_durations()
    cleanup_generated()
    state["engine"] = load_engine()  # loaded once, resident for process lifetime
    state["queue"] = asyncio.Queue()
    # re-queue anything interrupted by a restart
    db.jobs.update_many({"status": "running"}, {"$set": {"status": "queued"}})
    for j in db.jobs.find({"status": "queued"}, {"_id": 1}).sort("created_at", 1):
        state["queue"].put_nowait(j["_id"])
    task = asyncio.create_task(worker())
    yield
    task.cancel()


app = FastAPI(title="Voice Cloning App", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.FRONTEND_ORIGINS,
    allow_methods=["*"], allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "device": state["engine"].device, "languages": config.LANGUAGES,
            "max_text_chars": config.MAX_TEXT_CHARS, "max_upload_bytes": config.MAX_UPLOAD_BYTES,
            "max_clip_seconds": config.MAX_CLIP_SECONDS}


# ---- voices ----------------------------------------------------------------
@app.post("/voices", status_code=201)
async def create_voice(
    name: str = Form(..., min_length=1, max_length=80),
    language: str = Form("en"),
    consent: bool = Form(False),
    file: UploadFile | None = File(None),
    files: list[UploadFile] = File([]),  # several samples are joined into one reference
    user_id: str = Depends(current_user),
):
    if not consent:
        raise HTTPException(400, "Consent to clone this voice is required")
    if language not in config.LANGUAGES:
        raise HTTPException(400, f"Unsupported language '{language}'")
    uploads = ([file] if file else []) + files
    if not uploads:
        raise HTTPException(400, "No audio uploaded")
    clips = []
    for f in uploads:
        data = await f.read()
        if not data:
            raise HTTPException(400, "Empty upload")
        if len(data) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"{f.filename or 'File'} is larger than "
                                     f"{config.MAX_UPLOAD_BYTES // (1024 * 1024)}MB")
        clips.append(data)
    loop = asyncio.get_running_loop()
    try:
        wav = await loop.run_in_executor(None, audio.preprocess, *clips)
    except audio.AudioRejected as e:
        raise HTTPException(422, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    voice_id = _new_id()
    vdir = _voice_dir(voice_id)
    vdir.mkdir(parents=True)
    try:
        audio.write_wav(vdir / "reference.wav", wav)
        await loop.run_in_executor(None, state["engine"].embed, vdir / "reference.wav", vdir / "embedding.pt")
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(vdir, ignore_errors=True)
        state["engine"].free_cache()
        msg = "GPU out of memory; try a shorter sample" if "out of memory" in str(e).lower() else str(e)
        raise HTTPException(500, f"Failed to extract speaker embedding: {msg}")

    now = _now()
    voice = {
        "_id": voice_id, "user_id": user_id, "name": name.strip(), "language": language,
        "duration": len(wav) / config.SAMPLE_RATE, "filename": uploads[0].filename or "", "samples": len(uploads),
        "audio_url": f"/voices/{voice_id}/audio", "favorite": False, "consent_at": now, "created_at": now,
    }
    await asyncio.to_thread(db.voices.insert_one, voice)
    return _public(voice)


@app.get("/voices")
def list_voices(user_id: str = Depends(current_user)):
    return [_public(v) for v in db.voices.find({"user_id": user_id}).sort("created_at", -1)]


class VoiceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    favorite: bool | None = None


@app.patch("/voices/{voice_id}")
def update_voice(voice_id: str, body: VoiceUpdate, user_id: str = Depends(current_user)):
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(422, "Nothing to update")
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    voice = db.voices.find_one_and_update({"_id": voice_id, "user_id": user_id}, {"$set": changes},
                                          return_document=ReturnDocument.AFTER)
    if voice is None:
        raise HTTPException(404, "Voice not found")
    return _public(voice)


@app.delete("/voices/{voice_id}", status_code=204)
def delete_voice(voice_id: str, user_id: str = Depends(current_user)):
    if db.voices.delete_one({"_id": voice_id, "user_id": user_id}).deleted_count == 0:
        raise HTTPException(404, "Voice not found")
    _delete_jobs({"voice_id": voice_id})
    shutil.rmtree(_voice_dir(voice_id), ignore_errors=True)


@app.get("/voices/{voice_id}/audio")
def voice_reference(voice_id: str, user_id: str = Depends(current_user)):
    if not voice_id.isalnum():
        raise HTTPException(400, "Bad id")
    owned = db.voices.find_one({"_id": voice_id, "user_id": user_id}, {"_id": 1})
    p = _voice_dir(voice_id) / "reference.wav"
    if owned is None or not p.exists():
        raise HTTPException(404, "Voice not found")
    return FileResponse(p, media_type="audio/wav")


# ---- generation ------------------------------------------------------------
class GenerateRequest(BaseModel):
    voice_id: str
    text: str = Field(min_length=1, max_length=config.MAX_TEXT_CHARS)
    language: str = "en"


def _check_request(req: GenerateRequest, user_id: str):
    if not req.text.strip():
        raise HTTPException(422, "Text is empty")
    if req.language not in config.LANGUAGES:
        raise HTTPException(400, f"Unsupported language '{req.language}'")
    if db.voices.find_one({"_id": req.voice_id, "user_id": user_id}, {"_id": 1}) is None:
        raise HTTPException(404, "Voice not found")


@app.post("/generate", status_code=202)
async def generate(req: GenerateRequest, user_id: str = Depends(current_user)):
    await asyncio.to_thread(_check_request, req, user_id)
    job_id = _new_id()
    await asyncio.to_thread(db.jobs.insert_one, {
        "_id": job_id, "user_id": user_id, "voice_id": req.voice_id, "text": req.text.strip(),
        "language": req.language, "status": "queued", "error": None, "result_id": None,
        "filename": None, "audio_url": None, "created_at": _now(), "completed_at": None,
    })
    await state["queue"].put(job_id)
    return {"job_id": job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def get_job(job_id: str, user_id: str = Depends(current_user)):
    j = db.jobs.find_one({"_id": job_id, "user_id": user_id})
    if j is None:
        raise HTTPException(404, "Job not found")
    return {"id": j["_id"], "status": j["status"], "error": j["error"], "audio_id": j["result_id"],
            "duration": j.get("duration"), "position": state["queue"].qsize() if j["status"] == "queued" else 0}


@app.delete("/jobs/{job_id}", status_code=204)
def cancel_job(job_id: str, user_id: str = Depends(current_user)):
    """Cancel a pending generation. One already on the GPU runs to completion and is then discarded."""
    pending = {"_id": job_id, "user_id": user_id, "status": {"$in": ["queued", "running"]}}
    if db.jobs.delete_one(pending).deleted_count == 0:
        raise HTTPException(404, "Job not found or already finished")


@app.get("/audio/{audio_id}")
def get_audio(audio_id: str, user_id: str = Depends(current_user)):
    if not audio_id.isalnum():
        raise HTTPException(400, "Bad id")
    owned = db.jobs.find_one({"result_id": audio_id, "user_id": user_id}, {"_id": 1})
    p = _generated(audio_id)
    if owned is None or not p.exists():
        raise HTTPException(404, "Audio not found (may have expired)")
    return FileResponse(p, media_type="audio/wav", filename=f"voice-{audio_id[:8]}.wav")


def _wav_header(sr: int) -> bytes:
    # Unknown-length streaming WAV header (0xFFFFFFFF sizes), 16-bit mono PCM.
    return (b"RIFF" + struct.pack("<I", 0xFFFFFFFF) + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
            + b"data" + struct.pack("<I", 0xFFFFFFFF))


@app.post("/generate/stream")
async def generate_stream(req: GenerateRequest, user_id: str = Depends(current_user)):
    """Stretch goal: chunked inference, audio starts arriving before synthesis finishes."""
    await asyncio.to_thread(_check_request, req, user_id)
    emb =_voice_dir(req.voice_id) / "embedding.pt"
    loop = asyncio.get_running_loop()

    async def body():
        yield _wav_header(config.SAMPLE_RATE)
        it = state["engine"].stream(req.text.strip(), req.language, emb)
        sentinel = object()
        while True:
            chunk = await loop.run_in_executor(None, next, it, sentinel)
            if chunk is sentinel:
                break
            yield (chunk.clip(-1, 1) * 32767).astype("<i2").tobytes()

    return StreamingResponse(body(), media_type="audio/wav")


# ---- saved clips (library) -------------------------------------------------
# A clip is a finished generation the user saved; it is addressed by its audio id.
class ClipSave(BaseModel):
    audio_id: str
    name: str = Field(min_length=1, max_length=80)
    gender: Literal["female", "male", "other"]
    language: str
    age: int = Field(ge=1, le=120)


class ClipUpdate(BaseModel):
    favorite: bool


def _voice_names(user_id: str) -> dict:
    return {v["_id"]: v["name"] for v in db.voices.find({"user_id": user_id}, {"name": 1})}


def _clip(job, voice_names) -> dict:
    return {"id": job["result_id"], **job["saved"], "voice_id": job["voice_id"],
            "voice_name": voice_names.get(job["voice_id"], ""), "text": job["text"],
            "duration": job.get("duration") or 0, "favorite": job.get("favorite", False),
            "created_at": job["created_at"], "audio_url": job["audio_url"]}


@app.get("/clips")
def list_clips(user_id: str = Depends(current_user)):
    names = _voice_names(user_id)
    saved = db.jobs.find({"user_id": user_id, "saved": {"$exists": True}}).sort("created_at", -1)
    return [_clip(j, names) for j in saved]


@app.post("/clips", status_code=201)
def save_clip(body: ClipSave, user_id: str = Depends(current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Name is empty")
    if body.language not in config.LANGUAGES:
        raise HTTPException(400, f"Unsupported language '{body.language}'")
    if not body.audio_id.isalnum() or not _generated(body.audio_id).exists():
        raise HTTPException(404, "Audio not found (may have expired)")
    saved = {"name": name, "gender": body.gender, "language": body.language, "age": body.age}
    job = db.jobs.find_one_and_update({"result_id": body.audio_id, "user_id": user_id}, {"$set": {"saved": saved}},
                                      return_document=ReturnDocument.AFTER)
    if job is None:
        raise HTTPException(404, "Audio not found (may have expired)")
    return _clip(job, _voice_names(user_id))


@app.patch("/clips/{clip_id}")
def update_clip(clip_id: str, body: ClipUpdate, user_id: str = Depends(current_user)):
    job = db.jobs.find_one_and_update({"result_id": clip_id, "user_id": user_id, "saved": {"$exists": True}},
                                      {"$set": {"favorite": body.favorite}}, return_document=ReturnDocument.AFTER)
    if job is None:
        raise HTTPException(404, "Clip not found")
    return _clip(job, _voice_names(user_id))


@app.delete("/clips/{clip_id}", status_code=204)
def delete_clip(clip_id: str, user_id: str = Depends(current_user)):
    if _delete_jobs({"result_id": clip_id, "user_id": user_id}) == 0:
        raise HTTPException(404, "Clip not found")


# ---- usage and history -----------------------------------------------------
@app.get("/stats")
def stats(user_id: str = Depends(current_user)):
    voices = list(db.voices.find({"user_id": user_id}, {"duration": 1}))
    clips = list(db.jobs.find({"user_id": user_id, "status": "done"}, {"result_id": 1, "duration": 1, "saved": 1}))
    storage = {
        "recordings": sum(_size(_voice_dir(v["_id"]) / "reference.wav") for v in voices),
        "embeddings": sum(_size(_voice_dir(v["_id"]) / "embedding.pt") for v in voices),
        "generated": sum(_size(_generated(c["result_id"])) for c in clips),
    }
    return {
        "voices": len(voices), "clips": len(clips), "saved_clips": sum("saved" in c for c in clips),
        "voice_seconds": sum(v.get("duration") or 0 for v in voices),
        "generated_seconds": sum(c.get("duration") or 0 for c in clips),
        "storage": {**storage, "total": sum(storage.values())},
    }


@app.get("/activity")
def activity(limit: int = Query(10, ge=1, le=50), user_id: str = Depends(current_user)):
    """Latest clones and generations, newest first. `audio_url` is null once an unsaved clip has expired."""
    names = _voice_names(user_id)
    items = [{"type": "voice", "id": v["_id"], "name": v["name"], "text": None, "language": v["language"],
              "duration": v["duration"], "created_at": v["created_at"], "audio_url": v["audio_url"]}
             for v in db.voices.find({"user_id": user_id}).sort("created_at", -1).limit(limit)]
    for j in db.jobs.find({"user_id": user_id, "status": "done"}).sort("completed_at", -1).limit(limit):
        items.append({"type": "clip", "id": j["result_id"],
                      "name": j.get("saved", {}).get("name") or names.get(j["voice_id"], ""), "text": j["text"],
                      "language": j["language"], "duration": j.get("duration") or 0, "created_at": j["completed_at"],
                      "audio_url": j["audio_url"] if _generated(j["result_id"]).exists() else None})
    return sorted(items, key=lambda i: i["created_at"], reverse=True)[:limit]


@app.delete("/data")
def delete_all_data(confirm: str = "", user_id: str = Depends(current_user)):
    """Permanently remove every voice, embedding, generated clip and record owned by the user."""
    if confirm != "DELETE":
        raise HTTPException(400, "Confirmation required")
    voice_ids = [v["_id"] for v in db.voices.find({"user_id": user_id}, {"_id": 1})]
    clips = _delete_jobs({"user_id": user_id})
    db.voices.delete_many({"user_id": user_id})
    for voice_id in voice_ids:
        shutil.rmtree(_voice_dir(voice_id), ignore_errors=True)
    return {"voices": len(voice_ids), "clips": clips}
