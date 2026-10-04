import { useState } from "react";
import { useSignUp } from "@clerk/react";
import AuthShell, { EMAIL_RE, Field, PasswordField, SubmitArea, VerifyCode, readError } from "./AuthShell.jsx";

// [ISO code, country, dial code, national number length (min, max)]
const COUNTRIES = [
  ["IN", "India", "+91", 10, 10],
  ["US", "United States", "+1", 10, 10],
  ["CA", "Canada", "+1", 10, 10],
  ["GB", "United Kingdom", "+44", 10, 10],
  ["AU", "Australia", "+61", 9, 9],
  ["AE", "United Arab Emirates", "+971", 8, 9],
  ["SA", "Saudi Arabia", "+966", 9, 9],
  ["SG", "Singapore", "+65", 8, 8],
  ["DE", "Germany", "+49", 7, 11],
  ["FR", "France", "+33", 9, 9],
  ["JP", "Japan", "+81", 9, 10],
  ["CN", "China", "+86", 11, 11],
  ["BR", "Brazil", "+55", 10, 11],
  ["ZA", "South Africa", "+27", 9, 9],
  ["BD", "Bangladesh", "+880", 10, 10],
  ["LK", "Sri Lanka", "+94", 9, 9],
  ["NP", "Nepal", "+977", 10, 10],
  ["PK", "Pakistan", "+92", 10, 10],
  ["AM", "Armenia", "+374", 8, 8],
];

const EMPTY = { name: "", email: "", country: "IN", phone: "", password: "", confirm: "" };

function validate(f) {
  const [, , , min, max] = COUNTRIES.find((c) => c[0] === f.country);
  const digits = f.phone.replace(/\D/g, "");
  const errs = {};
  if (f.name.trim().length < 2) errs.name = "Enter your full name";
  if (!EMAIL_RE.test(f.email.trim())) errs.email = "Enter a valid email address";
  if (digits.length < min || digits.length > max) errs.phone = min === max ? `Enter a ${min}-digit phone number` : `Enter a ${min}–${max} digit phone number`;
  else if (f.country === "IN" && !/^[6-9]/.test(digits)) errs.phone = "Indian mobile numbers start with 6–9";
  if (f.password.length < 12 || f.password.length > 20) errs.password = "Use 12–20 characters";
  else if (!(/[A-Z]/.test(f.password) && /[a-z]/.test(f.password) && /\d/.test(f.password) && /[^A-Za-z0-9]/.test(f.password)))
    errs.password = "Add upper, lower, number and symbol";
  if (!f.confirm) errs.confirm = "Confirm your password";
  else if (f.confirm !== f.password) errs.confirm = "Passwords do not match";
  return errs;
}

export default function Signup({ onAuth }) {
  const { signUp } = useSignUp();
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [status, setStatus] = useState({ state: "idle" });
  const [verifying, setVerifying] = useState(false);

  const errs = validate(form);
  const error = (k) => serverErrors[k] || (touched[k] ? errs[k] : undefined);
  const bind = (k) => ({
    name: k,
    value: form[k],
    onChange: (e) => { setForm({ ...form, [k]: e.target.value }); setServerErrors({ ...serverErrors, [k]: undefined }); },
    onBlur: () => setTouched({ ...touched, [k]: true }),
    "aria-invalid": !!error(k),
  });
  const dial = COUNTRIES.find((c) => c[0] === form.country)[2];

  // Give the confirmation a moment on screen, then activate the new session.
  const enter = () => setTimeout(() => signUp.finalize({ navigate: onAuth }), 900);

  const submit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, email: true, phone: true, password: true, confirm: true });
    if (Object.keys(errs).length) return;

    setStatus({ state: "loading" });
    const fail = (err) => {
      const { message, fields } = readError(err);
      setServerErrors(fields);
      setStatus({ state: "error", message: Object.keys(fields).length ? "Please fix the highlighted fields." : message });
    };
    const [firstName, ...rest] = form.name.trim().split(/\s+/);
    const { error } = await signUp.password({
      emailAddress: form.email.trim(),
      password: form.password,
      firstName,
      lastName: rest.join(" ") || undefined,
      // Clerk only stores phone numbers it can verify by SMS, so the number is kept as profile metadata.
      unsafeMetadata: { phone: dial + form.phone.replace(/\D/g, "") },
    });
    if (error) return fail(error);
    if (signUp.status === "complete") {
      setStatus({ state: "success", message: "Account created. Taking you to the studio…" });
      return enter();
    }
    if (signUp.unverifiedFields.includes("email_address")) {
      const sent = await signUp.verifications.sendEmailCode();
      if (sent.error) return fail(sent.error);
      setStatus({ state: "idle" });
      return setVerifying(true);
    }
    setStatus({ state: "error", message: "Sign-up could not be completed. Please try again." });
  };

  const step = async (call) => {
    const { error } = await call;
    return error ? readError(error).message : undefined;
  };

  if (verifying)
    return (
      <VerifyCode
        email={form.email.trim()}
        success="Account created. Taking you to the studio…"
        onVerify={async (code) =>
          (await step(signUp.verifications.verifyEmailCode({ code }))) ?? (signUp.status === "complete" ? undefined : "Could not complete sign-up. Please try again.")}
        onResend={() => step(signUp.verifications.sendEmailCode())}
        onDone={enter}
      />
    );

  return (
    <AuthShell title="Join Us" onSubmit={submit}>
      <Field label="Full Name" error={error("name")}>
        <input type="text" placeholder="Juliette Karapetyan" autoComplete="name" maxLength={80} {...bind("name")} />
      </Field>
      <Field label="Email" error={error("email")}>
        <input type="email" placeholder="you@example.com" autoComplete="email" {...bind("email")} />
      </Field>
      <Field label="Phone number" error={error("phone")}>
        <span className="dial">
          <b>{form.country} {dial}</b>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="m2 3.500 3 3 3-3" /></svg>
          <select aria-label="Country code" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
            {COUNTRIES.map(([iso, country, code]) => <option key={iso} value={iso}>{country} ({code})</option>)}
          </select>
        </span>
        <input type="tel" inputMode="numeric" placeholder="98765 43210" autoComplete="tel-national" {...bind("phone")} />
      </Field>
      <div className="field-row">
        <PasswordField label="Password" error={error("password")} autoComplete="new-password" maxLength={20} {...bind("password")} />
        <PasswordField label="Confirm Password" error={error("confirm")} autoComplete="new-password" maxLength={20} {...bind("confirm")} />
      </div>
      <small className="hint-line">
        <b>At least 12 characters, no more than 20 characters.</b><br />
        Uppercase letters, <b>lowercase letters</b>, numbers, and symbols.
      </small>
      {/* Clerk mounts its bot-protection challenge here when one is needed. */}
      <div id="clerk-captcha" />
      <SubmitArea status={status} googleLabel="Sign up with Google" label="Sign Up" loadingLabel="Creating account…" alt={<>Already have an account? <a href="#/login">Login</a></>} />
    </AuthShell>
  );
}
