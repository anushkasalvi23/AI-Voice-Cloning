const BASE = "/api";

async function request(path, opts) {
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {}
    throw new Error(detail);
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
