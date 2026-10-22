import { useEffect, useState } from 'react';
import { contactsApi } from '../../api/endpoints';
import type { Company, Contact } from '../../api/types';
import { SelectField, TextField } from '../Form';
import { FormModal } from './FormModal';
import { emptyToNull } from '../../utils/format';
import { maxLen, optionalEmail, required, type Errors } from '../../utils/validation';
import { idOrNull } from '../../utils/lookups';

interface Props {
  open: boolean;
  contact?: Contact | null;
  companies: Company[];
  defaultCompanyId?: number | null;
  onClose: () => void;
  onSaved: (c: Contact) => void;
}

const empty = { firstName: '', lastName: '', email: '', phone: '', position: '', companyId: '' };
type F = typeof empty;

export function ContactForm({ open, contact, companies, defaultCompanyId, onClose, onSaved }: Props) {
  const [f, setF] = useState<F>(empty);
  const [errors, setErrors] = useState<Errors<F>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      contact
        ? {
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email ?? '',
            phone: contact.phone ?? '',
            position: contact.position ?? '',
            companyId: contact.companyId != null ? String(contact.companyId) : '',
          }
        : { ...empty, companyId: defaultCompanyId != null ? String(defaultCompanyId) : '' },
    );
  }, [open, contact, defaultCompanyId]);

  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const validate = () => {
    const e: Errors<F> = {
      firstName: required(f.firstName, 'El nombre') ?? maxLen(f.firstName, 100),
      lastName: required(f.lastName, 'El apellido') ?? maxLen(f.lastName, 100),
      email: optionalEmail(f.email) ?? maxLen(f.email, 255),
      phone: maxLen(f.phone, 50) ?? (f.phone.trim() && !/^[+\d\s().-]{5,}$/.test(f.phone.trim()) ? 'Teléfono inválido' : undefined),
      position: maxLen(f.position, 100),
    };
    setErrors(e);
    return Object.values(e).some(Boolean);
  };

  const save = async () => {
    const body = {
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      email: emptyToNull(f.email),
      phone: emptyToNull(f.phone),
      position: emptyToNull(f.position),
      companyId: idOrNull(f.companyId),
    };
    const saved = contact ? await contactsApi.update(contact.id, body) : await contactsApi.create(body);
    onSaved(saved);
  };

  return (
    <FormModal
      open={open}
      title={contact ? 'Editar contacto' : 'Nuevo contacto'}
      onClose={onClose}
      validate={validate}
      save={save}
      onFieldErrors={(fe) => setErrors((x) => ({ ...x, ...fe }))}
    >
      <TextField label="Nombre" value={f.firstName} onChange={set('firstName')} error={errors.firstName} required maxLength={100} />
      <TextField label="Apellido" value={f.lastName} onChange={set('lastName')} error={errors.lastName} required maxLength={100} />
      <TextField label="Email" type="email" value={f.email} onChange={set('email')} error={errors.email} maxLength={255} />
      <TextField label="Teléfono" type="tel" value={f.phone} onChange={set('phone')} error={errors.phone} maxLength={50} />
      <TextField label="Cargo" value={f.position} onChange={set('position')} error={errors.position} maxLength={100} />
      <SelectField label="Empresa" value={f.companyId} onChange={set('companyId')}>
        <option value="">— Sin empresa —</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
    </FormModal>
  );
}
