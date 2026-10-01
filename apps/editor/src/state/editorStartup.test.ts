import { afterEach, describe, expect, it } from 'vitest';
import { scriptingErrors } from '@ograf-editor/scene-model';
import { initializeEditorSession } from './editorStartup';
import { useProjectStore } from './projectStore';

afterEach(() => useProjectStore.getState().newProject());

describe('scripting project recovery', () => {
  it.each([[''], ['helpers'], ['helpers.js', 'helpers.js'], ['helpers.js', 'helpers.mjs']])(
    'restores editable module filename errors: %j',
    (...fileNames) => {
      const store = useProjectStore.getState();
      store.newProject();
      store.updateCompositionSettings({
        scripting: {
          enabled: false,
          source: '',
          modules: fileNames.map((fileName) => ({ fileName, source: 'export const gap = 25;' })),
        },
      });
      const saved = JSON.parse(JSON.stringify(useProjectStore.getState().project));
      expect(() => initializeEditorSession(saved)).not.toThrow();
      const restored = useProjectStore.getState().project.compositions[0]!;
      expect(restored.scripting).toEqual(saved.compositions[0].scripting);
      // Recovery keeps the user's code; export still requires correcting the filenames.
      expect(scriptingErrors(restored).length).toBeGreaterThan(0);
      store.updateCompositionSettings({
        scripting: {
          ...restored.scripting!,
          modules: [{ fileName: 'helpers.js', source: 'export const gap = 25;' }],
        },
      });
      expect(scriptingErrors(useProjectStore.getState().project.compositions[0])).toEqual([]);
    },
  );
});
