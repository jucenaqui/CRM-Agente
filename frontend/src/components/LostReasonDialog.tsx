import { useEffect, useId, useState } from 'react';
import type { CrmOption } from '../api/types';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  dealTitle: string;
  reasons: CrmOption[];
  /** null: se pierde sin indicar el motivo. */
  onConfirm: (reasonId: number | null) => void;
  onCancel: () => void;
}

/** Se muestra al mover un deal a una etapa «perdida»: el motivo alimenta el informe de por qué se pierde. */
export function LostReasonDialog({ open, dealTitle, reasons, onConfirm, onCancel }: Props) {
  const [value, setValue] = useState('');
  const id = useId();

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  return (
    <Modal
      open={open}
      title="¿Por qué se perdió?"
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={() => onConfirm(value === '' ? null : Number(value))}>
            Marcar como perdido
          </button>
        </>
      }
    >
      <p>
        Vas a marcar <strong>{dealTitle}</strong> como perdido. Indicar el motivo te ayuda a ver por qué pierdes ventas.
      </p>
      <div className="field">
        <label htmlFor={id}>Motivo</label>
        <select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">— Sin especificar —</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
