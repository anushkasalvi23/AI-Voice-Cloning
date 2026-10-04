"""Reference-clip preprocessing: decode -> 24kHz mono -> trim silence -> normalize -> validate."""
import subprocess

import numpy as np
import soundfile as sf

from . import config


class AudioRejected(ValueError):
    pass


def _dbfs(x: np.ndarray) -> float:
    rms = float(np.sqrt(np.mean(np.square(x)))) if x.size else 0.0
    return -120.0 if rms < 1e-6 else 20 * np.log10(rms)


def decode(data: bytes) -> np.ndarray:
    """Decode any container ffmpeg understands (webm/ogg/mp3/wav/...) to float32 mono at 24kHz."""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1",
             "-ar", str(config.SAMPLE_RATE), "pipe:1"],
            input=data, capture_output=True, timeout=60,
        )
    except FileNotFoundError as e:
        raise RuntimeError("ffmpeg is not installed or not on PATH") from e
    if proc.returncode != 0 or not proc.stdout:
        raise AudioRejected("Could not decode audio file")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def trim_silence(x: np.ndarray, window_db: float = 40.0, frame: int = 480) -> np.ndarray:
    """Drop leading/trailing frames more than `window_db` below the loudest frame (20ms frames)."""
    n = len(x) // frame
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1))
    peak = rms.max()
    if peak < 1e-6:
        return x[:0]
    voiced = np.where(20 * np.log10(np.maximum(rms, 1e-9) / peak) > -window_db)[0]
    pad = 5  # keep ~100ms around speech
    start = max(voiced[0] - pad, 0) * frame
    end = min(voiced[-1] + 1 + pad, n) * frame
    return x[start:end]


def normalize(x: np.ndarray) -> np.ndarray:
    y = x * 10 ** ((config.TARGET_RMS_DBFS - _dbfs(x)) / 20)
    peak = np.abs(y).max()
    if peak > 0.97:
        y = y * (0.97 / peak)
    return y.astype(np.float32)


def preprocess(*clips: bytes) -> np.ndarray:
    """Validate one or more sample clips and join them into a single reference."""
    parts = []
    for data in clips:
        x = decode(data)
        if _dbfs(x) < config.MIN_RMS_DBFS:  # check before normalizing, which would hide quiet input
            raise AudioRejected("Clip is too quiet to produce a usable clone")
        parts.append(trim_silence(x))
    x = np.concatenate(parts)
    duration = len(x) / config.SAMPLE_RATE
    if duration > config.MAX_CLIP_SECONDS:
        raise AudioRejected(f"Samples are longer than {config.MAX_CLIP_SECONDS:.0f}s in total")
    if duration < config.MIN_CLIP_SECONDS:
        raise AudioRejected(
            f"Clip is too short ({duration:.1f}s of speech; need at least {config.MIN_CLIP_SECONDS:.0f}s)")
    return normalize(x)


def write_wav(path, x: np.ndarray):
    sf.write(str(path), x, config.SAMPLE_RATE, subtype="PCM_16")
