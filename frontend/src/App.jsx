import { useCallback, useEffect, useState } from "react";
import { HandleSSOCallback, useAuth, useUser } from "@clerk/react";
import { api } from "./api.js";
import Recorder from "./components/Recorder.jsx";
import VoiceLibrary from "./components/VoiceLibrary.jsx";
import GeneratePanel from "./components/GeneratePanel.jsx";
import Landing from "./components/Landing.jsx";
import Login from "./components/Login.jsx";
import Signup from "./components/Signup.jsx";
import { SSO_CALLBACK } from "./components/AuthShell.jsx";

// Clerk hands these a decorateUrl helper; the result may be an absolute URL, so navigate via location.
const enterApp = ({ decorateUrl }) => window.location.replace(decorateUrl("/#/app"));

export default function App() {
  // Google sign-in returns here (a real path, since OAuth redirects cannot target a hash route).
  if (window.location.pathname === SSO_CALLBACK)
    return (
      <HandleSSOCallback
        navigateToApp={enterApp}
        navigateToSignIn={() => window.location.replace("/#/login")}
        navigateToSignUp={() => window.location.replace("/#/signup")}
      />
    );
  return <Routes />;
}

function Routes() {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => { setRoute(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // signedIn: undefined = Clerk is still loading the session
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const signedIn = isLoaded ? !!isSignedIn : undefined;

  const authPage = route === "#/login" || route === "#/signup";
  const redirect = signedIn === undefined ? null : authPage && signedIn ? "#/app" : route === "#/app" && !signedIn ? "#/login" : null;
  useEffect(() => {
    if (redirect) window.location.replace(redirect);
  }, [redirect]);

  const go = (hash) => { window.location.hash = hash; setRoute(hash); };
  const onExpired = useCallback(() => signOut(), [signOut]);
  const logout = async () => {
    go("#/");
    await signOut().catch(() => {});
  };

  if (!authPage && route !== "#/app") return <Landing />;
  if (signedIn === undefined || redirect || (signedIn && !user)) return null;
  if (route === "#/login") return <Login onAuth={enterApp} />;
  if (route === "#/signup") return <Signup onAuth={enterApp} />;
  const name = user.fullName || user.primaryEmailAddress?.emailAddress;
  return <Studio user={{ name }} onLogout={logout} onExpired={onExpired} />;
}

function Studio({ user, onLogout, onExpired }) {
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
      if (e.status === 401) return onExpired();
      setError(`Cannot reach the backend: ${e.message}`);
    }
  }, [onExpired]);

  useEffect(() => {
    refresh();
    api.health().then((h) => setLanguages(h.languages)).catch(() => {});
  }, [refresh]);

  return (
    <main>
      <div className="row">
        <h1 className="grow">Voice Cloning</h1>
        <small>{user.name}</small>
        <button className="secondary" onClick={onLogout}>Log out</button>
      </div>
      {error && <p className="error">{error}</p>}
      <Recorder languages={languages} onSaved={(v) => { setSelected(v.id); refresh(); }} />
      <VoiceLibrary voices={voices} selectedId={selected} onSelect={setSelected} onChanged={refresh} />
      <GeneratePanel voices={voices} voiceId={selected} onVoice={setSelected} languages={languages} />
    </main>
  );
}
