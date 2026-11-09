import { normalizeStudioExportDefaults, type StudioExportDefaults } from '../state/workspaceModel';
import { useWorkspaceStore } from '../state/workspaceStore';

export function ExportPreferences() {
  const storedDefaults = useWorkspaceStore((state) => state.editorPreferences.exportDefaults);
  const storageError = useWorkspaceStore((state) => state.storageError);
  const defaults = normalizeStudioExportDefaults(storedDefaults);
  const updateDefaults = (patch: Partial<StudioExportDefaults>) => {
    const workspace = useWorkspaceStore.getState();
    workspace.updateEditorPreferences({
      exportDefaults: {
        ...normalizeStudioExportDefaults(workspace.editorPreferences.exportDefaults),
        ...patch,
      },
    });
  };

  return (
    <>
      <h3>Export defaults</h3>
      <p>Choose the starting options for exports from Studio.</p>
      <label>
        Default export scope
        <select
          value={defaults.scope}
          onChange={(event) =>
            updateDefaults({ scope: event.currentTarget.value as StudioExportDefaults['scope'] })
          }
        >
          <option value="set">Template set</option>
          <option value="template">Current template</option>
        </select>
      </label>
      <label>
        Default export format
        <select
          value={defaults.format}
          onChange={(event) =>
            updateDefaults({ format: event.currentTarget.value as StudioExportDefaults['format'] })
          }
        >
          <option value="both">Both files</option>
          <option value="zip">OGraf ZIP</option>
          <option value="html">Standalone HTML</option>
        </select>
      </label>
      <p>
        With no set open, Studio uses Current template. Sets that export one package per template
        use OGraf ZIP.
      </p>
      {storageError ? (
        <p role="alert" className="workspace-preferences-error">
          {storageError}
        </p>
      ) : null}
    </>
  );
}
