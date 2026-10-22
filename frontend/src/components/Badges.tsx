import type { ActivityType, DealStage } from '../api/types';
import { ACTIVITY_LABELS } from '../utils/format';
import { usePipeline } from '../utils/pipeline';

/** Etapa con su color como punto y el nombre en texto normal (el texto nunca lleva el color de los datos). */
export function StageBadge({ stage }: { stage: DealStage }) {
  const p = usePipeline();
  return (
    <span className="badge badge-stage">
      <i className="stage-dot" style={{ background: p.stageColor(stage) }} aria-hidden="true" />
      {p.stageName(stage)}
    </span>
  );
}

export function ActivityTypeBadge({ type }: { type: ActivityType }) {
  return <span className={`badge type-${type}`}>{ACTIVITY_LABELS[type] ?? type}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function SortHeader({
  field,
  label,
  sort,
  order,
  onSort,
}: {
  field: string;
  label: string;
  sort?: string;
  order: 'asc' | 'desc';
  onSort: (f: string) => void;
}) {
  const active = sort === field;
  return (
    <th aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="th-sort" onClick={() => onSort(field)}>
        {label}
        <span className="sort-ind" aria-hidden="true">
          {active ? (order === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}
