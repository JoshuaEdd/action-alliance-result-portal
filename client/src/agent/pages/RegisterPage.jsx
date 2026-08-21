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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!form.fullName.trim() || form.fullName.trim().length < 2) {
      setError('Enter your full name');
      return;
    }
    if (!pollingUnitId) {
      setError('Select your state, local government, ward, and polling unit');
      return;
    }

    setLoading(true);
    try {
      // R1 — create the account shell
      setStage('Creating account…');
      const { enrollmentToken } = await api.registerAgent(form.fullName.trim(), form.email.trim(), pollingUnitId);

      // R2 — ask the server for WebAuthn creation options
      setStage('Preparing fingerprint scan…');
      const { options, challengeToken } = await api.webauthnRegisterOptions(enrollmentToken);

      // R3 — the device prompts for the fingerprint
      setStage('Scan your fingerprint…');
      const { startRegistration } = await import('@simplewebauthn/browser');
      let attestation;
      try {
        attestation = await startRegistration({ optionsJSON: options });
      } catch (err) {
        throw new Error(
          err?.name === 'NotAllowedError'
            ? 'Fingerprint scan was cancelled. Please try again and complete the scan.'
            : 'This device could not perform a fingerprint scan. Use a phone or laptop with a biometric sensor.'
        );
      }

      // R4 — verify and store the credential
      setStage('Linking fingerprint…');
      await api.webauthnRegisterVerify(enrollmentToken, challengeToken, attestation);

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
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="fullName" className={field}>Full name</label>
            <Input
              id="fullName"
              type="text"
              value={form.fullName}
              onChange={(e) => update({ fullName: e.target.value })}
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
              required
              fullWidth
            />
          </div>

          <fieldset className="border-0 p-0 m-0 flex flex-col gap-3">
            <legend className={field}>Your polling unit</legend>
            <select aria-label="State" className={selectCls} value={stateId} onChange={(e) => setStateId(e.target.value)}>
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
              disabled={!stateId}
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
              disabled={!lgaId}
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
              disabled={!wardId}
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

          {error && <p className="error-text">{error}</p>}
          <Button type="submit" variant="primary" fullWidth disabled={loading}>
            {loading ? stage || 'Working…' : 'Create account with fingerprint'}
          </Button>
        </form>
        <p className="text-sm text-center text-[var(--muted)]">
          Already have an account? <Link to="/login" className="text-[var(--accent)] font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
