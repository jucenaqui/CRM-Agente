import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { TextField } from '../components/Form';
import { Alert, Spinner } from '../components/States';
import { ApiError, errorMessage } from '../api/client';
import { isEmail, passwordRule } from '../utils/validation';

interface Errs {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Errs>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Errs = {};
    if (!form.name.trim()) errs.name = 'El nombre es obligatorio';
    else if (form.name.length > 100) errs.name = 'Máximo 100 caracteres';
    if (!form.email.trim()) errs.email = 'El email es obligatorio';
    else if (!isEmail(form.email)) errs.email = 'Email inválido';
    errs.password = passwordRule(form.password);
    if (form.confirm !== form.password) errs.confirm = 'Las contraseñas no coinciden';
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setBusy(true);
    setError(null);
    try {
      await register(form.name.trim(), form.email.trim(), form.password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setErrors((x) => ({ ...x, ...err.fieldErrors() }));
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate aria-labelledby="register-title">
        <div className="brand brand-center">
          <span className="brand-logo" aria-hidden="true">N</span>
          <span>NEWCRM</span>
        </div>
        <h1 id="register-title">Crear cuenta</h1>
        <p className="muted">El primer usuario registrado será administrador.</p>
        {error && <Alert>{error}</Alert>}
        <TextField label="Nombre" autoComplete="name" value={form.name} onChange={set('name')} error={errors.name} required maxLength={100} />
        <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required />
        <TextField
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          hint="Mínimo 8 caracteres"
          required
        />
        <TextField
          label="Confirmar contraseña"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
          required
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy && <Spinner small />} Crear cuenta
        </button>
        <p className="auth-switch">
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </p>
      </form>
    </div>
  );
}
