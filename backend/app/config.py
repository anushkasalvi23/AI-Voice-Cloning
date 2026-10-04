import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")  # backend/.env; real env vars win

DATA_DIR = Path(os.environ.get("VC_DATA_DIR", Path(__file__).resolve().parents[2] / "data"))
VOICES_DIR = DATA_DIR / "voices"
GENERATED_DIR = DATA_DIR / "generated"

SAMPLE_RATE = 24000          # XTTS-v2 native rate
MIN_CLIP_SECONDS = 3.0
MAX_CLIP_SECONDS = 180.0     # total across all samples of one voice
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # per sample file
MIN_RMS_DBFS = -45.0         # reject clips quieter than this
TARGET_RMS_DBFS = -20.0
MAX_TEXT_CHARS = 1000
GENERATED_TTL_HOURS = 24


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set. Copy backend/.env.example to backend/.env and fill it in.")
    return value


# Clerk: session tokens are verified against the instance's public keys (JWKS).
CLERK_JWKS_URL = _required("CLERK_JWKS_URL")
CLERK_ISSUER = CLERK_JWKS_URL.removesuffix("/.well-known/jwks.json")
# Origins the frontend is served from: allowed by CORS and accepted as a token's `azp`.
FRONTEND_ORIGINS = [o.strip() for o in os.environ.get(
    "VC_FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]

MONGODB_URI = _required("MONGODB_URI")
DATABASE_NAME = _required("DATABASE_NAME")

# Set VC_FAKE_ENGINE=1 to run the API without a GPU/model (used by tests).
FAKE_ENGINE = os.environ.get("VC_FAKE_ENGINE") == "1"
MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "ja", "hu", "ko", "hi"]

for d in (VOICES_DIR, GENERATED_DIR):
    d.mkdir(parents=True, exist_ok=True)
