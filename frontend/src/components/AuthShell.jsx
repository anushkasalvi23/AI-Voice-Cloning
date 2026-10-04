import { useState } from "react";
import { useSignIn } from "@clerk/react";
import { Logo } from "./Landing.jsx";
import orb from "../assets/ai-assistant.jpeg";
import "../login.css";

const steps = ["Register your account", "Set up your profile information", "Verify your identity through passport/ID"];

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
export const SSO_CALLBACK = "/sso-callback";

// Clerk API errors carry one entry per problem, tagged with the request parameter it concerns.
const PARAM_FIELD = { email_address: "email", identifier: "email", password: "password", first_name: "name", last_name: "name" };
export function readError(error) {
  const list = error.errors?.length ? error.errors : [error];
  const fields = {};
  for (const e of list) {
    const field = PARAM_FIELD[e.meta?.paramName];
    if (field) fields[field] ??= e.longMessage || e.message;
  }
  return { message: list[0].longMessage || list[0].message, fields };
}

const Eye = ({ off }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="2.8" />
    {off && <path d="m4 4 16 16" />}
  </svg>
);

const Google = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.200 7-17.600Z" />
    <path fill="#FBBC05" d="M10.500 28.600a14.500 14.500 0 0 1 0-9.200l-7.900-6.200a24 24 0 0 0 0 21.600l7.900-6.200Z" />
    <path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.600-5.900c-2.100 1.400-4.900 2.300-8.300 2.300-6.300 0-11.600-4.200-13.500-10l-7.900 6.200C6.500 42.600 14.600 48 24 48Z" />
  </svg>
);

export function Field({ label, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className={`inp${error ? " bad" : ""}`}>{children}</div>
      {error && <small className="err" role="alert">{error}</small>}
    </label>
  );
}

export function PasswordField({ label, error, ...input }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} error={error}>
      <input type={show ? "text" : "password"} placeholder="***************" aria-invalid={!!error} {...input} />
      <button type="button" className="eye" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}><Eye off={!show} /></button>
    </Field>
  );
}

function GoogleButton({ label, disabled }) {
  const { signIn } = useSignIn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setError("");
    setBusy(true);
    // Leaves the page for Google; Clerk signs in or creates the account on the way back.
    const { error } = await signIn.sso({ strategy: "oauth_google", redirectCallbackUrl: SSO_CALLBACK, redirectUrl: "/#/app" });
    if (error) {
      setError(readError(error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="auth-google" onClick={start} disabled={disabled || busy}>
        {busy ? <i className="auth-spin dark" /> : <Google />} {label}
      </button>
      {error && <p className="auth-banner bad auth-google-error" role="alert">{error}</p>}
    </>
  );
}

// status: { state: "idle" | "loading" | "error" | "success", message }
export function SubmitArea({ status, label, loadingLabel, alt, googleLabel }) {
  const busy = status.state === "loading" || status.state === "success";
  return (
    <>
      {status.state === "error" && <p className="auth-banner bad" role="alert">{status.message}</p>}
      {status.state === "success" && <p className="auth-banner good" role="status">{status.message}</p>}
      <button type="submit" className="auth-submit" disabled={busy}>
        {status.state === "loading" ? <><i className="auth-spin" /> {loadingLabel}</> : label}
      </button>
      <p className="auth-alt">{alt}</p>
      <div className="auth-or"><span>Or</span></div>
      <GoogleButton label={googleLabel} disabled={busy} />
      <p className="auth-legal">
        By signing up I confirm that I carefully have read and agree to the Eva{" "}<br />
        <a href="#/">Privacy Policy and Terms of Service</a>.
      </p>
    </>
  );
}

export default function AuthShell({ title, onSubmit, children }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <aside className="auth-hero">
          <img className="auth-orb" src={orb} alt="" />
          <a className="auth-logo" href="#/"><Logo size={20} /> <span>eva</span></a>
          <div className="auth-intro">
            <span className="auth-pill">Join Us to Build 🤩</span>
            <h1>Start your Journey</h1>
            <p>Follow these simple steps to set up your account.</p>
            <ol className="auth-steps">
              {steps.map((s, i) => (
                <li key={s} className={i === 0 ? "on" : ""}>
                  <b>{i + 1}</b>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          <h2>{title}</h2>
          {children}
        </form>
      </div>
    </div>
  );
}

// Email-code step shared by sign-up (verify the address) and sign-in (confirm a new device).
// onVerify/onResend resolve to an error message, or nothing on success; onDone then activates the session.
export function VerifyCode({ email, success, onVerify, onResend, onDone }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState({ state: "idle" });
  const busy = status.state === "loading" || status.state === "success";

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setStatus({ state: "error", message: "Enter the 6-digit code" });
    setStatus({ state: "loading" });
    const message = await onVerify(code);
    if (message) return setStatus({ state: "error", message });
    setStatus({ state: "success", message: success });
    onDone();
  };

  const resend = async (e) => {
    e.preventDefault();
    if (busy) return;
    const message = await onResend();
    setStatus(message ? { state: "error", message } : { state: "sent", message: "A new code is on its way." });
  };

  return (
    <AuthShell title="Check your email" onSubmit={submit}>
      <small className="hint-line">We sent a 6-digit code to <b>{email}</b>. Enter it below to continue.</small>
      <Field label="Verification code">
        <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} autoFocus
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      </Field>
      {status.state === "error" && <p className="auth-banner bad" role="alert">{status.message}</p>}
      {(status.state === "success" || status.state === "sent") && <p className="auth-banner good" role="status">{status.message}</p>}
      <button type="submit" className="auth-submit" disabled={busy}>
        {status.state === "loading" ? <><i className="auth-spin" /> Verifying…</> : "Verify"}
      </button>
      <p className="auth-alt">Didn't get it? <a href="#/" onClick={resend}>Send a new code</a></p>
    </AuthShell>
  );
}
