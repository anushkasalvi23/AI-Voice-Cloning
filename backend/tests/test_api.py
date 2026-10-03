import io
import time

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.main import app


def wav_bytes(seconds=5.0, amp=0.3, sr=24000):
    t = np.linspace(0, seconds, int(sr * seconds), False)
    buf = io.BytesIO()
    sf.write(buf, amp * np.sin(2 * np.pi * 200 * t), sr, format="WAV")
    return buf.getvalue()


ACCOUNT = {"name": "Test User", "email": "Test@Example.com", "phone": "+919876543210", "password": "Str0ng!Passw0rd"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        r = c.post("/auth/signup", json=ACCOUNT)
        assert r.status_code == 201, r.text
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
    assert any(v["id"] == vid for v in client.get("/voices").json())
    assert client.patch(f"/voices/{vid}", json={"name": "Renamed"}).status_code == 200

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

    s = client.post("/generate/stream", json={"voice_id": vid, "text": "Hello"})
    assert s.status_code == 200 and s.content[:4] == b"RIFF"

    assert client.delete(f"/voices/{vid}").status_code == 204
    assert client.delete(f"/voices/{vid}").status_code == 404


def test_generate_validation(client):
    assert client.post("/generate", json={"voice_id": "nope", "text": "hi"}).status_code == 404
    assert client.post("/generate", json={"voice_id": "x", "text": ""}).status_code == 422
    assert client.post("/generate", json={"voice_id": "x", "text": "a" * 5000}).status_code == 422


def test_auth_required():
    with TestClient(app) as anon:
        assert anon.get("/voices").status_code == 401
        assert anon.get("/auth/me").status_code == 401
        assert anon.post("/generate", json={"voice_id": "x", "text": "hi"}).status_code == 401


def test_signup_validation(client):
    with TestClient(app) as anon:
        assert anon.post("/auth/signup", json=ACCOUNT).status_code == 409  # duplicate email, case-insensitive
        for field, bad in [("email", "nope"), ("phone", "12345"), ("password", "short"),
                           ("password", "alllowercase123"), ("name", " ")]:
            r = anon.post("/auth/signup", json={**ACCOUNT, "email": "other@example.com", field: bad})
            assert r.status_code == 422, (field, r.text)


def test_login_logout_and_isolation(client):
    assert client.get("/auth/me").json()["email"] == "test@example.com"
    vid = upload(client, wav_bytes()).json()["id"]
    with TestClient(app) as other:
        assert other.post("/auth/login", json={"email": ACCOUNT["email"], "password": "Wrong!Passw0rd1"}).status_code == 401
        assert other.post("/auth/login", json={"email": "ghost@example.com", "password": "x"}).status_code == 401
        r = other.post("/auth/signup", json={**ACCOUNT, "email": "second@example.com"})
        assert r.status_code == 201 and "password" not in r.text
        assert other.get("/voices").json() == []
        assert other.get(f"/voices/{vid}/audio").status_code == 404
        assert other.delete(f"/voices/{vid}").status_code == 404
        assert other.post("/generate", json={"voice_id": vid, "text": "hi"}).status_code == 404
        assert other.post("/auth/logout").status_code == 204
        assert other.get("/auth/me").status_code == 401
        assert other.post("/auth/login", json={"email": "SECOND@example.com", "password": ACCOUNT["password"]}).status_code == 200
        assert other.get("/auth/me").json()["email"] == "second@example.com"
    assert client.delete(f"/voices/{vid}").status_code == 204


def test_google_sign_in(monkeypatch):
    from app import auth, config
    with TestClient(app) as c:
        assert c.get("/auth/config").json() == {"google_client_id": None}
        assert c.post("/auth/google", json={"code": "x"}).status_code == 503

        monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", "cid")
        monkeypatch.setattr(config, "GOOGLE_CLIENT_SECRET", "secret")
        claims = {"aud": "cid", "email": "G.User@Example.com", "email_verified": True, "name": "G User"}
        monkeypatch.setattr(auth, "_google_identity", lambda code: claims)
        xhr = {"X-Requested-With": "XMLHttpRequest"}
        assert c.get("/auth/config").json() == {"google_client_id": "cid"}
        assert c.post("/auth/google", json={"code": "x"}).status_code == 400  # missing CSRF header

        r = c.post("/auth/google", json={"code": "x"}, headers=xhr)
        assert r.status_code == 200 and r.json()["email"] == "g.user@example.com", r.text
        uid = r.json()["id"]
        assert c.get("/auth/me").json()["name"] == "G User"
        assert c.post("/auth/logout").status_code == 204
        assert c.post("/auth/google", json={"code": "x"}, headers=xhr).json()["id"] == uid  # same account again
        # a Google-only account has no password to log in with
        assert c.post("/auth/login", json={"email": "g.user@example.com", "password": ""}).status_code == 422
        assert c.post("/auth/login", json={"email": "g.user@example.com", "password": "anything"}).status_code == 401

        # an existing password account with the same verified email is signed into, not duplicated
        claims.update(email=ACCOUNT["email"])
        assert c.post("/auth/google", json={"code": "x"}, headers=xhr).json()["name"] == ACCOUNT["name"]

        for bad in ({"aud": "someone-else"}, {"email_verified": False}, {"email": ""}):
            monkeypatch.setattr(auth, "_google_identity", lambda code, bad=bad: {**claims, **bad})
            assert c.post("/auth/google", json={"code": "x"}, headers=xhr).status_code == 401, bad
