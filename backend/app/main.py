import asyncio
import shutil
import struct
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import audio, config, db
from .auth import current_user
from .engine import load_engine

state = {}


def _new_id() -> str:
    return uuid.uuid4().hex


def _voice_dir(voice_id):
    return config.VOICES_DIR / voice_id


def _now():
    return datetime.now(timezone.utc)


def _public(doc) -> dict:
    return {"id": doc["_id"], **{k: v for k, v in doc.items() if k != "_id"}}


async def worker():
    """Single GPU worker: jobs run one at a time so requests never collide on the card."""
    loop = asyncio.get_running_loop()
    while True:
        job_id = await state["queue"].get()
        try:
            job = await asyncio.to_thread(db.jobs.find_one_and_update, {"_id": job_id}, {"$set": {"status": "running"}})
            if job is None:  # voice deleted while queued
                continue
            emb = _voice_dir(job["voice_id"]) / "embedding.pt"
            t0 = time.perf_counter()
            wav = await loop.run_in_executor(None, state["engine"].synthesize, job["text"], job["language"], emb)
            result_id = _new_id()
            audio.write_wav(config.GENERATED_DIR / f"{result_id}.wav", wav)
            print(f"[job {job_id[:8]}] {len(job['text'])} chars -> "
                  f"{len(wav) / config.SAMPLE_RATE:.1f}s audio in {time.perf_counter() - t0:.2f}s")
            await asyncio.to_thread(db.jobs.update_one, {"_id": job_id}, {"$set": {
                "status": "done", "result_id": result_id, "filename": f"{result_id}.wav",
                "audio_url": f"/audio/{result_id}", "completed_at": _now()}})
        except Exception as e:  # noqa: BLE001 - surface any failure on the job row
            msg = "GPU out of memory; try shorter text" if "out of memory" in str(e).lower() else str(e)
            await asyncio.to_thread(db.jobs.update_one, {"_id": job_id},
                                    {"$set": {"status": "failed", "error": msg, "completed_at": _now()}})
            state["engine"].free_cache()


def cleanup_generated():
    cutoff = time.time() - config.GENERATED_TTL_HOURS * 3600
    for f in config.GENERATED_DIR.glob("*.wav"):
        if f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
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
    return {"status": "ok", "device": state["engine"].device, "languages": config.LANGUAGES}


# ---- voices ----------------------------------------------------------------
@app.post("/voices", status_code=201)
async def create_voice(
    name: str = Form(..., min_length=1, max_length=80),
    language: str = Form("en"),
    consent: bool = Form(False),
    file: UploadFile = File(...),
    user_id: str = Depends(current_user),
):
    if not consent:
        raise HTTPException(400, "Consent to clone this voice is required")
    if language not in config.LANGUAGES:
        raise HTTPException(400, f"Unsupported language '{language}'")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty upload")
    loop = asyncio.get_running_loop()
    try:
        wav = await loop.run_in_executor(None, audio.preprocess, data)
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
        raise HTTPException(500, f"Failed to extract speaker embedding: {e}")

    now = _now()
    voice = {
        "_id": voice_id, "user_id": user_id, "name": name.strip(), "language": language,
        "duration": len(wav) / config.SAMPLE_RATE, "filename": file.filename or "",
        "audio_url": f"/voices/{voice_id}/audio", "consent_at": now, "created_at": now,
    }
    await asyncio.to_thread(db.voices.insert_one, voice)
    return _public(voice)


@app.get("/voices")
def list_voices(user_id: str = Depends(current_user)):
    return [_public(v) for v in db.voices.find({"user_id": user_id}).sort("created_at", -1)]


class VoiceUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@app.patch("/voices/{voice_id}")
def rename_voice(voice_id: str, body: VoiceUpdate, user_id: str = Depends(current_user)):
    res = db.voices.update_one({"_id": voice_id, "user_id": user_id}, {"$set": {"name": body.name.strip()}})
    if res.matched_count == 0:
        raise HTTPException(404, "Voice not found")
    return {"id": voice_id, "name": body.name.strip()}


@app.delete("/voices/{voice_id}", status_code=204)
def delete_voice(voice_id: str, user_id: str = Depends(current_user)):
    if db.voices.delete_one({"_id": voice_id, "user_id": user_id}).deleted_count == 0:
        raise HTTPException(404, "Voice not found")
    db.jobs.delete_many({"voice_id": voice_id})
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
            "position": state["queue"].qsize() if j["status"] == "queued" else 0}


@app.get("/audio/{audio_id}")
def get_audio(audio_id: str, user_id: str = Depends(current_user)):
    if not audio_id.isalnum():
        raise HTTPException(400, "Bad id")
    owned = db.jobs.find_one({"result_id": audio_id, "user_id": user_id}, {"_id": 1})
    p = config.GENERATED_DIR / f"{audio_id}.wav"
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
