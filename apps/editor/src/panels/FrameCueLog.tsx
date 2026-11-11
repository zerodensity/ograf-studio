import type { StudioFrameCueDetail } from '@ograf-editor/ograf-runtime';

export interface FrameCueLogEntry {
  sequence: number;
  detail: StudioFrameCueDetail;
}

export function FrameCueLog({
  entries,
  onClear,
}: {
  entries: FrameCueLogEntry[];
  onClear: () => void;
}) {
  return (
    <details className="preview-frame-cue-log">
      <summary>Frame Cue Log ({entries.length})</summary>
      {entries.length === 0 ? (
        <p className="panel-placeholder">Play the preview in Live mode to see frame cues here.</p>
      ) : (
        <>
          <div className="preview-controls-row">
            <button type="button" onClick={onClear} aria-label="Clear frame cue log">
              Clear
            </button>
          </div>
          <ol className="preview-log" aria-label="Recent frame cues">
            {entries.map(({ sequence, detail }) => (
              <li className="preview-log-entry" key={sequence}>
                <strong className="preview-log-method">
                  {detail.name} · frame {detail.frame}
                </strong>
                <span>Instance {detail.instanceId}</span>
                {detail.laneId && <span>Lane {detail.laneId}</span>}
                {detail.templateId && <span>Template {detail.templateId}</span>}
                {detail.payload !== undefined && (
                  <span>Payload {JSON.stringify(detail.payload)}</span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}
