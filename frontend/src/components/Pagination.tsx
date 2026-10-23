export default function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  if (total === 0) return null;

  const start = offset + 1;
  const end = Math.min(offset + limit, total);

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted">
        {start}–{end} of {total}
      </span>
      <div className="pagination-buttons">
        <button
          type="button"
          className="button secondary"
          onClick={() => onChange(Math.max(0, offset - limit))}
          disabled={offset <= 0}
        >
          Previous
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => onChange(offset + limit)}
          disabled={offset + limit >= total}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
