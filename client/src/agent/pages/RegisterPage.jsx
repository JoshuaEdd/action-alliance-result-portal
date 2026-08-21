import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Input, Button } from '@heroui/react';
import { api } from '../../api/client';
import AaLogo from '../../components/AaLogo';

const STATES = [{ id: 'imo', name: 'Imo State' }]; // portal covers Ahiazu Federal Constituency (Imo)

// Agent self-registration without invite codes or passwords:
//   1. Identity + polling unit picked from the State → LGA → Ward → PU cascade
//   2. WebAuthn ceremony links the device fingerprint to the account
// After this, the agent signs in with email + fingerprint only.
export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '' });
  const [stateId, setStateId] = useState('');
  const [lgaId, setLgaId] = useState('');
  const [wardId, setWardId] = useState('');
  const [pollingUnitId, setPollingUnitId] = useState('');
  const [lgas, setLgas] = useState([]);
  const [wards, setWards] = useState([]);
  const [pollingUnits, setPollingUnits] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(''); // progress label during ceremonies
  // Survives a failed ceremony so "Try again" resumes where it stopped
  // instead of restarting the whole form (the server also accepts email-only
  // recovery if this token expires).
  const [enrollmentToken, setEnrollmentToken] = useState(null);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    api.getLocalGovernmentsPublic().then(setLgas).catch(() => {});
  }, []);

  const pickLga = (id) => {
    setLgaId(id);
    setWardId('');
    setPollingUnitId('');
    setWards([]);
    setPollingUnits([]);
    if (id) api.getWardsPublic(id).then(setWards).catch(() => {});
  };

  const pickWard = (id) => {
    setWardId(id);
    setPollingUnitId('');
    setPollingUnits([]);
    if (id) api.getPollingUnitsPublic(id).then(setPollingUnits).catch(() => {});
  };

  const validateForm = () => {
    if (!form.fullName.trim() || form.fullName.trim().length < 2) {
      setError('Enter your full name');
      return false;
    }
    if (!form.email.trim()) {
      setError('Enter your email address');
      return false;
    }
    if (!pollingUnitId) {
      setError('Select your state, local government, ward, and polling unit');
      return false;
    }
    return true;
  };

  // R2–R4: options → fingerprint scan → verify. Retryable as a unit.
  const runEnrollment = async () => {
    // Ask the server for creation options; the retained token is preferred,
    // but email alone recovers an expired session.
    setStage('Preparing fingerprint scan…');
    const { options, challengeToken, enrollmentToken: freshToken } = await api.webauthnRegisterOptions(
      enrollmentToken,
      form.email.trim()
    );
    // The server always mints a fresh enrollment token with the options —
    // use it for verify even if a retained one exists but has expired.
    const activeToken = freshToken || enrollmentToken;
    if (freshToken) setEnrollmentToken(freshToken);

    setStage('Scan your fingerprint…');
    const { startRegistration } = await import('@simplewebauthn/browser');
    let attestation;
    try {
      attestation = await startRegistration({ optionsJSON: options });
    } catch (err) {
      throw new Error(
        err?.name === 'NotAllowedError'
          ? 'Fingerprint scan was cancelled. Tap Try again when you are ready.'
          : 'This device could not perform a fingerprint scan. Use a phone or laptop with a biometric sensor.'
      );
    }

    setStage('Linking fingerprint…');
    await api.webauthnRegisterVerify(activeToken, challengeToken, attestation);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // A retry after a mid-ceremony failure skips account creation entirely —
    // the shell already exists; only the fingerprint step is missing.
    const isRetry = !!enrollmentToken;
    if (isRetry || validateForm()) {
      if (!isRetry && !pollingUnitId) return;
      setLoading(true);
      try {
        if (!enrollmentToken) {
          // R1 — create the account shell (or resume an incomplete one)
          setStage('Creating account…');
          const data = await api.registerAgent(form.fullName.trim(), form.email.trim(), pollingUnitId);
          setEnrollmentToken(data.enrollmentToken);
        }
        await runEnrollment();
        navigate('/login', { state: { justRegistered: true, registeredEmail: form.email.trim() } });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
        setStage('');
      }
    }
  };

  // Explicit retry button handler — same path as submit but never re-creates
  const handleRetry = async () => {
    setError(null);
    setLoading(true);
    try {
      await runEnrollment();
      navigate('/login', { state: { justRegistered: true, registeredEmail: form.email.trim() } });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStage('');
    }
  };

  const field = 'block text-sm font-medium mb-1.5';
  const selectCls =
    'w-full min-h-[48px] rounded-xl border-none bg-[var(--paper)] px-3 text-[15px] shadow-inner focus:outline-none';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] shadow-lg ring-1 ring-black/5 p-6 pt-8 flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <AaLogo size={52} />
          <div>
            <h1 className="text-xl m-0 font-bold" style={{ color: 'var(--aa-green-dark)', fontFamily: 'Poppins, var(--font-display)' }}>
              Action Alliance
            </h1>
            <div className="text-[11px] tracking-[0.06em] uppercase text-[var(--muted)]" style={{ fontFamily: 'var(--font-mono)' }}>
              Create your agent account
            </div>
          </div>
        </div>
        <p className="text-sm text-[var(--muted)]">
          No password needed — you'll sign in with your email and your device's fingerprint.
        </p>
        {enrollmentToken && (
          <div
            className="rounded-xl px-4 py-3 text-sm font-medium"
            style={{ background: 'rgba(0, 128, 96, 0.08)', color: 'var(--aa-green-dark)' }}
            role="status"
          >
            Your account exists — just scan your fingerprint to finish setup.
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="fullName" className={field}>Full name</label>
            <Input
              id="fullName"
              type="text"
              value={form.fullName}
              onChange={(e) => update({ fullName: e.target.value })}
              disabled={!!enrollmentToken}
              required
              fullWidth
            />
          </div>
          <div>
            <label htmlFor="email" className={field}>Email address</label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => update({ email: e.target.value })}
              autoComplete="username webauthn"
              placeholder="you@example.com"
              disabled={!!enrollmentToken}
              required
              fullWidth
            />
          </div>

          <fieldset className="border-0 p-0 m-0 flex flex-col gap-3">
            <legend className={field}>Your polling unit</legend>
            <select
              aria-label="State"
              className={selectCls}
              value={stateId}
              onChange={(e) => setStateId(e.target.value)}
              disabled={!!enrollmentToken}
            >
              <option value="">State…</option>
              {STATES.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              aria-label="Local government"
              className={selectCls}
              value={lgaId}
              onChange={(e) => pickLga(e.target.value)}
              disabled={!stateId || !!enrollmentToken}
              required
            >
              <option value="">Local government…</option>
              {lgas.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <select
              aria-label="Ward"
              className={selectCls}
              value={wardId}
              onChange={(e) => pickWard(e.target.value)}
              disabled={!lgaId || !!enrollmentToken}
              required
            >
              <option value="">Ward…</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} (Ward {w.ward_number})
                </option>
              ))}
            </select>
            <select
              aria-label="Polling unit"
              className={selectCls}
              value={pollingUnitId}
              onChange={(e) => setPollingUnitId(e.target.value)}
              disabled={!wardId || !!enrollmentToken}
              required
            >
              <option value="">Polling unit…</option>
              {pollingUnits.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (PU {p.pu_number})
                </option>
              ))}
            </select>
          </fieldset>

          {error && <p className="error-text" role="alert">{error}</p>}
          <Button type="submit" variant="primary" fullWidth disabled={loading}>
            {loading
              ? stage || 'Working…'
              : enrollmentToken
                ? error
                  ? 'Try fingerprint again'
                  : 'Scan my fingerprint'
                : 'Create account with fingerprint'}
          </Button>
        </form>
        <p className="text-sm text-center text-[var(--muted)]">
          Already have an account? <Link to="/login" className="text-[var(--accent)] font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
