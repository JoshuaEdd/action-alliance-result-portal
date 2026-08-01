import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ inviteCode: '', fullName: '', identifier: '', password: '', confirm: '' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (form.password !== form.confirm) {
      setError("Passwords don't match");
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await api.register(form.inviteCode.trim(), form.fullName.trim(), form.identifier.trim(), form.password);
      navigate('/login', { state: { justRegistered: true } });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="step-content" style={{ paddingTop: 48 }}>
      <h1 style={{ fontSize: 22 }}>Create your agent account</h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 24 }}>
        You'll need the invite code given to you for your polling unit.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="inviteCode">Invite code</label>
          <input
            id="inviteCode"
            type="text"
            value={form.inviteCode}
            onChange={(e) => update({ inviteCode: e.target.value.toUpperCase() })}
            placeholder="e.g. F4LJ-BLCK"
            style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', textTransform: 'uppercase' }}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="fullName">Full name</label>
          <input
            id="fullName"
            type="text"
            value={form.fullName}
            onChange={(e) => update({ fullName: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="identifier">Email or phone number</label>
          <input
            id="identifier"
            type="text"
            value={form.identifier}
            onChange={(e) => update({ identifier: e.target.value })}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={(e) => update({ password: e.target.value })}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            value={form.confirm}
            onChange={(e) => update({ confirm: e.target.value })}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p style={{ fontSize: 13, marginTop: 16, textAlign: 'center' }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
