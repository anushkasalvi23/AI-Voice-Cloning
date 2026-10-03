import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const MIN_SECONDS = 5;

export default function Recorder({ languages, onSaved }) {
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [clip, setClip] = useState(null); // { blob, filename, url }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rec = useRef(null);

  useEffect(() => () => rec.current?.cleanup?.(), []);
  useEffect(() => () => clip && URL.revokeObjectURL(clip.url), [clip]);

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const mr = new MediaRecorder(stream);
      const chunks = [];
      const t0 = Date.now();
      let raf;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(peak / 128);
        setElapsed((Date.now() - t0) / 1000);
        raf = requestAnimationFrame(tick);
      };
      const cleanup = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
      };
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: mr.mimeType });
        setClip({ blob, filename: "recording.webm", url: URL.createObjectURL(blob), seconds: (Date.now() - t0) / 1000 });
        setRecording(false);
        setLevel(0);
      };
      rec.current = { mr, cleanup };
      mr.start();
      setClip(null);
      setRecording(true);
      tick();
    } catch (e) {
      setError(`Microphone unavailable: ${e.message}`);
    }
  }

  function stop() {
    rec.current?.mr.stop();
  }

  function onFile(e) {
    const f = e.target.files[0];
    if (f) setClip({ blob: f, filename: f.name, url: URL.createObjectURL(f), seconds: null });
  }

  const tooShort = clip?.seconds != null && clip.seconds < MIN_SECONDS;
  const canSave = consent && name.trim() && clip && !tooShort && !busy;

  async function save() {
    setBusy(true);
    setError("");
    try {
      const v = await api.createVoice({ blob: clip.blob, filename: clip.filename, name: name.trim(), language });
      setClip(null);
      setName("");
      onSaved(v);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>1. Record a voice</h2>
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        I confirm I have the right to clone this voice.
      </label>

      <div className="row">
        <input placeholder="Voice name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {languages.map((l) => <option key={l}>{l}</option>)}
        </select>
      </div>

      <div className="row">
        {recording ? (
          <button className="danger" onClick={stop}>Stop ({elapsed.toFixed(1)}s)</button>
        ) : (
          <button onClick={start} disabled={!consent}>● Record</button>
        )}
        <label className={`button secondary ${consent ? "" : "disabled"}`}>
          Upload file
          <input type="file" accept="audio/*" hidden disabled={!consent} onChange={onFile} />
        </label>
        <div className="meter"><div style={{ width: `${Math.min(level * 140, 100)}%` }} /></div>
      </div>
      <p className="hint">Record at least {MIN_SECONDS}s of clear speech in a quiet room. 10–20s gives the best clone.</p>

      {clip && (
        <div className="row">
          <audio controls src={clip.url} />
          <button onClick={save} disabled={!canSave}>{busy ? "Saving…" : "Save voice"}</button>
        </div>
      )}
      {tooShort && <p className="error">Recording is too short — need at least {MIN_SECONDS}s.</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
