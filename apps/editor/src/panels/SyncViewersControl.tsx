import type { ViewerSyncControlSession } from '../state/playoutControlsStore';
import { PreviewError } from './PreviewError';

export function SyncViewersControl({ session }: { session: ViewerSyncControlSession }) {
  return (
    <div className="preview-controls-row">
      <label title="When checked, viewers follow this session. Uncheck to let each viewer control their own preview.">
        <input
          type="checkbox"
          checked={session.checked}
          disabled={session.disabled}
          onChange={(event) => session.onChange(event.target.checked)}
        />{' '}
        Sync viewers
      </label>
      {session.error && <PreviewError message={session.error} />}
    </div>
  );
}
