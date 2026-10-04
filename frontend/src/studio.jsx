import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// Shared dashboard state: voices, saved clips, the active voice, the audio player, toasts and navigation.
export const StudioContext = createContext(null);
export const useStudio = () => useContext(StudioContext);

export const pageHref = (page, sub) => (page === "home" ? "#/app" : `#/app/${page}${sub ? `/${sub}` : ""}`);
export const initials = (name) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

// Loads a backend resource and tracks it as { status: "loading" | "ready" | "error", data, error }.
// A reload keeps showing the data already on screen.
export function useResource(fetcher, initial) {
  const [res, setRes] = useState({ status: "loading", data: initial, error: "" });
  const load = useCallback(async () => {
    setRes((r) => ({ ...r, status: r.status === "ready" ? "ready" : "loading", error: "" }));
    try {
      const data = await fetcher();
      setRes({ status: "ready", data, error: "" });
    } catch (e) {
      setRes((r) => ({ ...r, status: "error", error: e.message }));
    }
  }, [fetcher]);
  useEffect(() => { load(); }, [load]);
  const setData = useCallback((fn) => setRes((r) => ({ ...r, data: fn(r.data) })), []);
  return useMemo(() => ({ ...res, load, setData }), [res, load, setData]);
}

export function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue];
}

// One audio element for the whole dashboard, so only one thing ever plays at a time.
// Callers identify what they play with a key; `key`/`playing` say what is on right now.
export function usePlayer(onError) {
  const audio = useRef(null);
  const current = useRef(null);
  const [state, setState] = useState({ key: null, playing: false });
  const report = useRef(onError);
  report.current = onError;

  useEffect(() => {
    const a = new Audio();
    audio.current = a;
    const set = (playing) => () => setState({ key: current.current, playing });
    const failed = () => {
      if (!current.current) return;
      current.current = null;
      setState({ key: null, playing: false });
      report.current?.();
    };
    const events = { playing: set(true), pause: set(false), ended: set(false), error: failed };
    for (const [name, fn] of Object.entries(events)) a.addEventListener(name, fn);
    return () => {
      for (const [name, fn] of Object.entries(events)) a.removeEventListener(name, fn);
      a.pause();
      a.removeAttribute("src");
    };
  }, []);

  const stop = useCallback(() => {
    const a = audio.current;
    if (!current.current) return;
    current.current = null;
    a.pause();
    a.removeAttribute("src");
    a.load();
    setState({ key: null, playing: false });
  }, []);

  const toggle = useCallback((key, url) => {
    const a = audio.current;
    if (current.current !== key) {
      current.current = key;
      a.src = url;
      setState({ key, playing: false });
    } else if (!a.paused) return a.pause();
    a.play().catch(() => {}); // a failed load is reported by the error event
  }, []);

  const seek = useCallback((seconds) => { audio.current.currentTime = seconds; }, []);

  return useMemo(() => ({ ...state, audio, toggle, stop, seek }), [state, toggle, stop, seek]);
}

// Playback position of `key` while it is the loaded track; zeros otherwise.
export function usePlayback(key) {
  const { player } = useStudio();
  const active = player.key === key;
  const [pos, setPos] = useState({ time: 0, duration: 0 });
  useEffect(() => {
    if (!active) return setPos({ time: 0, duration: 0 });
    const a = player.audio.current;
    const update = () => setPos({ time: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : 0 });
    const events = ["timeupdate", "durationchange", "seeked", "ended"];
    events.forEach((e) => a.addEventListener(e, update));
    update();
    return () => events.forEach((e) => a.removeEventListener(e, update));
  }, [active, player.audio]);
  return pos;
}
