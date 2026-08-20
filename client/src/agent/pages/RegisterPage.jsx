import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Input, Button } from '@heroui/react';
import { api } from '../../api/client';
import AaLogo from '../../components/AaLogo';

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

  const field = 'block text-sm font-medium mb-1.5';

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
        You'll need the invite code given to you for your polling unit.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="inviteCode" className={field}>Invite code</label>
          <Input
            id="inviteCode"
            type="text"
            value={form.inviteCode}
            onChange={(e) => update({ inviteCode: e.target.value.toUpperCase() })}
            placeholder="e.g. F4LJ-BLCK"
            className="font-mono uppercase tracking-wider"
            required
            fullWidth
          />
        </div>
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
          <label htmlFor="identifier" className={field}>Email or phone number</label>
          <Input
            id="identifier"
            type="text"
            value={form.identifier}
            onChange={(e) => update({ identifier: e.target.value })}
            autoComplete="username"
            required
            fullWidth
          />
        </div>
        <div>
          <label htmlFor="password" className={field}>Password</label>
          <Input
            id="password"
            type="password"
            value={form.password}
            onChange={(e) => update({ password: e.target.value })}
            autoComplete="new-password"
            required
            fullWidth
          />
        </div>
        <div>
          <label htmlFor="confirm" className={field}>Confirm password</label>
          <Input
            id="confirm"
            type="password"
            value={form.confirm}
            onChange={(e) => update({ confirm: e.target.value })}
            autoComplete="new-password"
            required
            fullWidth
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <Button type="submit" variant="primary" fullWidth>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="text-sm text-center text-[var(--muted)]">
        Already have an account? <Link to="/login" className="text-[var(--accent)] font-medium">Sign in</Link>
      </p>
      </div>
    </div>
  );
}