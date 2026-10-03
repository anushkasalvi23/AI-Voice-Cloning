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


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
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
