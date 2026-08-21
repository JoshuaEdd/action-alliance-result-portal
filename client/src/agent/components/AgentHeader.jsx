import { useEffect, useState } from 'react';
import { listPending } from '../../api/offlineQueue';
import { useAuth } from '../../context/AuthContext';

// Gradient hero header for the agent app with live field-status chips:
// connectivity, GPS lock state, and how many submissions are still queued
// on this device waiting for a signal.
export default function AgentHeader({ gps }) {
  const { user } = useAuth();
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const refresh = () => listPending().then((rows) => setPending(rows.length)).catch(() => {});
    const goOnline = () => { setOnline(true); refresh(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="agent-hero">
      <div className="agent-hero-top">
        <div>
          <div className="agent-hero-eyebrow">Field Agent</div>
          <div className="agent-hero-name">{user?.fullName || 'Agent'}</div>
        </div>
        <div className={`hero-avatar`}>{(user?.fullName || 'A').charAt(0)}</div>
      </div>
      <div className="chip-row">
        <span className={`chip ${online ? 'chip-ok' : 'chip-warn'}`}>
          <span className="chip-dot" />{online ? 'Online' : 'Offline'}
        </span>
        <span className={`chip ${gps ? 'chip-ok' : ''}`}>
          📍 {gps ? `±${Math.round(gps.accuracy)}m` : 'No GPS'}
        </span>
        {pending > 0 && <span className="chip chip-warn">⇪ {pending} pending</span>}
      </div>
    </header>
  );
}
