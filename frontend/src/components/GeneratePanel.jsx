import { useState } from "react";
import { api, generateAndWait } from "../api.js";

const MAX_CHARS = 1000;

export default function GeneratePanel({ voices, voiceId, onVoice, languages }) {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("en");
  const [status, setStatus] = useState(null); // null | "queued" | "running"
  const [audioId, setAudioId] = useState(null);
  const [error, setError] = useState("");

  const busy = status !== null;
  const canGo = voiceId && text.trim() && !busy;

  async function run() {
    setError("");
    setAudioId(null);
    setStatus("queued");
    try {
      setAudioId(await generateAndWait(voiceId, text.trim(), language, (j) => setStatus(j.status)));
    } catch (e) {
      setError(e.message);
    } finally {
      setStatus(null);
    }
  }

  return (
    <section className="card">
      <h2>3. Generate speech</h2>
      <div className="row">
        <select value={voiceId || ""} onChange={(e) => onVoice(e.target.value)}>
          <option value="" disabled>Choose a voice…</option>
          {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {languages.map((l) => <option key={l}>{l}</option>)}
        </select>
      </div>
      <textarea
        rows={5} maxLength={MAX_CHARS} value={text} placeholder="Type what the cloned voice should say…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row">
        <button onClick={run} disabled={!canGo}>
          {busy ? (status === "queued" ? "Queued…" : "Generating…") : audioId ? "Generate again" : "Generate"}
        </button>
        {busy && <span className="spinner" />}
        <small className="grow right">{text.length}/{MAX_CHARS}</small>
      </div>
      {error && <p className="error">{error}</p>}
      {audioId && (
        <div className="row">
          <audio controls autoPlay src={api.audioUrl(audioId)} />
          <a className="button secondary" href={api.audioUrl(audioId)} download>Download</a>
        </div>
      )}
    </section>
  );
}
