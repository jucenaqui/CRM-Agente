import { useEffect, useState } from 'react';
import { dealsApi } from '../../api/endpoints';
import type { Company, Contact, Deal, DealStage } from '../../api/types';
import { SelectField, TextField } from '../Form';
import { FormModal } from './FormModal';
import { formatDate, fromInputToIso, toDateInput } from '../../utils/format';
import { usePipeline } from '../../utils/pipeline';
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

const empty = { title: '', value: '', currency: 'USD', stage: '' as DealStage, companyId: '', contactId: '', expectedCloseDate: '', sourceId: '', lostReasonId: '' };
type F = typeof empty;

/** Si el deal usa una opción ya archivada, se sigue mostrando (deshabilitada) en lugar de desaparecer. */
function withCurrent(options: { id: number; name: string; archived: boolean }[], current: string) {
  if (current === '' || options.some((o) => String(o.id) === current)) return options;
  return [...options, { id: Number(current), name: 'Opción archivada', archived: true }];
}

export function DealForm({ open, deal, companies, contacts, defaults, onClose, onSaved }: Props) {
  const pipeline = usePipeline();
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
            sourceId: deal.sourceId != null ? String(deal.sourceId) : '',
            lostReasonId: deal.lostReasonId != null ? String(deal.lostReasonId) : '',
          }
        : {
            ...empty,
            stage: defaults?.stage ?? pipeline.defaultStage,
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
      sourceId: idOrNull(f.sourceId),
      // el motivo sólo tiene sentido en una etapa perdida
      lostReasonId: pipeline.stageKind(f.stage) === 'lost' ? idOrNull(f.lostReasonId) : null,
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
        {pipeline.stages.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
          </option>
        ))}
      </SelectField>
      {pipeline.stageKind(f.stage) === 'lost' && (
        <SelectField label="Motivo de pérdida" value={f.lostReasonId} onChange={set('lostReasonId')}>
          <option value="">— Sin especificar —</option>
          {withCurrent(pipeline.lossReasons, f.lostReasonId).map((o) => (
            <option key={o.id} value={o.id} disabled={o.archived}>
              {o.name}
            </option>
          ))}
        </SelectField>
      )}
      <SelectField label="Origen del lead" value={f.sourceId} onChange={set('sourceId')}>
        <option value="">— Sin especificar —</option>
        {withCurrent(pipeline.leadSources, f.sourceId).map((o) => (
          <option key={o.id} value={o.id} disabled={o.archived}>
            {o.name}
          </option>
        ))}
      </SelectField>
      <TextField label="Cierre esperado" type="date" value={f.expectedCloseDate} onChange={set('expectedCloseDate')} />
      {deal?.closedAt && (
        <p className="muted small span-2">
          Cerrado el {formatDate(deal.closedAt)} (la fecha se registra sola al pasar el deal a una etapa ganada o perdida).
        </p>
      )}
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
