import type { Activity } from '../api/types';
import { ActivityTypeBadge } from './Badges';
import { formatDateTime, isOverdue } from '../utils/format';

interface Props {
  activity: Activity;
  onToggle: (a: Activity) => void;
  onEdit?: (a: Activity) => void;
  onDelete?: (a: Activity) => void;
  busy?: boolean;
  meta?: React.ReactNode;
}

export function ActivityRow({ activity: a, onToggle, onEdit, onDelete, busy, meta }: Props) {
  const overdue = isOverdue(a.dueDate, a.completed);
  return (
    <li className={`activity-item${a.completed ? ' is-done' : ''}`}>
      <input
        type="checkbox"
        className="activity-check"
        checked={a.completed}
        disabled={busy}
        onChange={() => onToggle(a)}
        aria-label={a.completed ? `Marcar "${a.subject}" como pendiente` : `Marcar "${a.subject}" como completada`}
      />
      <div className="activity-main">
        <div className="activity-head">
          <ActivityTypeBadge type={a.type} />
          <strong className="activity-subject">{a.subject}</strong>
        </div>
        {a.description && <p className="activity-desc">{a.description}</p>}
        <div className="activity-meta">
          <span className={overdue ? 'text-danger' : 'muted'}>
            {a.dueDate ? `${overdue ? 'Vencida · ' : ''}${formatDateTime(a.dueDate)}` : 'Sin fecha'}
          </span>
          {meta}
        </div>
      </div>
      {(onEdit || onDelete) && (
        <div className="activity-actions">
          {onEdit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(a)}>
              Editar
            </button>
          )}
          {onDelete && (
            <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => onDelete(a)}>
              Eliminar
            </button>
          )}
        </div>
      )}
    </li>
  );
}
