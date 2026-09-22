import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Input, Button } from '@heroui/react';
import { api } from '../../api/client';
import AaLogo from '../../components/AaLogo';

const STATES = [{ id: 'imo', name: 'Imo State' }]; // portal covers Ahiazu Federal Constituency (Imo)
const NG_PHONE = /^(\+234|0)[789][01]\d{8}$/;

// Agent self-registration without invite codes or passwords:
//   1. Identity (name, email, phone) + polling unit from the State→LGA→Ward→PU
//      cascade, plus an Email or SMS verification method
//   2. A verification code is sent to that address; only a validated code
//      unlocks the fingerprint ceremony (req: verification before biometrics)
//   3. WebAuthn ceremony links the device fingerprint and completes sign-in —
//      the account is active once its identity is verified (no admin queue).
export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', phoneNumber: '' });
  const [verificationMethod, setVerificationMethod] = useState('email');
  const [stateId, setStateId] = useState(STATES[0]?.id || '');
  const [lgaId, setLgaId] = useState('');
  const [wardId, setWardId] = useState('');
  const [pollingUnitId, setPollingUnitId] = useState('');
  const [lgas, setLgas] = useState([]);
  const [wards, setWards] = useState([]);
  const [pollingUnits, setPollingUnits] = useState([]);
  const [locationError, setLocationError] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('form'); // 'form' | 'verify' | 'enroll'
  const [stageLabel, setStageLabel] = useState(''); // progress label during ceremonies
  // Verification-code session, scoped to the account by the server.
  const [preVerifyToken, setPreVerifyToken] = useState(null);
  const [destinationMasked, setDestinationMasked] = useState(null);
  const [code, setCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  // Survives a failed ceremony so "Try again" resumes where it stopped
  // instead of restarting the whole form (the server also accepts email-only
  // recovery if this token expires).
  const [enrollmentToken, setEnrollmentToken] = useState(null);
  const cooldownRef = useRef(null);

  useEffect(() => () => clearInterval(cooldownRef.current), []);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  const loadLgas = () => {
    setLocationError(null);
    api.getLocalGovernmentsPublic()
      .then((d) => setLgas(Array.isArray(d) ? d : []))
      .catch(() => setLocationError('Could not load local governments. Check your connection and try again.'));
  };

  useEffect(() => {
    loadLgas();
  }, []);

  const pickLga = (id) => {
    setLgaId(id);
    setWardId('');
    setPollingUnitId('');
    setWards([]);
    setPollingUnits([]);
    if (id) {
      api.getWardsPublic(id)
        .then((d) => setWards(Array.isArray(d) ? d : []))
        .catch(() => setLocationError('Could not load wards. Check your connection and try again.'));
    }
  };

  const pickWard = (id) => {
    setWardId(id);
    setPollingUnitId('');
    setPollingUnits([]);
    if (id) {
      api.getPollingUnitsPublic(id)
        .then((d) => setPollingUnits(Array.isArray(d) ? d : []))
        .catch(() => setLocationError('Could not load polling units. Check your connection and try again.'));
    }
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
    // SMS verification needs a valid Nigerian phone; it is otherwise optional
    // but still captured as part of the agent's registration identity.
    if (verificationMethod === 'sms') {
      if (!form.phoneNumber.trim()) {
        setError('Enter the phone number to receive the SMS code');
        return false;
      }
      if (!NG_PHONE.test(form.phoneNumber.trim())) {
        setError('Enter a valid Nigerian phone number (e.g. 080XXXXXXXX)');
        return false;
      }
    } else if (form.phoneNumber.trim() && !NG_PHONE.test(form.phoneNumber.trim())) {
      setError('Enter a valid Nigerian phone number (e.g. 080XXXXXXXX)');
      return false;
    }
    if (!pollingUnitId) {
      setError('Select your state, local government, ward, and polling unit');
      return false;
    }
    return true;
  };

  const getRegisteredEmail = () => form.email.trim();

  // R2–R4: options → fingerprint scan → verify. Retryable as a unit.
  const runEnrollment = async () => {
    setStageLabel('Preparing fingerprint scan…');
    const { options, challengeToken, enrollmentToken: freshToken } = await api.webauthnRegisterOptions(
      enrollmentToken,
      getRegisteredEmail()
    );
    const activeToken = freshToken || enrollmentToken;
    if (freshToken) setEnrollmentToken(freshToken);

    setStageLabel('Scan your fingerprint…');
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

    setStageLabel('Linking fingerprint…');
    await api.webauthnRegisterVerify(activeToken, challengeToken, attestation);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // A retry after a mid-ceremony failure skips account creation entirely —
    // the shell already exists; only the fingerprint step is missing.
    const isRetry = !!enrollmentToken;
    if (!isRetry && !validateForm()) return;
    setLoading(true);
    try {
      if (!enrollmentToken) {
        // R1 — create the pending account, get a verification code sent
        setStageLabel('Sending verification code…');
        const data = await api.registerAgent({
          fullName: form.fullName.trim(),
          email: getRegisteredEmail(),
          phoneNumber: form.phoneNumber.trim(),
          pollingUnitId,
          verificationMethod,
        });
        if (data.requiresVerification) {
          setPreVerifyToken(data.preVerifyToken);
          setDestinationMasked(data.destinationMasked);
          setStage('verify');
          return;
        }
        // Already-verified resume — straight to the fingerprint ceremony
        setEnrollmentToken(data.enrollmentToken);
        await runEnrollment();
      } else {
        await runEnrollment();
      }
      navigate('/login', { state: { justRegistered: true, registeredEmail: getRegisteredEmail() } });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStageLabel('');
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setError(null);
    if (!preVerifyToken || code.trim().length < 4) {
      setError('Enter the code you received');
      return;
    }
    setLoading(true);
    try {
      const data = await api.registerVerifyCode(preVerifyToken, code.trim());
      setEnrollmentToken(data.enrollmentToken);
      setStage('enroll');
      await runEnrollment();
      navigate('/login', { state: { justRegistered: true, registeredEmail: getRegisteredEmail() } });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStageLabel('');
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError(null);
    setLoading(true);
    try {
      const data = await api.registerResendCode(form.email.trim(), verificationMethod);
      setPreVerifyToken(data.preVerifyToken);
      setDestinationMasked(data.destinationMasked);
      setCode('');
      setResendCooldown(30);
      cooldownRef.current = setInterval(() => {
        setResendCooldown((s) => {
          if (s <= 1) {
            clearInterval(cooldownRef.current);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const field = 'block text-sm font-medium mb-1.5';
  const selectCls =
    'w-full min-h-[48px] rounded-xl border-none bg-[var(--paper)] px-3 text-[15px] shadow-inner focus:outline-none';
  const methodPill = (active) =>
    `flex-1 min-h-[44px] rounded-xl px-3 text-sm font-semibold border-2 transition-colors ${
      active ? 'border-[var(--aa-green)] text-[var(--aa-green-dark)] bg-[rgba(0,128,96,0.08)]' : 'border-black/10 text-[var(--muted)]'
    }`;

  if (stage === 'verify') {
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
                Verify your contact
              </div>
            </div>
          </div>
          <p className="text-sm text-[var(--muted)]">
            We sent a 6-digit code {verificationMethod === 'sms' ? `to ${destinationMasked}` : `to ${destinationMasked}`}. Enter
            it below to confirm this is really your{' '}
            {verificationMethod === 'sms' ? 'phone number' : 'email address'}.
          </p>
          <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
            <div>
              <label htmlFor="code" className={field}>Verification code</label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="000000"
                maxLength={6}
                required
                fullWidth
              />
            </div>
            {error && <p className="error-text" role="alert">{error}</p>}
            <Button type="submit" variant="primary" fullWidth disabled={loading}>
              {loading ? stageLabel || 'Verifying…' : 'Verify code and continue'}
            </Button>
            <button
              type="button"
              className="text-sm font-medium text-[var(--accent)] cursor-pointer disabled:opacity-50"
              onClick={handleResend}
              disabled={loading || resendCooldown > 0}
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
            </button>
            <button
              type="button"
              className="text-sm text-[var(--muted)] cursor-pointer"
              onClick={() => {
                setStage('form');
                setPreVerifyToken(null);
                setDestinationMasked(null);
                setCode('');
              }}
            >
              ← Change details
            </button>
          </form>
        </div>
      </div>
    );
  }

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
          No password needed — you'll verify your email or phone with a code, then sign in with your fingerprint.
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
          <div>
            <label htmlFor="phoneNumber" className={field}>Phone number {verificationMethod !== 'sms' && <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(for SMS)</span>}</label>
            <Input
              id="phoneNumber"
              type="tel"
              value={form.phoneNumber}
              onChange={(e) => update({ phoneNumber: e.target.value })}
              placeholder="080XXXXXXXX"
              disabled={!!enrollmentToken}
              fullWidth
            />
          </div>
          <div>
            <span className={field}>How do you want to receive the verification code?</span>
            <div className="flex gap-2">
              <button
                type="button"
                className={methodPill(verificationMethod === 'email')}
                onClick={() => setVerificationMethod('email')}
              >
                Email
              </button>
              <button
                type="button"
                className={methodPill(verificationMethod === 'sms')}
                onClick={() => setVerificationMethod('sms')}
              >
                SMS
              </button>
            </div>
          </div>

          <fieldset className="border-0 p-0 m-0 flex flex-col gap-3">
            <legend className={field}>Your polling unit</legend>
            {locationError && (
              <p className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: 'rgba(220,38,38,0.08)', color: 'var(--error-red)' }} role="alert">
                {locationError}
              </p>
            )}
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

          <p className="text-xs text-[var(--muted)] leading-relaxed">
            Complete identity verification to receive your account and begin submitting results.
          </p>

          {error && <p className="error-text" role="alert">{error}</p>}
          <Button type="submit" variant="primary" fullWidth disabled={loading}>
            {loading
              ? stageLabel || 'Working…'
              : enrollmentToken
                ? error
                  ? 'Try fingerprint again'
                  : 'Scan my fingerprint'
                : 'Create account and send code'}
          </Button>
        </form>
        <p className="text-sm text-center text-[var(--muted)]">
          Already have an account? <Link to="/login" className="text-[var(--accent)] font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}