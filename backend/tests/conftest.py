import os
import tempfile

os.environ["VC_FAKE_ENGINE"] = "1"
os.environ["VC_DATA_DIR"] = tempfile.mkdtemp()
# Set before the app is imported so backend/.env is never used: tests must not touch Clerk or Atlas.
os.environ["CLERK_JWKS_URL"] = "https://clerk.test/.well-known/jwks.json"
os.environ["MONGODB_URI"] = "mongodb://unused"
os.environ["DATABASE_NAME"] = "test"

import mongomock  # noqa: E402

from app import db  # noqa: E402

db.MongoClient = mongomock.MongoClient  # in-memory database
