"""Phase 1: prove XTTS-v2 works on this GPU, no API involved.

Usage (from backend/, venv active):
    python ../scripts/phase1_infer.py reference.wav "Hello, this is my cloned voice." [lang]
"""
import sys
import time

sys.path.insert(0, ".")
from app import audio, config  # noqa: E402
from app.engine import Engine  # noqa: E402

ref, text = sys.argv[1], sys.argv[2]
lang = sys.argv[3] if len(sys.argv) > 3 else "en"

t = time.perf_counter()
engine = Engine()
print(f"model loaded on {engine.device} in {time.perf_counter() - t:.1f}s")

wav = audio.preprocess(open(ref, "rb").read())
audio.write_wav("phase1_reference.wav", wav)
engine.embed("phase1_reference.wav", "phase1_embedding.pt")

for i in range(2):  # second run shows steady-state latency
    t = time.perf_counter()
    out = engine.synthesize(text, lang, "phase1_embedding.pt")
    dt = time.perf_counter() - t
    print(f"run {i + 1}: {len(out) / config.SAMPLE_RATE:.1f}s audio in {dt:.2f}s")
audio.write_wav("phase1_output.wav", out)
print("wrote phase1_output.wav")
