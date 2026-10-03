import asyncio
import shutil
import struct
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import audio, config, db
from .engine import load_engine

USER_ID = "local"  # single-user MVP; swap for real auth if multi-tenant is ever needed
state = {}


def _new_id() -> str:
    return uuid.uuid4().hex


def _voice_dir(voice_id):
    return config.VOICES_DIR / voice_id


async def worker():
    """Single GPU worker: jobs run one at a time so requests never collide on the card."""
    loop = asyncio.get_running_loop()
    while True:
        job_id = await state["queue"].get()
        try:
            with db.conn() as c:
                job = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
                if job is None:  # voice deleted while queued
                    continue
                c.execute("UPDATE jobs SET status='running' WHERE id=?", (job_id,))
            emb = _voice_dir(job["voice_id"]) / "embedding.pt"
            t0 = time.perf_counter()
            wav = await loop.run_in_executor(None, state["engine"].synthesize, job["text"], job["language"], emb)
            result_id = _new_id()
            audio.write_wav(config.GENERATED_DIR / f"{result_id}.wav", wav)
            print(f"[job {job_id[:8]}] {len(job['text'])} chars -> "
                  f"{len(wav) / config.SAMPLE_RATE:.1f}s audio in {time.perf_counter() - t0:.2f}s")
            with db.conn() as c:
                c.execute("UPDATE jobs SET status='done', result_id=? WHERE id=?", (result_id, job_id))
        except Exception as e:  # noqa: BLE001 - surface any failure on the job row
            msg = "GPU out of memory; try shorter text" if "out of memory" in str(e).lower() else str(e)
            with db.conn() as c:
                c.execute("UPDATE jobs SET status='failed', error=? WHERE id=?", (msg, job_id))
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
    with db.conn() as c:  # re-queue anything interrupted by a restart
        c.execute("UPDATE jobs SET status='queued' WHERE status='running'")
        for r in c.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at"):
            state["queue"].put_nowait(r["id"])
    task = asyncio.create_task(worker())
    yield
    task.cancel()


app = FastAPI(title="Voice Cloning App", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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

    now = datetime.now(timezone.utc).isoformat()
    duration = len(wav) / config.SAMPLE_RATE
    with db.conn() as c:
        c.execute(
            "INSERT INTO voices (id, user_id, name, language, duration, consent_at) VALUES (?,?,?,?,?,?)",
            (voice_id, USER_ID, name.strip(), language, duration, now),
        )
    return {"id": voice_id, "name": name.strip(), "language": language, "duration": duration, "consent_at": now}


@app.get("/voices")
def list_voices():
    with db.conn() as c:
        rows = c.execute("SELECT * FROM voices WHERE user_id=? ORDER BY created_at DESC", (USER_ID,)).fetchall()
    return [dict(r) for r in rows]


class VoiceUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@app.patch("/voices/{voice_id}")
def rename_voice(voice_id: str, body: VoiceUpdate):
    with db.conn() as c:
        cur = c.execute("UPDATE voices SET name=? WHERE id=? AND user_id=?", (body.name.strip(), voice_id, USER_ID))
        if cur.rowcount == 0:
            raise HTTPException(404, "Voice not found")
    return {"id": voice_id, "name": body.name.strip()}


@app.delete("/voices/{voice_id}", status_code=204)
def delete_voice(voice_id: str):
    with db.conn() as c:
        cur = c.execute("DELETE FROM voices WHERE id=? AND user_id=?", (voice_id, USER_ID))
        if cur.rowcount == 0:
            raise HTTPException(404, "Voice not found")
    shutil.rmtree(_voice_dir(voice_id), ignore_errors=True)


@app.get("/voices/{voice_id}/audio")
def voice_reference(voice_id: str):
    if not voice_id.isalnum():
        raise HTTPException(400, "Bad id")
    p = _voice_dir(voice_id) / "reference.wav"
    if not p.exists():
        raise HTTPException(404, "Voice not found")
    return FileResponse(p, media_type="audio/wav")


# ---- generation ------------------------------------------------------------
class GenerateRequest(BaseModel):
    voice_id: str
    text: str = Field(min_length=1, max_length=config.MAX_TEXT_CHARS)
    language: str = "en"


def _check_request(req: GenerateRequest):
    if not req.text.strip():
        raise HTTPException(422, "Text is empty")
    if req.language not in config.LANGUAGES:
        raise HTTPException(400, f"Unsupported language '{req.language}'")
    with db.conn() as c:
        v = c.execute("SELECT 1 FROM voices WHERE id=? AND user_id=?", (req.voice_id, USER_ID)).fetchone()
    if v is None:
        raise HTTPException(404, "Voice not found")


@app.post("/generate", status_code=202)
async def generate(req: GenerateRequest):
    _check_request(req)
    job_id = _new_id()
    with db.conn() as c:
        c.execute("INSERT INTO jobs (id, voice_id, text, language) VALUES (?,?,?,?)",
                  (job_id, req.voice_id, req.text.strip(), req.language))
    await state["queue"].put(job_id)
    return {"job_id": job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    with db.conn() as c:
        j = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if j is None:
        raise HTTPException(404, "Job not found")
    return {"id": j["id"], "status": j["status"], "error": j["error"], "audio_id": j["result_id"],
            "position": state["queue"].qsize() if j["status"] == "queued" else 0}


@app.get("/audio/{audio_id}")
def get_audio(audio_id: str):
    if not audio_id.isalnum():
        raise HTTPException(400, "Bad id")
    p = config.GENERATED_DIR / f"{audio_id}.wav"
    if not p.exists():
        raise HTTPException(404, "Audio not found (may have expired)")
    return FileResponse(p, media_type="audio/wav", filename=f"voice-{audio_id[:8]}.wav")


def _wav_header(sr: int) -> bytes:
    # Unknown-length streaming WAV header (0xFFFFFFFF sizes), 16-bit mono PCM.
    return (b"RIFF" + struct.pack("<I", 0xFFFFFFFF) + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
            + b"data" + struct.pack("<I", 0xFFFFFFFF))


@app.post("/generate/stream")
async def generate_stream(req: GenerateRequest):
    """Stretch goal: chunked inference, audio starts arriving before synthesis finishes."""
    _check_request(req)
    emb = _voice_dir(req.voice_id) / "embedding.pt"
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
