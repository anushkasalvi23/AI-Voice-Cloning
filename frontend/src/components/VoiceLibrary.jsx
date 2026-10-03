import { useState } from "react";
import { api } from "../api.js";

export default function VoiceLibrary({ voices, selectedId, onSelect, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  async function rename(id) {
    try {
      if (draft.trim()) await api.renameVoice(id, draft.trim());
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove(v) {
    if (!confirm(`Delete voice "${v.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteVoice(v.id);
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="card">
      <h2>2. Voice library</h2>
      {voices.length === 0 && <p className="hint">No voices yet — record one above.</p>}
      <ul className="voices">
        {voices.map((v) => (
          <li key={v.id} className={v.id === selectedId ? "selected" : ""}>
            <input type="radio" name="voice" checked={v.id === selectedId} onChange={() => onSelect(v.id)} />
            <div className="grow">
              {editing === v.id ? (
                <input
                  autoFocus value={draft} maxLength={80}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => rename(v.id)}
                  onKeyDown={(e) => e.key === "Enter" && rename(v.id)}
                />
              ) : (
                <strong>{v.name}</strong>
              )}
              <small>{v.language} · {v.duration.toFixed(1)}s · {v.created_at.slice(0, 10)}</small>
            </div>
            <audio controls preload="none" src={api.voiceAudioUrl(v.id)} />
            <button className="secondary" onClick={() => { setEditing(v.id); setDraft(v.name); }}>Rename</button>
            <button className="danger" onClick={() => remove(v)}>Delete</button>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
