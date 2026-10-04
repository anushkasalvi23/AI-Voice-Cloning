"""One-off: copy voices and jobs from the old SQLite DB (data/app.db) into MongoDB for one Clerk user.

Run from backend/:  python ../scripts/migrate_sqlite_to_mongo.py <clerk_user_id>
Safe to re-run: documents that already exist are left alone. The SQLite file is not modified.
"""
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
from app import config, db  # noqa: E402


def when(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc) if text else None


def main(user_id: str):
    src = sqlite3.connect(config.DATA_DIR / "app.db")
    src.row_factory = sqlite3.Row
    db.init()
    voices = jobs = 0
    for v in src.execute("SELECT * FROM voices"):
        if not (config.VOICES_DIR / v["id"] / "reference.wav").exists():
            continue  # files were deleted; nothing to point at
        doc = {"user_id": user_id, "name": v["name"], "language": v["language"], "duration": v["duration"],
               "filename": "reference.wav", "audio_url": f"/voices/{v['id']}/audio",
               "consent_at": when(v["consent_at"]), "created_at": when(v["created_at"])}
        voices += db.voices.update_one({"_id": v["id"]}, {"$setOnInsert": doc}, upsert=True).upserted_id is not None
        for j in src.execute("SELECT * FROM jobs WHERE voice_id=?", (v["id"],)):
            rid = j["result_id"]
            doc = {"user_id": user_id, "voice_id": v["id"], "text": j["text"], "language": j["language"],
                   "status": j["status"], "error": j["error"], "result_id": rid,
                   "filename": f"{rid}.wav" if rid else None, "audio_url": f"/audio/{rid}" if rid else None,
                   "created_at": when(j["created_at"]), "completed_at": None}
            jobs += db.jobs.update_one({"_id": j["id"]}, {"$setOnInsert": doc}, upsert=True).upserted_id is not None
    print(f"Copied {voices} voices and {jobs} jobs to {config.DATABASE_NAME} for {user_id}")


if __name__ == "__main__":
    if len(sys.argv) != 2 or not sys.argv[1].startswith("user_"):
        sys.exit(__doc__)
    main(sys.argv[1])
