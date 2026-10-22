import { useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from '../Modal';
import { Alert, Spinner } from '../States';
import { ApiError, errorMessage } from '../../api/client';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Valida; devuelve true si hay errores. */
  validate: () => boolean;
  /** Ejecuta el guardado. */
  save: () => Promise<void>;
  /** Recibe errores de campo devueltos por el backend (422/400). */
  onFieldErrors?: (errs: Record<string, string>) => void;
  submitLabel?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function FormModal({ open, title, onClose, validate, save, onFieldErrors, submitLabel = 'Guardar', children, size = 'md' }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (validate()) return;
    setBusy(true);
    try {
      await save();
      setBusy(false);
      onClose();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        const fe = err.fieldErrors();
        if (Object.keys(fe).length) onFieldErrors?.(fe);
      }
      setError(errorMessage(err));
    }
  };

  const formId = `form-${title.replace(/\W+/g, '-').toLowerCase()}`;

  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      size={size}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy && <Spinner small />} {submitLabel}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="form-grid">
        {error && (
          <div className="span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        {children}
      </form>
    </Modal>
  );
}
