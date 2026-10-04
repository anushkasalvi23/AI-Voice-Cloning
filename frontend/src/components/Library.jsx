import { useMemo, useState } from "react";
import { api } from "../api.js";
import { pageHref, useStudio } from "../studio.jsx";
import { Dialog, Empty, ErrorState, Field, GENDERS, Icon, PlayButton, Skeleton, Spinner, fmtClock, fmtDate, languageName } from "./ui.jsx";

const TABS = [
  { id: "voices", label: "My Voices" },
  { id: "generated", label: "Generated" },
  { id: "favorites", label: "Favorites" },
];

const SORTS = {
  newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
  oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
  name: (a, b) => a.name.localeCompare(b.name),
};

const EMPTY = {
  voices: { icon: "mic", title: "No voices yet", text: "Clone a voice from a short recording to get started.", page: "create", cta: "Clone a voice" },
  generated: { icon: "wave", title: "No saved clips yet", text: "Generate speech and press Save to keep a clip here.", page: "generate", cta: "Generate speech" },
  favorites: { icon: "heart", title: "No favorites yet", text: "Tap the heart on a voice or clip to pin it here." },
};

// Voices and saved clips share one row shape so the three tabs can filter and sort them together.
const voiceItem = (v) => ({ ...v, kind: "voice", key: `voice:${v.id}`, voice_id: v.id, favorite: !!v.favorite });
const clipItem = (c) => ({ ...c, kind: "clip", key: `clip:${c.id}` });

export default function Library() {
  const { voices, clips, activeVoice, setActiveVoiceId, languages, player, toast, navigate, sub, query, setQuery } = useStudio();
  const tab = TABS.some((t) => t.id === sub) ? sub : "voices";
  const [gender, setGender] = useState("");
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState("newest");
  const [removing, setRemoving] = useState(null); // item awaiting delete confirmation
  const [renaming, setRenaming] = useState(null); // { item, name }
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const all = { voices: voices.data.map(voiceItem), generated: clips.data.map(clipItem) };
    all.favorites = [...all.voices, ...all.generated].filter((i) => i.favorite);
    const q = query.trim().toLowerCase();
    // Voices carry no gender, so that filter is not offered (or applied) on the My Voices tab.
    const match = (id) => (i) =>
      (!q || [i.name, i.voice_name, i.text].some((t) => t?.toLowerCase().includes(q))) &&
      (!language || i.language === language) &&
      (!gender || id === "voices" || i.gender === gender);
    return Object.fromEntries(Object.entries(all).map(([id, items]) => [id, { total: items.length, items: items.filter(match(id)).sort(SORTS[sort]) }]));
  }, [voices.data, clips.data, query, language, gender, sort]);

  const sources = tab === "voices" ? [voices] : tab === "generated" ? [clips] : [voices, clips];
  const failed = sources.find((s) => s.status === "error");
  const loading = sources.some((s) => s.status === "loading");
  const { items, total } = groups[tab];

  async function toggleFavorite(item) {
    const favorite = !item.favorite;
    const [store, call] = item.kind === "voice" ? [voices, api.updateVoice] : [clips, api.updateClip];
    const apply = (value) => store.setData((list) => list.map((x) => (x.id === item.id ? { ...x, favorite: value } : x)));
    apply(favorite); // optimistic; rolled back if the backend refuses
    try {
      await call(item.id, { favorite });
    } catch (e) {
      apply(item.favorite);
      toast(e.message, "error");
    }
  }

  function select(item) {
    setActiveVoiceId(item.voice_id);
    toast(`“${item.kind === "voice" ? item.name : item.voice_name}” is now the active voice`);
  }

  async function confirmDelete() {
    const item = removing;
    setBusy(true);
    try {
      if (player.key === item.key) player.stop();
      if (item.kind === "voice") {
        await api.deleteVoice(item.id);
        voices.setData((list) => list.filter((v) => v.id !== item.id));
        clips.setData((list) => list.filter((c) => c.voice_id !== item.id)); // the backend removes its clips too
      } else {
        await api.deleteClip(item.id);
        clips.setData((list) => list.filter((c) => c.id !== item.id));
      }
      toast(`Deleted “${item.name}”`);
      setRemoving(null);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function rename(e) {
    e.preventDefault();
    const name = renaming.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      const updated = await api.updateVoice(renaming.item.id, { name });
      voices.setData((list) => list.map((v) => (v.id === updated.id ? updated : v)));
      clips.setData((list) => list.map((c) => (c.voice_id === updated.id ? { ...c, voice_name: updated.name } : c)));
      toast("Voice renamed");
      setRenaming(null);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const empty = EMPTY[tab];
  const clipCount = removing?.kind === "voice" ? clips.data.filter((c) => c.voice_id === removing.id).length : 0;

  return (
    <>
      <header className="page-head">
        <h2>Voice Library</h2>
        <p>Your cloned voices and the clips you saved.</p>
      </header>

      <div className="tabs" role="tablist" aria-label="Library sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => navigate("library", t.id)}>
            {t.label} <em>{groups[t.id].items.length}</em>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={17} />
          <input type="search" placeholder="Search by name or text…" aria-label="Search library" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {tab !== "voices" && (
          <select aria-label="Filter by gender" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">All genders</option>
            {Object.entries(GENDERS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        )}
        <select aria-label="Filter by language" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">All languages</option>
          {languages.map((l) => <option key={l} value={l}>{languageName(l)}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>

      <div className="card flush" role="tabpanel">
        {failed ? (
          <ErrorState message={failed.error} onRetry={() => sources.forEach((s) => s.load())} />
        ) : loading ? (
          <Skeleton rows={4} />
        ) : total === 0 ? (
          <Empty icon={empty.icon} title={empty.title} action={empty.page && <a className="btn primary" href={pageHref(empty.page)}>{empty.cta}</a>}>
            {empty.text}
          </Empty>
        ) : items.length === 0 ? (
          <Empty icon="search" title="No matches"
            action={<button type="button" className="btn" onClick={() => { setQuery(""); setGender(""); setLanguage(""); }}>Clear filters</button>}>
            Nothing in this tab matches your search and filters.
          </Empty>
        ) : (
          <ul className="rows">
            {items.map((item) => {
              const active = activeVoice?.id === item.voice_id;
              return (
                <li key={item.key} className={`row${item.kind === "voice" && active ? " selected" : ""}`}>
                  <PlayButton id={item.key} url={api.mediaUrl(item.audio_url)} label={item.name} />
                  <div className="row-main">
                    <b>{item.name}</b>
                    {item.kind === "voice" ? (
                      <small>{languageName(item.language)} · {fmtClock(item.duration)} sample · {fmtDate(item.created_at)}</small>
                    ) : (
                      <small>
                        {GENDERS[item.gender]} · {languageName(item.language)} · Age {item.age} · {fmtDate(item.created_at)} · {fmtClock(item.duration)}
                        {item.voice_name && item.voice_name !== item.name && ` · from ${item.voice_name}`}
                      </small>
                    )}
                    {item.kind === "clip" && <small className="quote">“{item.text}”</small>}
                  </div>
                  <div className="row-actions">
                    <button type="button" className={`btn small${active ? " on" : ""}`} onClick={() => select(item)} aria-pressed={active}
                      aria-label={`Use ${item.kind === "voice" ? item.name : item.voice_name} for generation`}>
                      {active ? <><Icon name="check" size={14} /> Active</> : "Select"}
                    </button>
                    <button type="button" className={`icon-btn heart${item.favorite ? " on" : ""}`} onClick={() => toggleFavorite(item)}
                      aria-pressed={item.favorite} aria-label={`${item.favorite ? "Remove" : "Add"} ${item.name} ${item.favorite ? "from" : "to"} favorites`}>
                      <Icon name="heart" size={18} fill={item.favorite ? "currentColor" : "none"} />
                    </button>
                    {item.kind === "voice" && (
                      <button type="button" className="icon-btn" onClick={() => setRenaming({ item, name: item.name })} aria-label={`Rename ${item.name}`}>
                        <Icon name="edit" size={18} />
                      </button>
                    )}
                    <button type="button" className="icon-btn danger" onClick={() => setRemoving(item)} aria-label={`Delete ${item.name}`}>
                      <Icon name="trash" size={18} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {removing && (
        <Dialog title={`Delete “${removing.name}”?`} onClose={() => setRemoving(null)} busy={busy}>
          <p>
            {removing.kind === "voice"
              ? `This permanently deletes the voice, its sample audio${clipCount ? ` and ${clipCount} saved clip${clipCount > 1 ? "s" : ""} made with it` : ""}.`
              : "This permanently deletes the saved clip and its audio."}{" "}
            This cannot be undone.
          </p>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setRemoving(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn danger" onClick={confirmDelete} disabled={busy}>{busy ? <><Spinner /> Deleting…</> : "Delete"}</button>
          </div>
        </Dialog>
      )}

      {renaming && (
        <Dialog title="Rename voice" onClose={() => setRenaming(null)} busy={busy}>
          <form onSubmit={rename}>
            <Field label="Voice name">
              <input type="text" autoFocus value={renaming.name} maxLength={80} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setRenaming(null)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy || !renaming.name.trim()}>{busy ? <><Spinner /> Saving…</> : "Save"}</button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
