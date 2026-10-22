import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { TextField } from '../components/Form';
import { Alert, Spinner } from '../components/States';
import { errorMessage } from '../api/client';
import { isEmail } from '../utils/validation';

/** Sólo acepta rutas internas para evitar open redirects. */
function safeFrom(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!email.trim()) errs.email = 'El email es obligatorio';
    else if (!isEmail(email)) errs.email = 'Email inválido';
    if (!password) errs.password = 'La contraseña es obligatoria';
    setErrors(errs);
    if (errs.email || errs.password) return;

    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(safeFrom((location.state as { from?: unknown } | null)?.from), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate aria-labelledby="login-title">
        <div className="brand brand-center">
          <span className="brand-logo" aria-hidden="true">N</span>
          <span>NEWCRM</span>
        </div>
        <h1 id="login-title">Iniciar sesión</h1>
        <p className="muted">Accede a tu cuenta para gestionar tu pipeline.</p>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />
        <TextField
          label="Contraseña"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          required
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy && <Spinner small />} Entrar
        </button>
        <p className="auth-switch">
          ¿No tienes cuenta? <Link to="/register">Regístrate</Link>
        </p>
      </form>
    </div>
  );
}
