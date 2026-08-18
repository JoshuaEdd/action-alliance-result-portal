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

  return (
    <div className="max-w-sm mx-auto pt-20 px-4" style={{ paddingTop: '5rem' }}>
      <div className="flex items-center gap-3 mb-6">
        <AaLogo size={52} />
        <div>
          <h1 className="text-xl m-0" style={{ color: 'var(--aa-green-dark)' }}>Action Alliance</h1>
          <div className="text-[11px] tracking-[0.06em] uppercase" style={{ fontFamily: 'var(--font-mono)', color: 'var(--aa-gold-dark)' }}>
            Create your agent account
          </div>
        </div>
      </div>
      <p className="text-sm mb-5" style={{ color: 'var(--ink-soft)' }}>
        You'll need the invite code given to you for your polling unit.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Invite code"
          type="text"
          value={form.inviteCode}
          onValueChange={(v) => update({ inviteCode: v.toUpperCase() })}
          isRequired
          placeholder="e.g. F4LJ-BLCK"
          variant="bordered"
          size="lg"
          classNames={{ input: 'font-mono tracking-wider uppercase' }}
        />
        <Input
          label="Full name"
          type="text"
          value={form.fullName}
          onValueChange={(v) => update({ fullName: v })}
          isRequired
          variant="bordered"
          size="lg"
        />
        <Input
          label="Email or phone number"
          type="text"
          value={form.identifier}
          onValueChange={(v) => update({ identifier: v })}
          isRequired
          autoComplete="username"
          variant="bordered"
          size="lg"
        />
        <Input
          label="Password"
          type="password"
          value={form.password}
          onValueChange={(v) => update({ password: v })}
          isRequired
          autoComplete="new-password"
          variant="bordered"
          size="lg"
        />
        <Input
          label="Confirm password"
          type="password"
          value={form.confirm}
          onValueChange={(v) => update({ confirm: v })}
          isRequired
          autoComplete="new-password"
          variant="bordered"
          size="lg"
        />
        {error && <p className="error-text">{error}</p>}
        <Button type="submit" color="primary" fullWidth size="lg" isLoading={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="text-sm mt-4 text-center">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}