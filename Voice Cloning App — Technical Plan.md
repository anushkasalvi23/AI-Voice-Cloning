# Voice Cloning App — Technical Plan

Oct 3, 2026 · @Akshay

## 1. Overview

Build a self-hosted voice cloning web app, functionally similar to ElevenLabs' instant voice cloning: a user records or uploads a short voice sample, then generates speech in that cloned voice from arbitrary text.

**Goal.** Zero-shot voice cloning (no per-speaker training) using XTTS-v2, served from a local GPU, with a React frontend for recording and generation and a FastAPI backend for inference.

**In scope**

- Record/upload a reference voice sample in-browser
- Clone the voice and synthesize new text in that voice
- Save multiple named voices per user (a "voice library")
- Reasonable latency on a single consumer GPU (not real-time streaming initially)

**Out of scope (v1)**

- Fine-tuning XTTS-v2 per speaker (zero-shot only, first version)
- Multi-tenant production deployment / billing
- Real-time streaming playback (can be added later via XTTS-v2 streaming mode)

**Definition of done.** A user can record their voice in the browser, type any sentence, and hear it played back in their own cloned voice within a few seconds, with the voice saved for reuse.

## 2. System architecture

&#91;embedded content: request flow · frontend, FastAPI, GPU worker, storage\]

First recording of a voice: browser records audio in the Recorder UI, `POST /voices` preprocesses it (resample, trim silence, normalize) and runs it through the speaker encoder once, caching the resulting embedding. Every later generation for that voice reuses the cached embedding instead of re-encoding audio.

Generating speech: the frontend sends text + a voice id to `POST /generate`; FastAPI loads (or reuses) the cached embedding, runs the XTTS-v2 synthesizer + vocoder on GPU, writes the resulting audio to storage, and returns a reference the frontend plays back. The GPU worker is kept as a single resident process with the model loaded once at startup — loading XTTS-v2 per request would dominate latency.

## 3. Backend design (FastAPI + PyTorch)

**Model lifecycle.** Load XTTS-v2 once at process startup (FastAPI `lifespan` hook), keep it resident on GPU for the life of the process. Never instantiate the model per-request — load time alone can run into tens of seconds.

**Core endpoints**

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/voices` | POST | Upload/record a reference clip, preprocess it, extract and cache its speaker embedding |
| `/voices` | GET | List saved voices for the current user |
| `/voices/{id}` | DELETE | Remove a saved voice and its cached embedding |
| `/generate` | POST | Synthesize text in a given voice; returns an audio reference or job id |
| `/jobs/{id}` | GET | Poll generation status for longer/queued jobs |
| `/audio/{id}` | GET | Stream back a generated or reference audio file |

**Audio preprocessing pipeline (on upload).** Resample to the model's expected rate (24kHz for XTTS-v2) → convert to mono → trim leading/trailing silence → normalize loudness → reject clips that are too short (<3s) or too quiet/noisy to produce a usable clone.

**Inference flow (on generate).** Look up the voice's cached speaker embedding (skip re-encoding) → run the XTTS-v2 text-to-latent model conditioned on that embedding and the input text → run the HiFi-GAN-based vocoder to produce a waveform → write the result to storage → return a reference to the frontend.

**Concurrency.** GPU inference is effectively single-threaded per card in practice. Use a single-worker queue (in-process `asyncio` queue for a solo-GPU MVP, or Celery + Redis if concurrent users are expected) so requests don't collide on the GPU and the API stays responsive while a generation runs.

**Embedding cache.** Precompute and store each voice's speaker embedding once at upload time rather than recomputing it from raw audio on every generation — this is the single biggest latency win after keeping the model resident.

**Streaming (stretch).** XTTS-v2 supports chunked/streaming inference, returning audio as it's generated rather than waiting for the full clip. Worth adding once the basic synchronous flow works, to cut perceived latency closer to ElevenLabs' feel.

## 4. Frontend design (React)

- **Recorder component.** Captures mic audio via the `MediaRecorder` API, shows a live waveform/level meter, enforces a minimum recording length, and lets the user preview before uploading. Also supports uploading an existing audio file as an alternative to recording.
- **Voice library.** Lists saved voices (name, created date, short waveform thumbnail), lets the user pick a voice for generation, rename, or delete it.
- **Text input + generation panel.** A textarea for the text to synthesize, a voice picker (from the library), language selector (XTTS-v2 supports multiple languages), and a generate button.
- **Playback component.** Audio player for the generated result, with download and "generate again" affordances.
- **Status/progress UI.** Since generation isn't instant, show a loading/progress state while a job runs (poll `/jobs/{id}` or use a simple loading spinner for the synchronous MVP case).
- **Consent gate.** A lightweight, unskippable confirmation ("I confirm I have the right to clone this voice") before the first recording/upload completes, logged alongside the voice record.

## 5. Data and storage

| What | Stored as | Where |
| --- | --- | --- |
| Raw reference clip | WAV/FLAC file | Object storage / local disk (`/data/voices/{voice_id}/reference.wav`) |
| Speaker embedding | Serialized tensor (e.g. `.pt` or `.npy`) | Same voice folder, or a key-value store keyed by `voice_id` |
| Voice metadata | Row: id, user id, name, language, created\_at | Relational DB (Postgres) or SQLite for a solo-user MVP |
| Generated audio | WAV/MP3 file | Object storage, keyed by generation id, with a TTL/cleanup policy |
| Generation job | Row: id, voice\_id, text, status, result ref | Same DB, used for polling/async status |

For a single-user/local project, SQLite + local disk is enough and avoids standing up extra infrastructure. Move to Postgres + S3-compatible storage (e.g. MinIO) only if multiple users or deployment beyond one machine is needed.

## 6. Development roadmap

&#91;embedded content: four build phases · MVP inference to polished app\]

**Phase 1 — Core inference (prove the model works).** Install XTTS-v2 + PyTorch, run it from a script against a reference clip and test sentence, confirm GPU inference works and output quality is acceptable. No API or UI yet.

**Phase 2 — Backend API.** Wrap the working inference in FastAPI: `/voices`, `/generate`, audio preprocessing, embedding caching, model loaded once at startup. Test entirely via `curl`/Postman before touching the frontend.

**Phase 3 — Frontend.** Build the React recorder, voice library, text input, and playback UI; wire it to the Phase 2 API end-to-end.

**Phase 4 — Polish.** Add a job queue for concurrency, streaming inference for lower perceived latency, proper error handling (bad audio, GPU OOM, long text), and the consent gate.

## 7. Testing and evaluation

| Layer | What to check | How |
| --- | --- | --- |
| Model (Phase 1) | Cloned voice is recognizable and intelligible | Manual listening tests across several reference clips and sentences |
| Preprocessing | Rejects unusable clips (too short, too quiet, too noisy) | Unit tests with synthetic bad-audio fixtures |
| API (Phase 2) | Endpoints return correct status codes, handle malformed input, enforce clip length limits | `pytest` + `httpx` test client against FastAPI routes |
| Inference latency | Time from request to audio returned, per sentence length | Simple timing logs; track p50/p95 as text length grows |
| GPU memory | No OOM under repeated/concurrent requests | Load test with sequential and a few concurrent `/generate` calls |
| End-to-end (Phase 3-4) | Full record → generate → playback flow works from the UI | Manual QA pass + a scripted browser test (e.g. Playwright) for the happy path |

Quality is inherently subjective for voice cloning — budget for manual listening comparisons (clone vs. original) rather than relying only on automated metrics.

## 8. Risks and considerations

- **GPU/VRAM limits.** XTTS-v2 generally runs on 8GB+ VRAM, but longer texts or any batching push memory up. Cap input text length per request and monitor usage under load.
- **Licensing.** XTTS-v2 ships under Coqui's CPML license, which restricts commercial use without a separate agreement. Fine for a personal/learning/portfolio project; revisit before any commercial deployment.
- **Latency vs. ElevenLabs.** ElevenLabs' speed comes from heavily optimized production infrastructure; a single local GPU won't match that out of the box. Streaming inference (Phase 4) narrows the gap but won't close it entirely.
- **Audio quality floor.** Clone fidelity depends heavily on reference clip quality — background noise, short clips, or poor mic quality noticeably degrade results. Worth enforcing minimum quality checks at upload time.
- **Consent/ethics.** This is literally a voice-impersonation tool. A lightweight consent confirmation at recording time, plus awareness of applicable laws around synthetic voice/likeness, is worth building in from the start rather than bolting on later.
