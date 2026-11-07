export function PropertiesFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="properties-filter">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        aria-label="Filter properties"
        placeholder="Filter properties…"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" aria-label="Clear property filter" onClick={() => onChange('')}>
          ×
        </button>
      ) : null}
    </label>
  );
}
