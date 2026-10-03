# Voice Cloning App

Zero-shot voice cloning with XTTS-v2. FastAPI backend + React (Vite) frontend. See the technical plan for design.

## Requirements
Python 3.10+ (uses the `coqui-tts` fork), Node 18+, ffmpeg on PATH, NVIDIA GPU with 8GB+ VRAM (CPU works, slowly).

## Backend
```
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```
First start downloads the model (~1.8GB) and accepts Coqui's CPML license (non-commercial use) via `COQUI_TOS_AGREED=1`.
Data lives in `data/` (SQLite + wav/embedding files). Run tests with `set VC_FAKE_ENGINE=1 && pytest` (no GPU needed).

## Frontend
```
cd frontend
npm install
npm run dev     # http://localhost:5173, proxies /api -> :8000
```

## Phase 1 sanity check
`python ../scripts/phase1_infer.py my_voice.wav "Hello world"` from `backend/`.

## API
`POST /voices` (multipart: file, name, language, consent=true) · `GET /voices` · `PATCH/DELETE /voices/{id}` ·
`POST /generate` → `{job_id}` · `GET /jobs/{id}` · `GET /audio/{id}` · `POST /generate/stream` (chunked WAV).
