import { useEffect, useState } from 'react';
import { usersApi } from '../../api/endpoints';
import type { Role, User, UserInput } from '../../api/types';
import { SelectField, TextField } from '../Form';
import { FormModal } from './FormModal';
import { ROLE_LABELS } from '../../utils/format';
import { isEmail, maxLen, passwordRule, required, type Errors } from '../../utils/validation';

interface Props {
  open: boolean;
  user?: User | null;
  onClose: () => void;
  onSaved: (u: User) => void;
}

const empty = { name: '', email: '', password: '', role: 'sales' as Role };
type F = typeof empty;

export function UserForm({ open, user, onClose, onSaved }: Props) {
  const [f, setF] = useState<F>(empty);
  const [errors, setErrors] = useState<Errors<F>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(user ? { name: user.name, email: user.email, password: '', role: user.role } : empty);
  }, [open, user]);

  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const validate = () => {
    const e: Errors<F> = {
      name: required(f.name, 'El nombre') ?? maxLen(f.name, 100),
      email: required(f.email, 'El email') ?? (isEmail(f.email) ? undefined : 'Email inválido'),
      // Al editar, la contraseña es opcional (sólo se envía si se rellena).
      password: user && !f.password ? undefined : passwordRule(f.password),
    };
    setErrors(e);
    return Object.values(e).some(Boolean);
  };

  const save = async () => {
    const body: UserInput = { name: f.name.trim(), email: f.email.trim(), role: f.role };
    if (f.password) body.password = f.password;
    const saved = user ? await usersApi.update(user.id, body) : await usersApi.create(body);
    onSaved(saved);
  };

  return (
    <FormModal
      open={open}
      title={user ? 'Editar usuario' : 'Nuevo usuario'}
      onClose={onClose}
      validate={validate}
      save={save}
      onFieldErrors={(fe) => setErrors((x) => ({ ...x, ...fe }))}
    >
      <TextField label="Nombre" value={f.name} onChange={set('name')} error={errors.name} required maxLength={100} />
      <TextField label="Email" type="email" value={f.email} onChange={set('email')} error={errors.email} required autoComplete="off" />
      <TextField
        label={user ? 'Nueva contraseña' : 'Contraseña'}
        type="password"
        value={f.password}
        onChange={set('password')}
        error={errors.password}
        hint={user ? 'Déjalo vacío para no cambiarla' : 'Mínimo 8 caracteres'}
        required={!user}
        autoComplete="new-password"
      />
      <SelectField label="Rol" value={f.role} onChange={set('role')}>
        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </SelectField>
    </FormModal>
  );
}
