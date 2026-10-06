import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import './AddElementToolbar.css';

/** Canvas top bar: repeat the current selection. Alignment lives in Properties. */
export function AddElementToolbar() {
  const addRepeater = useProjectStore((s) => s.addRepeater);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);

  return (
    <div className="add-element-toolbar">
      {selectedLayerIds.length > 0 && (
        <button
          type="button"
          title="Turn the selection into a data-driven row of three copies"
          onClick={() => {
            const repeater = addRepeater(selectedLayerIds);
            if (repeater) {
              selectMany(repeater.items.flatMap((item) => Object.values(item.layers)));
            }
          }}
        >
          Repeat selection ×3
        </button>
      )}
    </div>
  );
}
