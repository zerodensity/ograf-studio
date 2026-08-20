import { useProjectStore, type NewLayerKind } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useTimelineStore } from '../state/timelineStore';
import './AddElementToolbar.css';

const KINDS: { kind: NewLayerKind; label: string }[] = [
  { kind: 'rectangle', label: '+ Rectangle' },
  { kind: 'ellipse', label: '+ Ellipse' },
  { kind: 'text', label: '+ Text' },
  { kind: 'image', label: '+ Image' },
  { kind: 'path', label: '+ Path' },
  { kind: 'image-sequence', label: '+ Image Sequence' },
];

export function AddElementToolbar({ onEnterOgrafPreview }: { onEnterOgrafPreview?: () => void }) {
  const addLayer = useProjectStore((s) => s.addLayer);
  const alignLayers = useProjectStore((s) => s.alignLayers);
  const distributeLayers = useProjectStore((s) => s.distributeLayers);
  const groupLayers = useProjectStore((s) => s.groupLayers);
  const ungroupLayers = useProjectStore((s) => s.ungroupLayers);
  const select = useSelectionStore((s) => s.select);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  return (
    <div className="add-element-toolbar">
      <div className="stage-mode-switch" role="group" aria-label="Canvas mode">
        <button type="button" className="active" aria-pressed="true">
          Edit
        </button>
        <button type="button" onClick={onEnterOgrafPreview} aria-pressed="false">
          OGraf Preview
        </button>
      </div>
      <span className="toolbar-divider" aria-hidden="true" />
      {KINDS.map(({ kind, label }) => (
        <button key={kind} type="button" onClick={() => select(addLayer(kind))}>
          {label}
        </button>
      ))}
      {selectedLayerIds.length > 1 && (
        <div className="layout-toolbar" role="group" aria-label="Align and group selected layers">
          {[
            ['left', 'Align left', '⇤'],
            ['horizontal-center', 'Align horizontal centers', '↔'],
            ['right', 'Align right', '⇥'],
            ['top', 'Align top', '↥'],
            ['vertical-center', 'Align vertical centers', '↕'],
            ['bottom', 'Align bottom', '↧'],
          ].map(([mode, title, label]) => (
            <button
              key={mode}
              type="button"
              title={title}
              onClick={() =>
                alignLayers(
                  selectedLayerIds,
                  currentFrame,
                  mode as Parameters<typeof alignLayers>[2],
                )
              }
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            title="Distribute horizontally"
            onClick={() => distributeLayers(selectedLayerIds, currentFrame, 'horizontal')}
          >
            H≡
          </button>
          <button
            type="button"
            title="Distribute vertically"
            onClick={() => distributeLayers(selectedLayerIds, currentFrame, 'vertical')}
          >
            V≡
          </button>
          <button type="button" onClick={() => groupLayers(selectedLayerIds)}>
            Group
          </button>
          <button type="button" onClick={() => ungroupLayers(selectedLayerIds)}>
            Ungroup
          </button>
        </div>
      )}
    </div>
  );
}
