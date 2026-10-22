import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Loading } from '../components/States';

interface Props {
  /** Si se indica, exige ese rol (p.ej. 'admin'). */
  role?: 'admin' | 'sales';
  children?: ReactNode;
}

export function ProtectedRoute({ role, children }: Props) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Loading label="Cargando sesión…" fullPage />;
  if (status === 'anonymous' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children ? <>{children}</> : <Outlet />;
}

/** Para /login y /register: si ya hay sesión, redirige al inicio. */
export function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <Loading label="Cargando sesión…" fullPage />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}
