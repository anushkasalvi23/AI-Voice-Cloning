import { useState } from "react";
import { useUser } from "@clerk/react";
import { initials, useStudio } from "../studio.jsx";
import { readError } from "./AuthShell.jsx";
import { Field, Icon, Spinner, fmtDate } from "./ui.jsx";

export default function Profile() {
  const { toast, onLogout } = useStudio();
  const { user } = useUser(); // the account lives in Clerk; the backend only sees its user id
  const email = user?.primaryEmailAddress?.emailAddress;
  const name = user?.fullName || "";
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const clean = draft.trim().replace(/\s+/g, " ");
  const changed = clean !== name;

  async function save(e) {
    e.preventDefault();
    if (clean.length < 2) return setError("Enter your name");
    setBusy(true);
    setError("");
    const [firstName, ...rest] = clean.split(" ");
    try {
      await user.update({ firstName, lastName: rest.join(" ") });
      setDraft(clean);
      toast("Display name updated");
    } catch (err) {
      const { message } = readError(err);
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null; // signing out

  return (
    <>
      <header className="page-head">
        <h2>Profile</h2>
        <p>Your Eva account.</p>
      </header>

      <section className="card profile" aria-label="Account">
        <span className="avatar xl" aria-hidden="true">{initials(name || email || "")}</span>
        <div>
          <h3>{name || email}</h3>
          <dl>
            <div><dt>Email</dt><dd>{email || "Not set"}</dd></div>
            <div><dt>Member since</dt><dd>{user.createdAt ? fmtDate(user.createdAt) : "Unknown"}</dd></div>
          </dl>
        </div>
      </section>

      <form className="card" onSubmit={save} noValidate>
        <h3 className="card-title">Display name</h3>
        <Field label="Name" error={error} hint="Shown in the dashboard and on your account.">
          <input type="text" value={draft} maxLength={80} autoComplete="name" disabled={busy} aria-invalid={!!error}
            onChange={(e) => { setDraft(e.target.value); setError(""); }} />
        </Field>
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={busy || !changed}>{busy ? <><Spinner /> Saving…</> : "Save name"}</button>
        </div>
      </form>

      <section className="card" aria-labelledby="session">
        <h3 id="session" className="card-title">Session</h3>
        <div className="danger-row">
          <p>Sign out of Eva on this device. Your voices and clips stay in your account.</p>
          <button type="button" className="btn" disabled={leaving} onClick={() => { setLeaving(true); onLogout(); }}>
            {leaving ? <Spinner /> : <Icon name="logout" size={16} />} Log out
          </button>
        </div>
      </section>
    </>
  );
}
