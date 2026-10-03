import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("VC_DATA_DIR", Path(__file__).resolve().parents[2] / "data"))
VOICES_DIR = DATA_DIR / "voices"
GENERATED_DIR = DATA_DIR / "generated"
DB_PATH = DATA_DIR / "app.db"

SAMPLE_RATE = 24000          # XTTS-v2 native rate
MIN_CLIP_SECONDS = 3.0
MAX_CLIP_SECONDS = 60.0
MIN_RMS_DBFS = -45.0         # reject clips quieter than this
TARGET_RMS_DBFS = -20.0
MAX_TEXT_CHARS = 1000
GENERATED_TTL_HOURS = 24

# Set VC_FAKE_ENGINE=1 to run the API without a GPU/model (used by tests).
FAKE_ENGINE = os.environ.get("VC_FAKE_ENGINE") == "1"
MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh-cn", "ja", "hu", "ko", "hi"]

for d in (VOICES_DIR, GENERATED_DIR):
    d.mkdir(parents=True, exist_ok=True)
