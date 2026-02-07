export function FullPageLoading() {
  return (
    <div className="app-loading" aria-label="Loading">
      <span className="app-loading__dot" />
      <span className="app-loading__dot" />
      <span className="app-loading__dot" />
    </div>
  );
}

export function InlineLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <span
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        padding: '0.25rem 0',
      }}
    >
      <span className="app-loading__dot" />
      <span className="app-loading__dot" />
      <span className="app-loading__dot" />
    </span>
  );
}

