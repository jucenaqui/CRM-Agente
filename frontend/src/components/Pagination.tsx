interface Props {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onChange }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const nums: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }

  return (
    <nav className="pagination" aria-label="Paginación">
      <span className="muted">
        {from}–{to} de {total}
      </span>
      <div className="pagination-buttons">
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Página anterior">
          ‹
        </button>
        {nums.map((n, i) =>
          n === '…' ? (
            <span key={`e${i}`} className="muted">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              className={`btn btn-sm ${n === page ? 'btn-primary' : 'btn-secondary'}`}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ),
        )}
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Página siguiente">
          ›
        </button>
      </div>
    </nav>
  );
}
