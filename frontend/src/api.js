import { getToken } from "@clerk/react";

const BASE = "/api";

// Called when the backend rejects the session, so the app can sign the user out in one place.
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(path, opts = {}) {
  let res;
  try {
    // Clerk session tokens live about a minute; getToken returns a fresh one (null when signed out).
    const token = await getToken();
    res = await fetch(BASE + path, { ...opts, headers: { ...opts.headers, ...(token && { Authorization: `Bearer ${token}` }) } });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    let detail = res.status >= 500 ? "Server error. Is the backend running?" : res.statusText;
    let fields;
    try {
      const body = await res.json();
      if (Array.isArray(body.detail)) {
        // FastAPI validation errors: [{loc: ["body", field], msg}]
        fields = Object.fromEntries(body.detail.map((d) => [d.loc[d.loc.length - 1], d.msg.replace(/^Value error, /, "")]));
        detail = Object.values(fields).join(". ");
      } else if (typeof body.detail === "string") detail = body.detail;
    } catch {}
    const err = new Error(detail);
    err.status = res.status;
    err.fields = fields;
    if (res.status === 401) onUnauthorized();
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

const json = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request("/health"),
  listVoices: () => request("/voices"),
  // samples: [{ blob, name }] - the backend joins them into one reference clip
  createVoice: ({ samples, name, language }) => {
    const fd = new FormData();
    for (const s of samples) fd.append("files", s.blob, s.name);
    fd.append("name", name);
    fd.append("language", language);
    fd.append("consent", "true"); // only reachable after the consent gate is ticked
    return request("/voices", { method: "POST", body: fd });
  },
  updateVoice: (id, changes) => request(`/voices/${id}`, json("PATCH", changes)),
  deleteVoice: (id) => request(`/voices/${id}`, { method: "DELETE" }),
  generate: (voice_id, text, language) => request("/generate", json("POST", { voice_id, text, language })),
  job: (id) => request(`/jobs/${id}`),
  cancelJob: (id) => request(`/jobs/${id}`, { method: "DELETE" }),
  listClips: () => request("/clips"),
  saveClip: (clip) => request("/clips", json("POST", clip)),
  updateClip: (id, changes) => request(`/clips/${id}`, json("PATCH", changes)),
  deleteClip: (id) => request(`/clips/${id}`, { method: "DELETE" }),
  stats: () => request("/stats"),
  activity: (limit = 8) => request(`/activity?limit=${limit}`),
  deleteAllData: () => request("/data?confirm=DELETE", { method: "DELETE" }),
  // Used as audio sources / download links, which cannot send the header; the backend accepts
  // Clerk's same-origin __session cookie for these GETs.
  audioUrl: (id) => `${BASE}/audio/${id}`,
  mediaUrl: (path) => BASE + path, // for the `audio_url` the backend returns on voices and clips
};

// Resolves to the finished job ({ audio_id, duration }). Aborting the signal cancels the job on the
// backend too, unless the reason is "detach" (the caller just stopped waiting).
export async function generateAndWait(voiceId, text, language, { onStatus, signal, timeoutMs = 5 * 60_000 } = {}) {
  const { job_id } = await api.generate(voiceId, text, language);
  const deadline = Date.now() + timeoutMs;
  const cancel = () => api.cancelJob(job_id).catch(() => {});
  for (;;) {
    if (signal?.aborted) {
      if (signal.reason !== "detach") cancel();
      throw new DOMException("Generation cancelled", "AbortError");
    }
    if (Date.now() > deadline) {
      cancel();
      throw new Error("Generation timed out. The server may be busy; try again or use shorter text.");
    }
    const j = await api.job(job_id);
    onStatus?.(j);
    if (j.status === "done") return j;
    if (j.status === "failed") throw new Error(j.error || "Generation failed");
    await new Promise((r) => setTimeout(r, 700));
  }
}
