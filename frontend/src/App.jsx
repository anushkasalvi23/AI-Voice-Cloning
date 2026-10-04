import { useCallback, useEffect, useState } from "react";
import { HandleSSOCallback, useAuth, useUser } from "@clerk/react";
import Dashboard from "./components/Dashboard.jsx";
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
  const appPage = route === "#/app" || route.startsWith("#/app/"); // the dashboard owns everything under #/app
  const redirect = signedIn === undefined ? null : authPage && signedIn ? "#/app" : appPage && !signedIn ? "#/login" : null;
  useEffect(() => {
    if (redirect) window.location.replace(redirect);
  }, [redirect]);

  const go = (hash) => { window.location.hash = hash; setRoute(hash); };
  const onExpired = useCallback(() => signOut(), [signOut]);
  const logout = async () => {
    go("#/");
    await signOut().catch(() => {});
  };

  if (!authPage && !appPage) return <Landing />;
  if (signedIn === undefined || redirect || (signedIn && !user)) return null;
  if (route === "#/login") return <Login onAuth={enterApp} />;
  if (route === "#/signup") return <Signup onAuth={enterApp} />;
  const name = user.fullName || user.primaryEmailAddress?.emailAddress || "Eva user";
  return <Dashboard route={route} user={{ name }} onLogout={logout} onExpired={onExpired} />;
}
