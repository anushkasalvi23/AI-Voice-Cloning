import { useState } from "react";
import { useSignIn } from "@clerk/react";
import AuthShell, { EMAIL_RE, Field, PasswordField, SubmitArea, VerifyCode, readError } from "./AuthShell.jsx";

export default function Login({ onAuth }) {
  const { signIn } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState({ state: "idle" });
  const [verifying, setVerifying] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!EMAIL_RE.test(email.trim())) errs.email = "Enter a valid email address";
    if (!password) errs.password = "Enter your password";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setStatus({ state: "loading" });
    const fail = (message) => setStatus({ state: "error", message });
    const { error } = await signIn.password({ emailAddress: email.trim(), password });
    if (error) {
      const { message, fields } = readError(error);
      setErrors(fields);
      return Object.keys(fields).length ? setStatus({ state: "idle" }) : fail(message);
    }
    if (signIn.status === "complete") {
      const done = await signIn.finalize({ navigate: onAuth });
      return done.error && fail(readError(done.error).message);
    }
    // On an unrecognised device Clerk asks for a code emailed to the account before signing in.
    if (signIn.supportedSecondFactors?.some((f) => f.strategy === "email_code")) {
      const sent = await signIn.mfa.sendEmailCode();
      if (sent.error) return fail(readError(sent.error).message);
      setStatus({ state: "idle" });
      return setVerifying(true);
    }
    fail("This account needs an extra sign-in step that this app does not support.");
  };

  const step = async (call) => {
    const { error } = await call;
    return error ? readError(error).message : undefined;
  };

  if (verifying)
    return (
      <VerifyCode
        email={email.trim()}
        success="Verified. Taking you to the studio…"
        onVerify={async (code) =>
          (await step(signIn.mfa.verifyEmailCode({ code }))) ?? (signIn.status === "complete" ? undefined : "Could not complete sign-in. Please try again.")}
        onResend={() => step(signIn.mfa.sendEmailCode())}
        onDone={() => signIn.finalize({ navigate: onAuth })}
      />
    );

  return (
    <AuthShell title="Welcome back" onSubmit={submit}>
      <Field label="Email" error={errors.email}>
        <input type="email" name="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} />
      </Field>
      <PasswordField label="Password" error={errors.password} name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <SubmitArea status={status} googleLabel="Sign in with Google" label="Log in" loadingLabel="Logging in…" alt={<>Don't have an account? <a href="#/signup">Sign up</a></>} />
    </AuthShell>
  );
}
