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
copy .env.example .env            # then fill in the values
uvicorn app.main:app --port 8000
```
First start downloads the model (~1.8GB) and accepts Coqui's CPML license (non-commercial use) via `COQUI_TOS_AGREED=1`.
Audio and embeddings live in `data/`; metadata lives in MongoDB. Run tests with `pytest` (no GPU, Clerk or MongoDB needed).

## Frontend
```
cd frontend
npm install
copy .env.example .env            # then fill in the values
npm run dev     # http://localhost:5173, proxies /api -> :8000
```

## Phase 1 sanity check
`python ../scripts/phase1_infer.py my_voice.wav "Hello world"` from `backend/`.

## API
`POST /voices` (multipart: file, name, language, consent=true) · `GET /voices` · `PATCH/DELETE /voices/{id}` ·
`POST /generate` → `{job_id}` · `GET /jobs/{id}` · `GET /audio/{id}` · `POST /generate/stream` (chunked WAV).

All routes except `/health` require a Clerk session token: `Authorization: Bearer <token>` (the frontend adds it).

## Configuration
Secrets live in git-ignored `.env` files; copy each `.env.example` and fill it in.

| File | Variable | Purpose |
| --- | --- | --- |
| `frontend/.env` | `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (safe in the browser) |
| `backend/.env` | `CLERK_JWKS_URL` | Clerk public keys used to verify session tokens |
| `backend/.env` | `CLERK_SECRET_KEY` | Clerk Backend API key (not read by the app yet) |
| `backend/.env` | `MONGODB_URI` | MongoDB Atlas connection string |
| `backend/.env` | `DATABASE_NAME` | Database holding the `voices` and `jobs` collections |
| `backend/.env` | `VC_FRONTEND_ORIGINS` | Optional. Comma-separated frontend origins (default `localhost:5173`) |

## Auth and data
- **Clerk** handles sign up, sign in (email + password, Google) and sign out. The login and signup screens are the app's
  own and call Clerk through its hooks. The backend verifies each token's signature, expiry, issuer and origin.
- **MongoDB Atlas** stores metadata only; audio files stay in `data/`. Every document carries the Clerk `user_id`.
  `voices`: uploaded clips (`filename`, `audio_url`, `duration`, `created_at`).
  `jobs`: generated clips (`text`, `status`, `filename`, `audio_url`, `created_at`, `completed_at`).
- Voices recorded before this change live in `data/app.db`. To attach them to an account, run from `backend/`:
  `python ../scripts/migrate_sqlite_to_mongo.py <clerk_user_id>` (the ID is shown in the Clerk dashboard under Users).
