import { useState } from 'react';
import { ContextMenu } from '../components/ContextMenu';
import type { SnapshotKind } from '../state/frameSnapshot';
import { downloadFillKeyPair, downloadFrameSnapshot } from '../state/frameSnapshotDownload';

/** Footer camera button: downloads the current frame as PNG at composition resolution. */
export function SnapshotButton() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = (label: string, action: () => Promise<void>) => {
    setStatus(`Saving ${label}…`);
    action()
      .then(() => setStatus(null))
      .catch((error: unknown) =>
        setStatus(error instanceof Error ? error.message : 'The snapshot could not be saved.'),
      );
  };
  const frame = (kind: SnapshotKind, label: string) => () =>
    run(label, () => downloadFrameSnapshot(kind));

  return (
    <>
      {status && (
        <span className="viewport-footer-status" role="status">
          {status}
        </span>
      )}
      <button
        type="button"
        className="viewport-footer-icon"
        aria-label="Snapshot frame"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        title="Snapshot the current frame as PNG"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left, y: rect.top });
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M4 8h3l2-3h6l2 3h3v11H4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Snapshot frame"
          onClose={() => setMenu(null)}
          items={[
            { id: 'alpha', label: 'PNG with alpha', onSelect: frame('alpha', 'PNG') },
            {
              id: 'checker',
              label: 'PNG on checkerboard',
              onSelect: frame('checker', 'PNG'),
            },
            { id: 'black', label: 'PNG on black', onSelect: frame('black', 'PNG') },
            {
              id: 'fill-key',
              label: 'Fill + Key pair (2 files)',
              separatorBefore: true,
              onSelect: () => run('fill and key', downloadFillKeyPair),
            },
          ]}
        />
      )}
    </>
  );
}
