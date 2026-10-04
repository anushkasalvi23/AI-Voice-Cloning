"""XTTS-v2 wrapper. The model is loaded once (see lifespan in main.py) and kept resident on GPU."""
import os
from pathlib import Path
from typing import Iterator

import numpy as np

from . import config


class Engine:
    def __init__(self):
        os.environ.setdefault("COQUI_TOS_AGREED", "1")  # CPML terms; see plan section 8
        import torch
        from TTS.api import TTS

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = TTS(config.MODEL_NAME).to(self.device).synthesizer.tts_model
        # model.inference()/get_conditioning_latents() carry their own defaults (e.g. repetition_penalty=10),
        # which differ from the settings Coqui tunes for XTTS-v2 and apply only through model.synthesize().
        # A penalty that high makes the decoder avoid repeated sounds, so it stutters and drops words.
        c = self.model.config
        self.voice_settings = {"gpt_cond_len": c.gpt_cond_len, "gpt_cond_chunk_len": c.gpt_cond_chunk_len,
                               "max_ref_length": c.max_ref_len, "sound_norm_refs": c.sound_norm_refs}
        self.gen_settings = {"temperature": c.temperature, "length_penalty": c.length_penalty,
                             "repetition_penalty": c.repetition_penalty, "top_k": c.top_k, "top_p": c.top_p}

    def embed(self, wav_path: Path, out_path: Path):
        """Compute and cache the speaker conditioning latents for a reference clip."""
        gpt_cond, spk = self.model.get_conditioning_latents(
            audio_path=[str(wav_path)], **self.voice_settings)
        self.torch.save({"gpt_cond_latent": gpt_cond.cpu(), "speaker_embedding": spk.cpu()}, out_path)

    def _load(self, emb_path: Path):
        d = self.torch.load(emb_path, map_location=self.device)
        return d["gpt_cond_latent"].to(self.device), d["speaker_embedding"].to(self.device)

    def synthesize(self, text: str, language: str, emb_path: Path) -> np.ndarray:
        gpt_cond, spk = self._load(emb_path)
        with self.torch.inference_mode():
            out = self.model.inference(text, language, gpt_cond, spk, enable_text_splitting=True, **self.gen_settings)
        return np.asarray(out["wav"], dtype=np.float32)

    def stream(self, text: str, language: str, emb_path: Path) -> Iterator[np.ndarray]:
        gpt_cond, spk = self._load(emb_path)
        with self.torch.inference_mode():
            for chunk in self.model.inference_stream(
                    text, language, gpt_cond, spk, enable_text_splitting=True, **self.gen_settings):
                yield chunk.cpu().numpy().astype(np.float32)

    def free_cache(self):
        if self.device == "cuda":
            self.torch.cuda.empty_cache()


class FakeEngine:
    """Deterministic stand-in so the API can be exercised without a GPU or model download."""
    device = "fake"

    def embed(self, wav_path, out_path):
        Path(out_path).write_bytes(b"fake-embedding")

    def synthesize(self, text, language, emb_path):
        secs = 0.5 + 0.02 * len(text)
        t = np.linspace(0, secs, int(config.SAMPLE_RATE * secs), False)
        return (0.2 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)

    def stream(self, text, language, emb_path):
        w = self.synthesize(text, language, emb_path)
        for i in range(0, len(w), 4800):
            yield w[i:i + 4800]

    def free_cache(self):
        pass


def load_engine():
    return FakeEngine() if config.FAKE_ENGINE else Engine()
