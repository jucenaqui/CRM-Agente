import { useState } from 'react';
import { Modal } from './Modal';
import { errorMessage } from '../api/client';
import { Alert, Spinner } from './States';

interface Props {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** Modal de confirmación propio (sustituye a window.confirm). */
export function ConfirmDialog({ open, title = 'Confirmar eliminación', message, confirmLabel = 'Eliminar', onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>
            {busy && <Spinner small />} {confirmLabel}
          </button>
        </>
      }
    >
      <p>{message}</p>
      {error && <Alert>{error}</Alert>}
    </Modal>
  );
}
