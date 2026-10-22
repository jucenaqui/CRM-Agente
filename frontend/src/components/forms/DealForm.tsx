import { useEffect, useState } from 'react';
import { dealsApi } from '../../api/endpoints';
import { DEAL_STAGES, type Company, type Contact, type Deal, type DealStage } from '../../api/types';
import { SelectField, TextField } from '../Form';
import { FormModal } from './FormModal';
import { STAGE_LABELS, fromInputToIso, toDateInput } from '../../utils/format';
import { maxLen, required, type Errors } from '../../utils/validation';
import { contactFullName, idOrNull } from '../../utils/lookups';

interface Props {
  open: boolean;
  deal?: Deal | null;
  companies: Company[];
  contacts: Contact[];
  defaults?: { companyId?: number | null; contactId?: number | null; stage?: DealStage };
  onClose: () => void;
  onSaved: (d: Deal) => void;
}

const CURRENCIES = ['USD', 'EUR', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'BRL', 'GBP'];

const empty = { title: '', value: '', currency: 'USD', stage: 'lead' as DealStage, companyId: '', contactId: '', expectedCloseDate: '' };
type F = typeof empty;

export function DealForm({ open, deal, companies, contacts, defaults, onClose, onSaved }: Props) {
  const [f, setF] = useState<F>(empty);
  const [errors, setErrors] = useState<Errors<F>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      deal
        ? {
            title: deal.title,
            value: String(deal.value),
            currency: deal.currency || 'USD',
            stage: deal.stage,
            companyId: deal.companyId != null ? String(deal.companyId) : '',
            contactId: deal.contactId != null ? String(deal.contactId) : '',
            expectedCloseDate: toDateInput(deal.expectedCloseDate),
          }
        : {
            ...empty,
            stage: defaults?.stage ?? 'lead',
            companyId: defaults?.companyId != null ? String(defaults.companyId) : '',
            contactId: defaults?.contactId != null ? String(defaults.contactId) : '',
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal]);

  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const validate = () => {
    const n = Number(f.value);
    const e: Errors<F> = {
      title: required(f.title, 'El título') ?? maxLen(f.title, 200),
      value: f.value.trim() === '' ? 'El valor es obligatorio' : !Number.isFinite(n) || n < 0 ? 'Debe ser un número mayor o igual a 0' : undefined,
      currency: /^[A-Z]{3}$/.test(f.currency) ? undefined : 'Moneda inválida',
    };
    setErrors(e);
    return Object.values(e).some(Boolean);
  };

  const save = async () => {
    const body = {
      title: f.title.trim(),
      value: Number(f.value),
      currency: f.currency,
      stage: f.stage,
      companyId: idOrNull(f.companyId),
      contactId: idOrNull(f.contactId),
      expectedCloseDate: fromInputToIso(f.expectedCloseDate),
    };
    const saved = deal ? await dealsApi.update(deal.id, body) : await dealsApi.create(body);
    onSaved(saved);
  };

  return (
    <FormModal
      open={open}
      title={deal ? 'Editar deal' : 'Nuevo deal'}
      onClose={onClose}
      validate={validate}
      save={save}
      onFieldErrors={(fe) => setErrors((x) => ({ ...x, ...fe }))}
    >
      <div className="span-2">
        <TextField label="Título" value={f.title} onChange={set('title')} error={errors.title} required maxLength={200} />
      </div>
      <TextField label="Valor" type="number" min={0} step="0.01" inputMode="decimal" value={f.value} onChange={set('value')} error={errors.value} required />
      <SelectField label="Moneda" value={f.currency} onChange={set('currency')} error={errors.currency}>
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </SelectField>
      <SelectField label="Etapa" value={f.stage} onChange={set('stage')}>
        {DEAL_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </SelectField>
      <TextField label="Cierre esperado" type="date" value={f.expectedCloseDate} onChange={set('expectedCloseDate')} />
      <SelectField label="Empresa" value={f.companyId} onChange={set('companyId')}>
        <option value="">— Ninguna —</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Contacto" value={f.contactId} onChange={set('contactId')}>
        <option value="">— Ninguno —</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {contactFullName(c)}
          </option>
        ))}
      </SelectField>
    </FormModal>
  );
}
