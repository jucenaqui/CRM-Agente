import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS, initials } from '../utils/format';

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  companies: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01',
  contacts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  deals: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  activities: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  users: 'M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z',
};

interface NavItem {
  to: string;
  label: string;
  icon: keyof typeof ICONS;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/companies', label: 'Empresas', icon: 'companies' },
  { to: '/contacts', label: 'Contactos', icon: 'contacts' },
  { to: '/deals', label: 'Deals', icon: 'deals' },
  { to: '/activities', label: 'Actividades', icon: 'activities' },
  { to: '/users', label: 'Usuarios', icon: 'users', adminOnly: true },
];

export function Layout({ children }: { children?: ReactNode }) {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);

  const doLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={`app-shell${open ? ' nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Navegación principal">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true">N</span>
          <span>NEWCRM</span>
        </div>
        <nav>
          <ul>
            {NAV.filter((n) => !n.adminOnly || isAdmin).map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                  <Icon d={ICONS[n.icon]} />
                  <span>{n.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        {user && (
          <div className="sidebar-user">
            <span className="avatar" aria-hidden="true">{initials(user.name)}</span>
            <div className="sidebar-user-info">
              <strong title={user.name}>{user.name}</strong>
              <span>{ROLE_LABELS[user.role]}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={doLogout}>
              Salir
            </button>
          </div>
        )}
      </aside>
      <div className="backdrop-nav" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            ☰
          </button>
          <span className="topbar-title">NEWCRM</span>
        </header>
        <main className="content">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}
