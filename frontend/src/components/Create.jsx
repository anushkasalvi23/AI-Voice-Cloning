import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { pageHref, useStudio } from "../studio.jsx";
import { ActionCard } from "./Home.jsx";
import { Field, Icon, LanguageSelect, PlayButton, Spinner, fmtBytes, fmtClock } from "./ui.jsx";

const MIN_SECONDS = 10; // what the guidance card asks for; the backend's own floor is lower
const BEST_SECONDS = 180;
const EXTENSIONS = ["wav", "mp3", "m4a", "webm", "ogg", "flac", "aac"];

// Phonetically varied, roughly 35 seconds at a natural reading pace.
const SCRIPT =
  "The quick morning breeze whispered through the orange grove as Julia zipped her jacket and stepped outside. " +
  "She measured five cups of flour, cracked two fresh eggs, and hummed a cheerful tune while the kettle hissed on the stove. " +
  "Beyond the garden, a blue heron stood perfectly still, watching the shallow water for fish. " +
  "Would the weather hold until evening? Nobody could say for sure. " +
  "Thick clouds drifted north, yet a thin beam of sunshine touched the old church bell, which rang exactly once, " +
  "then faded into a quiet, thoughtful pause.";

const MIC_ERRORS = {
  NotAllowedError: "Microphone access was blocked. Allow it for this site in your browser's address bar, then try again.",
  NotFoundError: "No microphone was found. Connect one and try again.",
  NotReadableError: "The microphone is in use by another app. Close it and try again.",
};

const OPTIONS = [
  { page: "generate", art: "g2", icon: "wave", title: "Generate speech", text: "Turn text into audio with a voice you already cloned." },
  { page: "library", art: "g1", icon: "library", title: "Voice Library", text: "Play, rename, favorite or delete your voices." },
  { page: "settings", art: "g3", icon: "disk", title: "Storage & data", text: "See how much space your samples and clips use." },
];

let sampleId = 0;

// Length of an audio file in seconds, or null when the browser cannot tell (the backend still validates it).
const readDuration = (url) =>
  new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => resolve(null);
    a.src = url;
  });

function RecorderPanel({ maxSeconds, onUse, onClose }) {
  const { player } = useStudio();
  const [phase, setPhase] = useState("requesting"); // requesting | recording | paused | review | error
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState(null); // { blob, url, seconds }
  const canvas = useRef(null);
  const session = useRef(null);
  const alive = useRef(true);
  const unused = useRef(null); // object URL of a take that was never handed to the parent

  const release = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    cancelAnimationFrame(s.raf);
    s.stream.getTracks().forEach((t) => t.stop());
    s.ctx.close();
  }, []);

  const start = useCallback(async () => {
    setError("");
    setElapsed(0);
    setPhase("requesting");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Recording is not supported in this browser. Upload an audio file instead.");
      return setPhase("error");
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError(MIC_ERRORS[e.name] || `Microphone unavailable: ${e.message}`);
      return setPhase("error");
    }
    if (!alive.current) return stream.getTracks().forEach((t) => t.stop());

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const mr = new MediaRecorder(stream);
    const chunks = [];
    // `ran` is the time recorded before the last pause; `since` is when the current stretch began.
    const s = { stream, ctx, mr, raf: 0, ran: 0, since: performance.now(), bars: [], peak: 0, lastBar: 0 };
    const seconds = () => (s.ran + (mr.state === "recording" ? performance.now() - s.since : 0)) / 1000;
    const bank = () => { if (mr.state === "recording") s.ran += performance.now() - s.since; };
    s.pause = () => { bank(); mr.pause(); setPhase("paused"); };
    s.resume = () => { s.since = performance.now(); mr.resume(); setPhase("recording"); };
    s.stop = () => { if (mr.state !== "inactive") { bank(); mr.stop(); } };

    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => {
      if (session.current !== s) return; // released on unmount: drop the take
      release();
      const blob = new Blob(chunks, { type: mr.mimeType });
      const url = URL.createObjectURL(blob);
      unused.current = url;
      setTake({ blob, url, seconds: s.ran / 1000, ext: mr.mimeType.includes("mp4") ? "m4a" : mr.mimeType.includes("ogg") ? "ogg" : "webm" });
      setElapsed(s.ran / 1000);
      setPhase("review");
    };

    const draw = () => {
      s.raf = requestAnimationFrame(draw);
      const secs = seconds();
      setElapsed(Math.floor(secs * 10) / 10);
      if (secs >= maxSeconds) return s.stop();
      if (mr.state !== "recording") return;
      analyser.getByteTimeDomainData(buf);
      for (const v of buf) s.peak = Math.max(s.peak, Math.abs(v - 128) / 128);
      const now = performance.now();
      if (now - s.lastBar > 60) {
        s.bars.push(s.peak);
        s.peak = 0;
        s.lastBar = now;
      }
      const c = canvas.current;
      if (!c) return;
      const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = s.color ??= getComputedStyle(c).color;
      const bars = s.bars.slice(-Math.floor(w / 5));
      bars.forEach((level, i) => {
        const bar = Math.max(2, Math.min(1, level * 1.4) * h);
        g.fillRect(w - (bars.length - i) * 5, (h - bar) / 2, 3, bar);
      });
    };

    session.current = s;
    mr.start();
    setPhase("recording");
    draw();
  }, [maxSeconds, release]);

  const dropTake = useCallback(() => {
    player.stop();
    if (unused.current) URL.revokeObjectURL(unused.current);
    unused.current = null;
    setTake(null);
  }, [player]);

  useEffect(() => {
    alive.current = true;
    start();
    return () => {
      alive.current = false;
      release();
      if (unused.current) URL.revokeObjectURL(unused.current);
    };
  }, [start, release]);

  const use = () => {
    player.stop();
    unused.current = null; // the parent owns the URL from here
    onUse(take);
  };

  const live = phase === "recording" || phase === "paused";
  return (
    <div className="drop recorder">
      {phase === "requesting" && <div className="drop-copy"><Spinner /><small>Waiting for microphone access…</small></div>}

      {phase === "error" && (
        <div className="drop-copy" role="alert">
          <span className="empty-ico bad"><Icon name="mic" size={22} /></span>
          <b>Can't record right now</b>
          <small>{error}</small>
        </div>
      )}

      {live && (
        <>
          <div className="rec-head">
            <span className={`rec-dot${phase === "paused" ? " paused" : ""}`} aria-hidden="true" />
            <b role="timer" aria-label="Recording time">{fmtClock(elapsed)}</b>
            <small>{phase === "paused" ? "Paused" : "Recording — read this aloud at a natural pace"}</small>
          </div>
          <p className="script">{SCRIPT}</p>
          <canvas ref={canvas} className="wave-canvas" aria-hidden="true" />
        </>
      )}

      {phase === "review" && take && (
        <div className="drop-copy">
          <PlayButton id="take" url={take.url} label="your recording" size="lg" />
          <b>{fmtClock(take.seconds)} recorded</b>
          <small>Listen back, then add it to your samples or record again.</small>
        </div>
      )}

      <div className="drop-actions">
        {live && (
          <>
            {phase === "recording"
              ? <button type="button" onClick={() => session.current?.pause()}><Icon name="pause" size={16} /> Pause</button>
              : <button type="button" onClick={() => session.current?.resume()}><Icon name="mic" size={16} /> Resume</button>}
            <button type="button" onClick={() => session.current?.stop()}><Icon name="stop" size={16} /> Stop</button>
          </>
        )}
        {phase === "review" && (
          <>
            <button type="button" onClick={() => { dropTake(); start(); }}><Icon name="refresh" size={16} /> Re-record</button>
            <button type="button" onClick={use}><Icon name="check" size={16} /> Use recording</button>
          </>
        )}
        {phase === "error" && <button type="button" onClick={start}><Icon name="refresh" size={16} /> Try again</button>}
        {!live && <button type="button" onClick={() => { player.stop(); onClose(); }}><Icon name="x" size={16} /> {phase === "review" ? "Discard" : "Cancel"}</button>}
      </div>
    </div>
  );
}

export default function Create() {
  const { voices, languages, limits, player, toast, setActiveVoiceId, navigate } = useStudio();
  const [samples, setSamples] = useState([]); // { id, blob, name, size, url, seconds }
  const [recording, setRecording] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [form, setForm] = useState({ name: "", language: "en", consent: false });
  const [status, setStatus] = useState({ state: "idle" }); // idle | loading | error | success
  const fileInput = useRef(null);
  const held = useRef(samples);
  held.current = samples;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      held.current.forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, []);

  const busy = status.state === "loading";
  const total = samples.reduce((t, s) => t + (s.seconds || 0), 0);
  const unknown = samples.some((s) => s.seconds == null);
  const tooShort = samples.length > 0 && !unknown && total < MIN_SECONDS;
  const tooLong = total > limits.maxClipSeconds;
  const canSubmit = samples.length > 0 && form.name.trim() && form.consent && !tooShort && !tooLong && !busy;

  async function addFiles(files) {
    const added = [];
    for (const f of files) {
      if (!EXTENSIONS.includes(f.name.split(".").pop().toLowerCase())) {
        toast(`${f.name}: unsupported file type. Use ${EXTENSIONS.join(", ").toUpperCase()}.`, "error");
      } else if (f.size > limits.maxUploadBytes) {
        toast(`${f.name} is larger than ${fmtBytes(limits.maxUploadBytes)}.`, "error");
      } else {
        const url = URL.createObjectURL(f);
        added.push({ id: ++sampleId, blob: f, name: f.name, size: f.size, url, seconds: await readDuration(url) });
      }
    }
    if (!mounted.current) return added.forEach((s) => URL.revokeObjectURL(s.url));
    if (added.length) {
      setSamples((list) => [...list, ...added]);
      setStatus({ state: "idle" });
    }
  }

  function addTake(take) {
    const n = samples.filter((s) => s.name.startsWith("Recording ")).length + 1;
    setSamples((list) => [...list, { id: ++sampleId, blob: take.blob, name: `Recording ${n}.${take.ext}`, size: take.blob.size, url: take.url, seconds: take.seconds }]);
    setRecording(false);
    setStatus({ state: "idle" });
  }

  function remove(sample) {
    if (player.key === `sample:${sample.id}`) player.stop();
    URL.revokeObjectURL(sample.url);
    setSamples((list) => list.filter((s) => s.id !== sample.id));
  }

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    player.stop();
    setStatus({ state: "loading" });
    try {
      const voice = await api.createVoice({ samples, name: form.name.trim(), language: form.language });
      samples.forEach((s) => URL.revokeObjectURL(s.url));
      setSamples([]);
      setForm((f) => ({ ...f, name: "", consent: false }));
      voices.setData((list) => [voice, ...list]);
      setStatus({ state: "success", voice });
      toast(`Voice “${voice.name}” is ready`);
    } catch (err) {
      setStatus({ state: "error", message: err.message });
      toast(err.message, "error");
    }
  }

  const drop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (!busy) addFiles([...e.dataTransfer.files]);
  };

  return (
    <>
      <header className="page-head">
        <h2>Instant Voice Cloning</h2>
        <p>Clone your voice with only a few seconds of audio</p>
      </header>

      <div className="clone">
        {recording ? (
          <RecorderPanel maxSeconds={limits.maxClipSeconds} onUse={addTake} onClose={() => setRecording(false)} />
        ) : (
          <div className={`drop${dragging ? " over" : ""}`} onDrop={drop} onDragLeave={() => setDragging(false)}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}>
            <div className="drop-copy">
              <b>Upload audio files or record audio</b>
              <small>Max {Math.round(limits.maxUploadBytes / 1024 / 1024)}MB per file · {EXTENSIONS.join(", ").toUpperCase()}</small>
            </div>
            <div className="drop-actions">
              <button type="button" disabled={busy} onClick={() => fileInput.current.click()}><Icon name="upload" size={18} /> Upload files</button>
              <button type="button" disabled={busy} onClick={() => { player.stop(); setRecording(true); }}><Icon name="mic" size={18} /> Record audio</button>
            </div>
            <input ref={fileInput} type="file" hidden multiple accept={EXTENSIONS.map((x) => `.${x}`).join(",")}
              onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} />
          </div>
        )}

        <div className="guide">
          <div className="guide-orb">
            <span className="guide-mark"><b>Min</b><small>10 sec</small></span>
            <i className="orb" aria-hidden="true" />
            <span className="guide-mark"><b>Best</b><small>3 min</small></span>
          </div>
          <p>For best quality of the cloned voice, provide 3 minutes of samples</p>
          <div className="meter" role="progressbar" aria-label="Sample audio collected" aria-valuemin={0} aria-valuemax={BEST_SECONDS}
            aria-valuenow={Math.min(Math.round(total), BEST_SECONDS)} aria-valuetext={`${fmtClock(total)} of samples collected`}>
            <i className={total >= MIN_SECONDS ? "ok" : ""} style={{ width: `${Math.min(100, (total / BEST_SECONDS) * 100)}%` }} />
            <span className="meter-min" style={{ left: `${(MIN_SECONDS / BEST_SECONDS) * 100}%` }} />
          </div>
          <small>{samples.length ? `${fmtClock(total)}${unknown ? "+" : ""} collected from ${samples.length} sample${samples.length > 1 ? "s" : ""}` : "No samples added yet"}</small>
        </div>
      </div>

      {status.state === "success" ? (
        <div className="card success" role="status">
          <span className="empty-ico good"><Icon name="check" size={22} /></span>
          <h3>“{status.voice.name}” is ready</h3>
          <p>Your voice was cloned from {fmtClock(status.voice.duration)} of audio.</p>
          <div className="form-actions center">
            <button type="button" className="btn primary" onClick={() => { setActiveVoiceId(status.voice.id); navigate("generate"); }}>
              Generate with this voice <Icon name="arrow" size={16} />
            </button>
            <a className="btn" href={pageHref("library")}>View in library</a>
            <button type="button" className="btn" onClick={() => setStatus({ state: "idle" })}>Clone another</button>
          </div>
        </div>
      ) : samples.length > 0 && (
        <form className="card" onSubmit={submit} noValidate>
          <h3 className="card-title">Samples</h3>
          <ul className="rows inset">
            {samples.map((s) => (
              <li key={s.id} className="row">
                <PlayButton id={`sample:${s.id}`} url={s.url} label={s.name} />
                <div className="row-main"><b>{s.name}</b><small>{fmtBytes(s.size)}</small></div>
                <span className="row-meta">{s.seconds == null ? "—" : fmtClock(s.seconds)}</span>
                <button type="button" className="icon-btn" disabled={busy} onClick={() => remove(s)} aria-label={`Remove ${s.name}`}><Icon name="trash" size={18} /></button>
              </li>
            ))}
          </ul>
          {tooShort && <p className="banner bad" role="alert">Add at least {MIN_SECONDS} seconds of audio in total — you have {fmtClock(total)}.</p>}
          {tooLong && <p className="banner bad" role="alert">Samples add up to more than {Math.round(limits.maxClipSeconds / 60)} minutes. Remove some to continue.</p>}

          <div className="form-grid">
            <Field label="Voice name">
              <input type="text" value={form.name} maxLength={80} placeholder="e.g. My narration voice" disabled={busy}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Language of the samples">
              <LanguageSelect languages={languages} value={form.language} disabled={busy} onChange={(e) => setForm({ ...form, language: e.target.value })} />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.consent} disabled={busy} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
            I confirm I have the right to clone this voice.
          </label>

          {status.state === "error" && <p className="banner bad" role="alert">{status.message}</p>}
          {busy && (
            <div className="progress" role="progressbar" aria-label="Creating voice">
              <i />
              <small>Uploading samples and extracting the voice — this can take a little while.</small>
            </div>
          )}
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={!canSubmit}>{busy ? <><Spinner /> Creating voice…</> : "Create voice"}</button>
          </div>
        </form>
      )}

      <section aria-labelledby="other">
        <h3 id="other" className="section-title">Other options</h3>
        <div className="actions">{OPTIONS.map((o) => <ActionCard key={o.page} {...o} />)}</div>
      </section>
    </>
  );
}
