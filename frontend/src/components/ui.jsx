import { useEffect, useRef } from "react";
import { useStudio } from "../studio.jsx";

const FILLED = { fill: "currentColor", stroke: "none" };
const ICONS = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" /></>,
  library: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  wave: <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />,
  settings: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.500-3.500" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
  upload: <path d="M12 16V4m0 0L7 9m5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />,
  download: <path d="M12 4v12m0 0-5-5m5 5 5-5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />,
  play: <path d="M7 4.500v15l12-7.500z" {...FILLED} />,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" {...FILLED} /><rect x="14" y="5" width="4" height="14" rx="1" {...FILLED} /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" {...FILLED} />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  heart: <path d="M12 20s-7-4.350-7-10a4 4 0 0 1 7-2.650A4 4 0 0 1 19 10c0 5.650-7 10-7 10z" />,
  check: <path d="m5 12 5 5 9-10" />,
  arrow: <path d="M5 12h14m0 0-6-6m6 6-6 6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.900-3M4 4v4h4M4 13a8 8 0 0 0 14.900 3M20 20v-4h-4" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  disk: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.660 3.580 3 8 3s8-1.340 8-3V6M4 12c0 1.660 3.580 3 8 3s8-1.340 8-3" /></>,
  logout: <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9" />,
  alert: <path d="M12 3 2 20h20zM12 10v4M12 17v.500" />,
};

export const Icon = ({ name, size = 20, fill = "none" }) => (
  <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

export const Spinner = () => <i className="spin" aria-hidden="true" />;

// ---- formatting ----
export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtLength(seconds) {
  const s = Math.round(seconds || 0);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export function fmtBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const fmtDate = (value) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function fmtAgo(value) {
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.floor(mins / 60 / 24)}d ago`;
  return fmtDate(value);
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
export function languageName(code) {
  try {
    return languageNames.of(code) || code;
  } catch {
    return code;
  }
}

export const GENDERS = { female: "Female", male: "Male", other: "Other" };

// ---- building blocks ----
// Play/pause for one track of the shared player; `id` identifies the track.
export function PlayButton({ id, url, label, size = "md" }) {
  const { player } = useStudio();
  const playing = player.key === id && player.playing;
  return (
    <button type="button" className={`play ${size}${playing ? " on" : ""}`} disabled={!url} onClick={() => player.toggle(id, url)}
      aria-label={`${playing ? "Pause" : "Play"} ${label}`} title={url ? undefined : "This audio has expired"}>
      <Icon name={playing ? "pause" : "play"} size={size === "lg" ? 22 : 16} />
    </button>
  );
}

export function Field({ label, error, hint, children }) {
  return (
    <label className={`field${error ? " bad" : ""}`}>
      <span>{label}</span>
      {children}
      {error ? <small className="err" role="alert">{error}</small> : hint && <small>{hint}</small>}
    </label>
  );
}

export const LanguageSelect = ({ languages, ...props }) => (
  <select {...props}>
    {languages.map((l) => <option key={l} value={l}>{languageName(l)}</option>)}
  </select>
);

export const Skeleton = ({ rows = 3, className = "sk-row" }) => (
  <div aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => <div key={i} className={`sk ${className}`} />)}
  </div>
);

export function Empty({ icon, title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-ico"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="empty" role="alert">
      <span className="empty-ico bad"><Icon name="alert" size={22} /></span>
      <h3>Something went wrong</h3>
      <p>{message}</p>
      <button type="button" className="btn" onClick={onRetry}><Icon name="refresh" size={16} /> Try again</button>
    </div>
  );
}

// Modal built on <dialog>, which traps focus and closes on Escape. `busy` blocks closing mid-request.
export function Dialog({ title, onClose, busy, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  const close = () => !busy && onClose();
  return (
    <dialog ref={ref} className="dlg" aria-labelledby="dlg-title" onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => e.target === ref.current && close()}>
      <div className="dlg-body">
        <button type="button" className="icon-btn dlg-x" onClick={close} aria-label="Close dialog"><Icon name="x" size={18} /></button>
        <h2 id="dlg-title">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export function Toasts({ items, onDismiss }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === "error" ? "alert" : "check"} size={16} />
          <span>{t.message}</span>
          <button type="button" className="icon-btn" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}
