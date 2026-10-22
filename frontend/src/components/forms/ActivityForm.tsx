import { useEffect, useState } from 'react';
import { activitiesApi } from '../../api/endpoints';
import { ACTIVITY_TYPES, type Activity, type ActivityType, type Contact, type Deal } from '../../api/types';
import { SelectField, TextAreaField, TextField } from '../Form';
import { FormModal } from './FormModal';
import { ACTIVITY_LABELS, emptyToNull, fromInputToIso, toDateTimeInput } from '../../utils/format';
import { maxLen, required, type Errors } from '../../utils/validation';
import { contactFullName, idOrNull } from '../../utils/lookups';

interface Props {
  open: boolean;
  activity?: Activity | null;
  contacts: Contact[];
  deals: Deal[];
  defaults?: { contactId?: number | null; dealId?: number | null };
  onClose: () => void;
  onSaved: (a: Activity) => void;
}

const empty = { type: 'task' as ActivityType, subject: '', description: '', dueDate: '', completed: false, contactId: '', dealId: '' };
type F = typeof empty;

export function ActivityForm({ open, activity, contacts, deals, defaults, onClose, onSaved }: Props) {
  const [f, setF] = useState<F>(empty);
  const [errors, setErrors] = useState<Errors<F>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      activity
        ? {
            type: activity.type,
            subject: activity.subject,
            description: activity.description ?? '',
            dueDate: toDateTimeInput(activity.dueDate),
            completed: activity.completed,
            contactId: activity.contactId != null ? String(activity.contactId) : '',
            dealId: activity.dealId != null ? String(activity.dealId) : '',
          }
        : {
            ...empty,
            contactId: defaults?.contactId != null ? String(defaults.contactId) : '',
            dealId: defaults?.dealId != null ? String(defaults.dealId) : '',
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activity]);

  const set = (k: keyof F) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const validate = () => {
    const e: Errors<F> = {
      subject: required(f.subject, 'El asunto') ?? maxLen(f.subject, 200),
      description: maxLen(f.description, 2000),
    };
    setErrors(e);
    return Object.values(e).some(Boolean);
  };

  const save = async () => {
    const body = {
      type: f.type,
      subject: f.subject.trim(),
      description: emptyToNull(f.description),
      dueDate: fromInputToIso(f.dueDate),
      completed: f.completed,
      contactId: idOrNull(f.contactId),
      dealId: idOrNull(f.dealId),
    };
    const saved = activity ? await activitiesApi.update(activity.id, body) : await activitiesApi.create(body);
    onSaved(saved);
  };

  return (
    <FormModal
      open={open}
      title={activity ? 'Editar actividad' : 'Nueva actividad'}
      onClose={onClose}
      validate={validate}
      save={save}
      onFieldErrors={(fe) => setErrors((x) => ({ ...x, ...fe }))}
    >
      <SelectField label="Tipo" value={f.type} onChange={set('type')}>
        {ACTIVITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {ACTIVITY_LABELS[t]}
          </option>
        ))}
      </SelectField>
      <TextField label="Fecha límite" type="datetime-local" value={f.dueDate} onChange={set('dueDate')} />
      <div className="span-2">
        <TextField label="Asunto" value={f.subject} onChange={set('subject')} error={errors.subject} required maxLength={200} />
      </div>
      <div className="span-2">
        <TextAreaField label="Descripción" value={f.description} onChange={set('description')} error={errors.description} maxLength={2000} />
      </div>
      <SelectField label="Contacto" value={f.contactId} onChange={set('contactId')}>
        <option value="">— Ninguno —</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {contactFullName(c)}
          </option>
        ))}
      </SelectField>
      <SelectField label="Deal" value={f.dealId} onChange={set('dealId')}>
        <option value="">— Ninguno —</option>
        {deals.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
      </SelectField>
      <label className="checkbox span-2">
        <input type="checkbox" checked={f.completed} onChange={(e) => setF((x) => ({ ...x, completed: e.target.checked }))} />
        Completada
      </label>
    </FormModal>
  );
}
