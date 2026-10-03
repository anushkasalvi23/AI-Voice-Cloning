import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import Recorder from "./components/Recorder.jsx";
import VoiceLibrary from "./components/VoiceLibrary.jsx";
import GeneratePanel from "./components/GeneratePanel.jsx";

export default function App() {
  const [voices, setVoices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [languages, setLanguages] = useState(["en"]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = await api.listVoices();
      setVoices(list);
      setSelected((s) => (list.some((v) => v.id === s) ? s : list[0]?.id ?? null));
    } catch (e) {
      setError(`Cannot reach the backend: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    api.health().then((h) => setLanguages(h.languages)).catch(() => {});
  }, [refresh]);

  return (
    <main>
      <h1>Voice Cloning</h1>
      {error && <p className="error">{error}</p>}
      <Recorder languages={languages} onSaved={(v) => { setSelected(v.id); refresh(); }} />
      <VoiceLibrary voices={voices} selectedId={selected} onSelect={setSelected} onChanged={refresh} />
      <GeneratePanel voices={voices} voiceId={selected} onVoice={setSelected} languages={languages} />
    </main>
  );
}
