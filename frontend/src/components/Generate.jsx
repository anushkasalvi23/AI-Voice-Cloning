import { useEffect, useRef, useState } from "react";
import { api, generateAndWait } from "../api.js";
import { pageHref, usePlayback, useStudio } from "../studio.jsx";
import { Dialog, Empty, ErrorState, Field, GENDERS, Icon, LanguageSelect, Skeleton, Spinner, fmtClock, languageName } from "./ui.jsx";
import orb from "../assets/ai-assistant.jpeg";

const RESULT = "result"; // player key of the clip on this page

function SaveDialog({ result, onClose, onSaved }) {
  const { languages, toast } = useStudio();
  const [form, setForm] = useState({ name: result.voiceName, gender: "", language: result.language, age: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => { setForm({ ...form, [key]: e.target.value }); setErrors({ ...errors, [key]: undefined }); };

  async function submit(e) {
    e.preventDefault();
    const age = Number(form.age);
    const errs = {};
    if (!form.name.trim()) errs.name = "Enter a name";
    if (!form.gender) errs.gender = "Choose a gender";
    if (!form.age || !Number.isInteger(age) || age < 1 || age > 120) errs.age = "Enter an age between 1 and 120";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      onSaved(await api.saveClip({ audio_id: result.audioId, name: form.name.trim(), gender: form.gender, language: form.language, age }));
    } catch (err) {
      setErrors(err.fields || {});
      toast(err.message, "error");
      setBusy(false);
    }
  }

  return (
    <Dialog title="Save to library" onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate>
        <Field label="Voice name" error={errors.name}>
          <input type="text" autoFocus value={form.name} maxLength={80} onChange={set("name")} aria-invalid={!!errors.name} />
        </Field>
        <div className="form-grid">
          <Field label="Gender" error={errors.gender}>
            <select value={form.gender} onChange={set("gender")} aria-invalid={!!errors.gender}>
              <option value="" disabled>Select…</option>
              {Object.entries(GENDERS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field label="Age" error={errors.age}>
            <input type="number" inputMode="numeric" min={1} max={120} value={form.age} onChange={set("age")} aria-invalid={!!errors.age} />
          </Field>
        </div>
        <Field label="Language" error={errors.language}>
          <LanguageSelect languages={languages} value={form.language} onChange={set("language")} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner /> Saving…</> : "Save clip"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ResultCard({ result, onSave }) {
  const { player } = useStudio();
  const { time, duration } = usePlayback(RESULT);
  const url = api.audioUrl(result.audioId);
  const speaking = player.key === RESULT && player.playing;
  const length = duration || result.duration || 0;

  const seek = (e) => {
    if (player.key !== RESULT) return; // nothing loaded yet: the bar has no track to move in
    player.seek(Number(e.target.value));
  };

  return (
    <div className="card result">
      <div className={`eva-avatar${speaking ? " speaking" : ""}`}>
        <i aria-hidden="true" /><i aria-hidden="true" />
        <img src={orb} alt="Eva, the AI assistant" />
      </div>
      <div className="result-main">
        <b>Eva · {result.voiceName}</b>
        <small className="quote">“{result.text}”</small>
        <div className="transport">
          <button type="button" className={`play lg${speaking ? " on" : ""}`} onClick={() => player.toggle(RESULT, url)} aria-label={speaking ? "Pause" : "Play"}>
            <Icon name={speaking ? "pause" : "play"} size={22} />
          </button>
          <span className="time">{fmtClock(time)}</span>
          <input type="range" min={0} max={length || 1} step={0.01} value={Math.min(time, length)} onChange={seek}
            aria-label="Seek" aria-valuetext={`${fmtClock(time)} of ${fmtClock(length)}`} disabled={player.key !== RESULT} />
          <span className="time">{fmtClock(length)}</span>
        </div>
        <div className="form-actions">
          <a className="btn" href={url} download={`eva-${result.audioId.slice(0, 8)}.wav`}><Icon name="download" size={16} /> Download</a>
          {result.saved
            ? <a className="btn on" href={pageHref("library", "generated")}><Icon name="check" size={16} /> Saved · View in library</a>
            : <button type="button" className="btn primary" onClick={onSave}>Save</button>}
        </div>
      </div>
    </div>
  );
}

export default function Generate() {
  const { voices, clips, activeVoice, setActiveVoiceId, languages, limits, player, toast } = useStudio();
  const [text, setText] = useState("");
  const [language, setLanguage] = useState(activeVoice?.language ?? "en");
  const [status, setStatus] = useState(null); // null | "queued" | "running"
  const [position, setPosition] = useState(0);
  const [result, setResult] = useState(null); // { audioId, duration, voiceName, language, text, saved }
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const run = useRef(null); // AbortController of the generation in flight

  // Leaving the page stops waiting but lets the job finish; it then shows up in recent activity.
  useEffect(() => () => run.current?.abort("detach"), []);

  // A voice speaks its own sample language by default; the user can still pick another.
  const voiceId = activeVoice?.id;
  const voiceLanguage = activeVoice?.language;
  useEffect(() => {
    if (voiceLanguage) setLanguage(voiceLanguage);
  }, [voiceId, voiceLanguage]);

  const busy = status !== null;
  const empty = !text.trim();

  async function generate(e) {
    e.preventDefault();
    if (busy || !activeVoice) return;
    if (empty) return setError("Type some text for the voice to say.");
    setError("");
    player.stop();
    setResult(null);
    setStatus("queued");
    const ctrl = new AbortController();
    run.current = ctrl;
    const request = { voiceName: activeVoice.name, language, text: text.trim() };
    try {
      const job = await generateAndWait(activeVoice.id, request.text, language, {
        signal: ctrl.signal,
        onStatus: (j) => { setStatus(j.status === "running" ? "running" : "queued"); setPosition(j.position); },
      });
      if (ctrl.signal.aborted) return; // finished just as the user cancelled or left
      setResult({ ...request, audioId: job.audio_id, duration: job.duration, saved: false });
      player.toggle(RESULT, api.audioUrl(job.audio_id));
      toast("Speech generated");
    } catch (err) {
      if (ctrl.signal.reason === "detach") return;
      if (err.name === "AbortError") toast("Generation cancelled");
      else {
        setError(err.message);
        toast(err.message, "error");
      }
    } finally {
      if (ctrl.signal.reason !== "detach") setStatus(null);
      run.current = null;
    }
  }

  function saved(clip) {
    clips.setData((list) => [clip, ...list.filter((c) => c.id !== clip.id)]);
    setResult((r) => ({ ...r, saved: true }));
    setSaving(false);
    toast(`Saved “${clip.name}” to your library`);
  }

  if (voices.status === "error") return <div className="card"><ErrorState message={voices.error} onRetry={voices.load} /></div>;
  if (voices.status === "loading") return <div className="card flush"><Skeleton rows={3} /></div>;
  if (!activeVoice)
    return (
      <div className="card">
        <Empty icon="mic" title="Clone a voice first" action={<a className="btn primary" href={pageHref("create")}>Clone a voice</a>}>
          You need at least one cloned voice before you can generate speech.
        </Empty>
      </div>
    );

  return (
    <>
      <header className="page-head">
        <h2>Generate speech</h2>
        <p>Type what you want to hear and Eva will say it in your cloned voice.</p>
      </header>

      <form className="card" onSubmit={generate} noValidate>
        <div className="form-grid">
          <Field label="Voice">
            <select value={activeVoice.id} disabled={busy} onChange={(e) => setActiveVoiceId(e.target.value)}>
              {voices.data.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Language" hint={language !== activeVoice.language ? `This voice was sampled in ${languageName(activeVoice.language)}.` : undefined}>
            <LanguageSelect languages={languages} value={language} disabled={busy} onChange={(e) => setLanguage(e.target.value)} />
          </Field>
        </div>
        <Field label="Text" error={error && empty ? error : undefined}>
          <textarea rows={7} maxLength={limits.maxText} value={text} disabled={busy} placeholder="Type what the cloned voice should say…"
            onChange={(e) => { setText(e.target.value); setError(""); }} aria-describedby="chars" />
        </Field>
        {error && !empty && <p className="banner bad" role="alert">{error}</p>}
        {busy && (
          <div className="progress" role="status">
            <i />
            <small>{status === "queued" ? (position > 0 ? `Queued — ${position} in line…` : "Queued…") : "Generating speech — longer text takes longer."}</small>
          </div>
        )}
        <div className="form-actions">
          <small id="chars" className={`count${text.length >= limits.maxText ? " max" : ""}`}>{text.length} / {limits.maxText}</small>
          {busy && <button type="button" className="btn" onClick={() => run.current?.abort()}>Cancel</button>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? <><Spinner /> Generating…</> : result ? "Generate again" : "Generate"}</button>
        </div>
      </form>

      {result && <ResultCard result={result} onSave={() => setSaving(true)} />}
      {saving && <SaveDialog result={result} onClose={() => setSaving(false)} onSaved={saved} />}
    </>
  );
}
