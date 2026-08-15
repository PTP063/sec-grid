import { useErrorStore } from '../../store/useErrorStore';

export function ErrorOverlay() {
  const errors = useErrorStore((state) => state.errors);
  const dismissError = useErrorStore((state) => state.dismissError);

  if (errors.length === 0) return null;

  return (
    <div className="flex-col gap-2" style={{ position: 'fixed', top: 16, right: 16, zIndex: 99999, maxWidth: 380 }}>
      {errors.map((err) => (
        <div
          key={err.id}
          className="glass-inner"
          style={{ background: 'rgba(69, 10, 10, 0.8)', borderColor: 'rgba(239, 68, 68, 0.5)', color: 'var(--color-zinc-100)' }}
        >
          <div className="flex-row justify-between" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
            <h4 className="text-metric" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-red-400)' }}>Error</h4>
            <button
              onClick={() => dismissError(err.id)}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--color-red-400)',
                border: 'none',
                padding: '2px 6px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              ✕
            </button>
          </div>
          <p className="mono" style={{ fontSize: 11, wordBreak: 'break-word', marginBottom: 4, color: 'var(--color-zinc-200)' }}>
            {err.message}
          </p>
          {err.stack && (
            <details style={{ marginTop: 8 }}>
              <summary className="text-metric" style={{ fontSize: 9, cursor: 'pointer', color: 'rgba(248, 113, 113, 0.8)' }}>Show Stack</summary>
              <pre className="mono" style={{ fontSize: 8, overflowX: 'auto', marginTop: 4, opacity: 0.7, padding: 4, background: 'rgba(0,0,0,0.4)', borderRadius: 4 }}>
                {err.stack}
              </pre>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
