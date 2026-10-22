import { useEffect, useState } from 'react';
import { companiesApi } from '../../api/endpoints';
import type { Company } from '../../api/types';
import { TextField } from '../Form';
import { FormModal } from './FormModal';
import { emptyToNull } from '../../utils/format';
import { maxLen, required, type Errors } from '../../utils/validation';

/** QA BUG-001: el backend exige protocolo http(s); se antepone https:// si falta. */
const normalizeUrl = (v: string): string | null => {
  const t = v.trim();
  return !t ? null : /^https?:\/\//i.test(t) ? t : `https://${t}`;
};

interface Props {
  open: boolean;
  company?: Company | null;
  onClose: () => void;
  onSaved: (c: Company) => void;
}

const empty = { name: '', industry: '', website: '', phone: '', address: '' };
type F = typeof empty;

export function CompanyForm({ open, company, onClose, onSaved }: Props) {
  const [f, setF] = useState<F>(empty);
  const [errors, setErrors] = useState<Errors<F>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      company
        ? {
            name: company.name,
            industry: company.industry ?? '',
            website: company.website ?? '',
            phone: company.phone ?? '',
            address: company.address ?? '',
          }
        : empty,
    );
  }, [open, company]);

  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const validate = () => {
    const e: Errors<F> = {
      name: required(f.name, 'El nombre') ?? maxLen(f.name, 200),
      industry: maxLen(f.industry, 100),
      website:
        maxLen(f.website, 255) ??
        (f.website.trim() && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(f.website.trim()) ? 'URL inválida' : undefined),
      phone: maxLen(f.phone, 50) ?? (f.phone.trim() && !/^[+\d\s().-]{5,}$/.test(f.phone.trim()) ? 'Teléfono inválido' : undefined),
      address: maxLen(f.address, 255),
    };
    setErrors(e);
    return Object.values(e).some(Boolean);
  };

  const save = async () => {
    const body = {
      name: f.name.trim(),
      industry: emptyToNull(f.industry),
      website: normalizeUrl(f.website),
      phone: emptyToNull(f.phone),
      address: emptyToNull(f.address),
    };
    const saved = company ? await companiesApi.update(company.id, body) : await companiesApi.create(body);
    onSaved(saved);
  };

  return (
    <FormModal
      open={open}
      title={company ? 'Editar empresa' : 'Nueva empresa'}
      onClose={onClose}
      validate={validate}
      save={save}
      onFieldErrors={(fe) => setErrors((x) => ({ ...x, ...fe }))}
    >
      <div className="span-2">
        <TextField label="Nombre" value={f.name} onChange={set('name')} error={errors.name} required maxLength={200} />
      </div>
      <TextField label="Industria" value={f.industry} onChange={set('industry')} error={errors.industry} maxLength={100} />
      <TextField label="Sitio web" value={f.website} onChange={set('website')} error={errors.website} placeholder="https://…" maxLength={255} />
      <TextField label="Teléfono" type="tel" value={f.phone} onChange={set('phone')} error={errors.phone} maxLength={50} />
      <TextField label="Dirección" value={f.address} onChange={set('address')} error={errors.address} maxLength={255} />
    </FormModal>
  );
}
