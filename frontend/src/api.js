import { getToken } from "@clerk/react";

const BASE = "/api";

async function request(path, opts = {}) {
  let res;
  try {
    // Clerk session tokens live about a minute; getToken returns a fresh one (null when signed out).
    const token = await getToken();
    res = await fetch(BASE + path, { ...opts, headers: { ...opts.headers, ...(token && { Authorization: `Bearer ${token}` }) } });
  } catch {
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
  createVoice: ({ blob, filename, name, language }) => {
    const fd = new FormData();
    fd.append("file", blob, filename);
    fd.append("name", name);
    fd.append("language", language);
    fd.append("consent", "true"); // only reachable after the consent gate is ticked
    return request("/voices", { method: "POST", body: fd });
  },
  renameVoice: (id, name) => request(`/voices/${id}`, json("PATCH", { name })),
  deleteVoice: (id) => request(`/voices/${id}`, { method: "DELETE" }),
  generate: (voice_id, text, language) => request("/generate", json("POST", { voice_id, text, language })),
  job: (id) => request(`/jobs/${id}`),
  // Used as <audio src> / download links, which cannot send the header; the backend accepts
  // Clerk's same-origin __session cookie for these GETs.
  audioUrl: (id) => `${BASE}/audio/${id}`,
  voiceAudioUrl: (id) => `${BASE}/voices/${id}/audio`,
};

export async function generateAndWait(voiceId, text, language, onStatus) {
  const { job_id } = await api.generate(voiceId, text, language);
  for (;;) {
    const j = await api.job(job_id);
    onStatus?.(j);
    if (j.status === "done") return j.audio_id;
    if (j.status === "failed") throw new Error(j.error || "Generation failed");
    await new Promise((r) => setTimeout(r, 700));
  }
}
