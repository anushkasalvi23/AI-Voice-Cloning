import { useState } from "react";
import { api } from "../api.js";
import { useResource, useStudio } from "../studio.jsx";
import { Dialog, ErrorState, Field, Icon, Spinner, fmtBytes } from "./ui.jsx";

const CONFIRM = "DELETE";
const CATEGORIES = [
  { id: "recordings", label: "Voice recordings" },
  { id: "embeddings", label: "Speaker embeddings" },
  { id: "generated", label: "Generated audio" },
];

export default function Settings() {
  const { voices, clips, setActiveVoiceId, player, toast } = useStudio();
  const stats = useResource(api.stats, null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const s = stats.data;
  const total = s?.storage.total ?? 0;

  async function deleteAll(e) {
    e.preventDefault();
    if (typed !== CONFIRM) return;
    setBusy(true);
    player.stop();
    try {
      const removed = await api.deleteAllData();
      voices.setData(() => []);
      clips.setData(() => []);
      setActiveVoiceId(null);
      await stats.load();
      toast(`Deleted ${removed.voices} voice${removed.voices === 1 ? "" : "s"} and ${removed.clips} clip${removed.clips === 1 ? "" : "s"}`);
      setConfirming(false);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <h2>Settings</h2>
        <p>Storage used by your voices and clips, and control over your data.</p>
      </header>

      <section className="card" aria-labelledby="usage">
        <h3 id="usage" className="card-title">Storage &amp; data usage</h3>
        {stats.status === "error" ? (
          <ErrorState message={stats.error} onRetry={stats.load} />
        ) : !s ? (
          <div aria-busy="true"><div className="sk sk-tile" /><div className="sk sk-row" /></div>
        ) : (
          <>
            <div className="tiles three">
              <div className="tile"><span className="tile-label"><Icon name="mic" size={16} /> Recorded voices</span><b>{s.voices}</b></div>
              <div className="tile"><span className="tile-label"><Icon name="wave" size={16} /> Generated clips</span><b>{s.clips}</b><small>{s.saved_clips} saved to library</small></div>
              <div className="tile"><span className="tile-label"><Icon name="disk" size={16} /> Total size on disk</span><b>{fmtBytes(total)}</b></div>
            </div>
            <div className="usage" role="img" aria-label={`Storage: ${CATEGORIES.map((c) => `${c.label} ${fmtBytes(s.storage[c.id])}`).join(", ")}`}>
              {total > 0 && CATEGORIES.map((c) => s.storage[c.id] > 0 && (
                <i key={c.id} className={c.id} style={{ flexGrow: s.storage[c.id] }} title={`${c.label}: ${fmtBytes(s.storage[c.id])}`} />
              ))}
            </div>
            <ul className="legend">
              {CATEGORIES.map((c) => (
                <li key={c.id}>
                  <i className={c.id} aria-hidden="true" />
                  <span>{c.label}</span>
                  <b>{fmtBytes(s.storage[c.id])}</b>
                  <small>{total ? Math.round((s.storage[c.id] / total) * 100) : 0}%</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card danger-zone" aria-labelledby="danger">
        <h3 id="danger" className="card-title"><Icon name="alert" size={18} /> Danger zone</h3>
        <div className="danger-row">
          <div>
            <b>Delete all data and history</b>
            <p>Permanently removes every recorded voice, speaker embedding, generated clip and their records. This cannot be undone.</p>
          </div>
          <button type="button" className="btn danger" onClick={() => { setTyped(""); setConfirming(true); }}>Delete all data</button>
        </div>
      </section>

      {confirming && (
        <Dialog title="Delete all data?" onClose={() => setConfirming(false)} busy={busy}>
          <form onSubmit={deleteAll}>
            <p>
              This permanently deletes {s ? `${s.voices} voice${s.voices === 1 ? "" : "s"} and ${s.clips} generated clip${s.clips === 1 ? "" : "s"}` : "all your voices and clips"},
              including the audio files and speaker embeddings. Your account stays.
            </p>
            <Field label={`Type ${CONFIRM} to confirm`}>
              <input type="text" autoFocus autoComplete="off" spellCheck={false} value={typed} disabled={busy} onChange={(e) => setTyped(e.target.value)} />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn danger" disabled={busy || typed !== CONFIRM}>{busy ? <><Spinner /> Deleting…</> : "Delete everything"}</button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
