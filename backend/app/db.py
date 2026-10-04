from pymongo import MongoClient

from . import config

# Collections, set by init(). Audio files stay on disk; these hold their metadata.
#   voices: _id, user_id (Clerk), name, language, duration, filename, samples, audio_url, favorite,
#           consent_at, created_at
#   jobs:   _id, user_id (Clerk), voice_id, text, language, status, error,
#           result_id, filename, audio_url, duration, created_at, completed_at,
#           saved {name, gender, language, age} and favorite once kept in the library
voices = None
jobs = None


def init():
    global voices, jobs
    database = MongoClient(config.MONGODB_URI, tz_aware=True, serverSelectionTimeoutMS=10000)[config.DATABASE_NAME]
    voices, jobs = database["voices"], database["jobs"]
    # Creating indexes also fails fast at startup if the cluster is unreachable.
    voices.create_index([("user_id", 1), ("created_at", -1)])
    jobs.create_index([("user_id", 1), ("created_at", -1)])
    jobs.create_index("voice_id")
    jobs.create_index("result_id")
