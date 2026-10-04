import { useCallback, useEffect, useMemo, useState } from "react";
import { api, setUnauthorizedHandler } from "../api.js";
import { StudioContext, initials, pageHref, usePlayer, useResource, useStored } from "../studio.jsx";
import { Logo } from "./Landing.jsx";
import { Icon, Toasts } from "./ui.jsx";
import Home from "./Home.jsx";
import Create from "./Create.jsx";
import Library from "./Library.jsx";
import Generate from "./Generate.jsx";
import Settings from "./Settings.jsx";
import Profile from "./Profile.jsx";
import "../dashboard.css";

const PAGES = {
  home: { label: "Home", title: "Home", icon: "home", view: Home },
  create: { label: "Create", title: "Voice Creation", icon: "mic", view: Create },
  library: { label: "Voice Library", title: "Voice Library", icon: "library", view: Library },
  generate: { label: "Generate", title: "Generate", icon: "wave", view: Generate },
  settings: { label: "Settings", title: "Settings", icon: "settings", view: Settings },
  profile: { label: "Profile", title: "Profile", icon: "user", view: Profile },
};
const MAIN_NAV = ["home", "create", "library", "generate"];
const FOOT_NAV = ["settings", "profile"];
const MOBILE = "(max-width: 860px)";

let toastId = 0;
const DEFAULT_LIMITS = { maxText: 1000, maxUploadBytes: 10 * 1024 * 1024, maxClipSeconds: 180 };

export default function Dashboard({ route, user, onLogout, onExpired }) {
  // "#/app/library/generated" -> page "library", sub "generated"
  const [, , page = "home", sub] = route.split("/");
  const current = PAGES[page];

  const [collapsed, setCollapsed] = useStored("eva.sidebar", false);
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState("");
  const [activeVoiceId, setActiveVoiceId] = useStored("eva.voice", null);
  const [languages, setLanguages] = useState(["en"]);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback((message, kind = "success") => {
    const id = ++toastId;
    setToasts((list) => [...list.slice(-3), { id, message, kind }]);
    setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4000);
  }, [dismiss]);

  const player = usePlayer(() => toast("Could not play this audio. It may have expired.", "error"));
  const voices = useResource(api.listVoices, []);
  const clips = useResource(api.listClips, []);
  const navigate = useCallback((to, subPage) => { window.location.hash = pageHref(to, subPage); }, []);

  useEffect(() => {
    setUnauthorizedHandler(onExpired);
    return () => setUnauthorizedHandler(() => {});
  }, [onExpired]);

  useEffect(() => {
    api.health().then((h) => {
      setLanguages(h.languages);
      setLimits({ maxText: h.max_text_chars, maxUploadBytes: h.max_upload_bytes, maxClipSeconds: h.max_clip_seconds });
    }).catch(() => {}); // the pages report an unreachable backend themselves
  }, []);

  // Any route change (including a library tab) stops playback and closes the mobile drawer.
  const { stop } = player;
  useEffect(() => {
    stop();
    setDrawer(false);
    if (!current) window.location.replace(pageHref("home"));
  }, [route, current, stop]);

  useEffect(() => {
    const before = document.title;
    document.title = `${current?.title ?? "Home"} · Eva`;
    return () => { document.title = before; };
  }, [current]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  // The stored choice may point at a voice that no longer exists; fall back to the newest one.
  const activeVoice = voices.data.find((v) => v.id === activeVoiceId) ?? voices.data[0] ?? null;

  const studio = useMemo(
    () => ({ voices, clips, activeVoice, setActiveVoiceId, languages, limits, player, toast, navigate, sub, query, setQuery, user, onLogout }),
    [voices, clips, activeVoice, setActiveVoiceId, languages, limits, player, toast, navigate, sub, query, user, onLogout],
  );

  if (!current) return null;
  const View = current.view;

  const toggleSidebar = () => (window.matchMedia(MOBILE).matches ? setDrawer(true) : setCollapsed(!collapsed));
  const search = (e) => {
    e.preventDefault();
    if (page !== "library") navigate("library");
  };
  const link = (id) => (
    <li key={id}>
      <a href={pageHref(id)} className={id === page ? "on" : ""} aria-current={id === page ? "page" : undefined}
        aria-label={PAGES[id].label} title={collapsed ? PAGES[id].label : undefined}>
        <Icon name={PAGES[id].icon} />
        <span>{PAGES[id].label}</span>
      </a>
    </li>
  );

  return (
    <StudioContext.Provider value={studio}>
      <div className={`dash${collapsed ? " collapsed" : ""}${drawer ? " drawer" : ""}`}>
        <aside className="side" aria-label="Sidebar">
          <a className="side-brand" href={pageHref("home")} aria-label="Eva home"><Logo size={22} /> <span>EVA</span></a>
          <nav aria-label="Main"><ul>{MAIN_NAV.map(link)}</ul></nav>
          <nav className="side-foot" aria-label="Account"><ul>{FOOT_NAV.map(link)}</ul></nav>
        </aside>
        {drawer && <div className="side-backdrop" onClick={() => setDrawer(false)} />}

        <div className="main">
          <header className="top">
            <button type="button" className="icon-btn" onClick={toggleSidebar} aria-label="Toggle sidebar"><Icon name="panel" /></button>
            <h1>{current.title}</h1>
            <form className="top-search" role="search" onSubmit={search}>
              <Icon name="search" size={17} />
              <input type="search" placeholder="Search voices and clips…" aria-label="Search voices and clips" value={query}
                onChange={(e) => setQuery(e.target.value)} />
            </form>
            <a className="avatar" href={pageHref("profile")} aria-label="Open profile" title={user.name}>{initials(user.name)}</a>
          </header>
          <main className="content" key={page}><View /></main>
        </div>
        <Toasts items={toasts} onDismiss={dismiss} />
      </div>
    </StudioContext.Provider>
  );
}
