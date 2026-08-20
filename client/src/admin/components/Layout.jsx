import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AaLogo from '../../components/AaLogo';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const canSeeCorrections = ['verifying_admin', 'chief_admin'].includes(user?.role);
  const canManageAdmins = user?.role === 'chief_admin';

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="brand">
          <AaLogo size={45} />
          <div>
            <div className="brand-name">Action Alliance</div>
            <div className="brand-sub">Result Portal — Admin</div>
          </div>
        </div>
        <nav>
          <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'active' : '')}>
            Dashboard
          </NavLink>
          {canSeeCorrections && (
            <NavLink to="/corrections" className={({ isActive }) => (isActive ? 'active' : '')}>
              Correction Requests
            </NavLink>
          )}
          {canManageAdmins && (
            <NavLink to="/admins" className={({ isActive }) => (isActive ? 'active' : '')}>
              Administrators
            </NavLink>
          )}
        </nav>
        <div className="signed-in-as">
          Signed in as<br />
          <strong>{user?.fullName}</strong>
          <br />
          {user?.role?.replace('_', ' ')}
        </div>
        <button className="logout" onClick={logout}>Sign out</button>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
