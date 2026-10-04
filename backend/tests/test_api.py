import io
import time
from types import SimpleNamespace

import jwt
import numpy as np
import pytest
import soundfile as sf
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app import auth, config, db
from app.main import app

CLERK_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def wav_bytes(seconds=5.0, amp=0.3, sr=24000):
    t = np.linspace(0, seconds, int(sr * seconds), False)
    buf = io.BytesIO()
    sf.write(buf, amp * np.sin(2 * np.pi * 200 * t), sr, format="WAV")
    return buf.getvalue()


def token(sub="user_one", key=CLERK_KEY, **claims):
    """A session token shaped like Clerk's: RS256, iss = the instance, azp = the frontend origin."""
    now = int(time.time())
    payload = {"sub": sub, "iss": config.CLERK_ISSUER, "azp": config.FRONTEND_ORIGINS[0],
               "iat": now, "nbf": now, "exp": now + 3600, **claims}
    return jwt.encode({k: v for k, v in payload.items() if v is not None}, key, algorithm="RS256")


def bearer(*args, **kwargs):
    return {"Authorization": f"Bearer {token(*args, **kwargs)}"}


@pytest.fixture(autouse=True, scope="module")
def clerk_keys():
    # Stand in for the JWKS fetch; the signature and claims are still verified for real.
    mp = pytest.MonkeyPatch()
    mp.setattr(auth._jwks, "get_signing_key_from_jwt", lambda t: SimpleNamespace(key=CLERK_KEY.public_key()))
    yield
    mp.undo()


@pytest.fixture(scope="module")
def client():
    with TestClient(app, headers=bearer()) as c:
        yield c


def upload(client, data, consent="true", name="Me"):
    return client.post("/voices", data={"name": name, "language": "en", "consent": consent},
                       files={"file": ("a.wav", data, "audio/wav")})


def test_requires_consent(client):
    assert upload(client, wav_bytes(), consent="false").status_code == 400


def test_rejects_short_clip(client):
    assert upload(client, wav_bytes(1.0)).status_code == 422


def test_rejects_quiet_clip(client):
    assert upload(client, wav_bytes(5.0, amp=0.0005)).status_code == 422


def test_rejects_garbage(client):
    assert upload(client, b"not audio").status_code == 422


def test_voice_lifecycle_and_generate(client):
    r = upload(client, wav_bytes())
    assert r.status_code == 201, r.text
    vid = r.json()["id"]
    listed = next(v for v in client.get("/voices").json() if v["id"] == vid)
    assert listed["created_at"][:4].isdigit() and listed["duration"] > 4
    assert client.patch(f"/voices/{vid}", json={"name": "Renamed"}).status_code == 200
    assert client.get(f"/voices/{vid}/audio").status_code == 200

    job = client.post("/generate", json={"voice_id": vid, "text": "Hello there", "language": "en"})
    assert job.status_code == 202
    jid = job.json()["job_id"]
    for _ in range(50):
        j = client.get(f"/jobs/{jid}").json()
        if j["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert j["status"] == "done", j
    assert client.get(f"/audio/{j['audio_id']}").status_code == 200

    # metadata for both the upload and the generated clip is stored against the Clerk user
    voice = db.voices.find_one({"_id": vid})
    assert voice["user_id"] == "user_one" and voice["filename"] == "a.wav" and voice["name"] == "Renamed"
    assert voice["audio_url"] == f"/voices/{vid}/audio" and voice["created_at"] is not None
    stored = db.jobs.find_one({"_id": jid})
    assert stored["user_id"] == "user_one" and stored["voice_id"] == vid
    assert stored["audio_url"] == f"/audio/{j['audio_id']}" and stored["filename"] == f"{j['audio_id']}.wav"
    assert stored["created_at"] <= stored["completed_at"]

    s = client.post("/generate/stream", json={"voice_id": vid, "text": "Hello"})
    assert s.status_code == 200 and s.content[:4] == b"RIFF"

    assert client.delete(f"/voices/{vid}").status_code == 204
    assert client.delete(f"/voices/{vid}").status_code == 404
    assert db.jobs.find_one({"_id": jid}) is None


def test_generate_validation(client):
    assert client.post("/generate", json={"voice_id": "nope", "text": "hi"}).status_code == 404
    assert client.post("/generate", json={"voice_id": "x", "text": ""}).status_code == 422
    assert client.post("/generate", json={"voice_id": "x", "text": "a" * 5000}).status_code == 422


# The tests below build extra clients without `with`: entering a second TestClient would re-run
# the app's startup and replace the job queue the module-wide `client` is using.
def test_every_data_endpoint_requires_auth(client):
    anon = TestClient(app)
    assert anon.get("/health").status_code == 200  # the only public route
    for method, path in [("GET", "/voices"), ("POST", "/voices"), ("PATCH", "/voices/x"), ("DELETE", "/voices/x"),
                         ("GET", "/voices/x/audio"), ("POST", "/generate"), ("GET", "/jobs/x"),
                         ("GET", "/audio/x"), ("POST", "/generate/stream")]:
        assert anon.request(method, path).status_code == 401, (method, path)
    assert anon.post("/auth/login", json={}).status_code == 404  # the old auth routes are gone


def test_rejects_invalid_tokens(client):
    past = int(time.time()) - 7200
    bad = {
        "garbage": {"Authorization": "Bearer not.a.jwt"},
        "wrong scheme": {"Authorization": f"Basic {token()}"},
        "signed by another key": bearer(key=OTHER_KEY),
        "expired": bearer(iat=past, nbf=past, exp=past + 60),
        "another issuer": bearer(iss="https://evil.example"),
        "another site (azp)": bearer(azp="https://evil.example"),
        "no subject": bearer(sub=None),
        "unsigned": {"Authorization": "Bearer " + jwt.encode({"sub": "user_one", "exp": past + 99999}, None, algorithm="none")},
        "HS256": {"Authorization": "Bearer " + jwt.encode(
            {"sub": "user_one", "iss": config.CLERK_ISSUER, "iat": past, "exp": past + 99999}, "x" * 32, algorithm="HS256")},
    }
    c = TestClient(app)
    for why, headers in bad.items():
        assert c.get("/voices", headers=headers).status_code == 401, why
    assert c.get("/voices", headers=bearer()).status_code == 200
    assert c.get("/voices", headers=bearer(azp=None)).status_code == 200  # azp is optional in Clerk tokens


def test_session_cookie_is_read_only(client):
    # <audio src> requests carry Clerk's __session cookie instead of a header
    c = TestClient(app, cookies={"__session": token()})
    assert c.get("/voices").status_code == 200
    assert c.post("/generate", json={"voice_id": "x", "text": "hi"}).status_code == 401
    assert c.delete("/voices/x").status_code == 401


def test_users_are_isolated(client):
    vid = upload(client, wav_bytes()).json()["id"]
    job = client.post("/generate", json={"voice_id": vid, "text": "hi"}).json()["job_id"]
    for _ in range(50):
        j = client.get(f"/jobs/{job}").json()
        if j["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert j["status"] == "done", j

    other = TestClient(app, headers=bearer("user_two"))
    assert other.get("/voices").json() == []
    assert other.get(f"/voices/{vid}/audio").status_code == 404
    assert other.patch(f"/voices/{vid}", json={"name": "Mine now"}).status_code == 404
    assert other.delete(f"/voices/{vid}").status_code == 404
    assert other.post("/generate", json={"voice_id": vid, "text": "hi"}).status_code == 404
    assert other.post("/generate/stream", json={"voice_id": vid, "text": "hi"}).status_code == 404
    assert other.get(f"/jobs/{job}").status_code == 404
    assert other.get(f"/audio/{j['audio_id']}").status_code == 404

    assert client.get(f"/audio/{j['audio_id']}").status_code == 200
    assert client.delete(f"/voices/{vid}").status_code == 204
