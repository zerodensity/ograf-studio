import { installEditorShortcuts } from './state/editorShortcuts';
import { useEffect, useRef } from 'react';
import { AppShell } from './layout/AppShell';
import { useProjectStore } from './state/projectStore';
import { useAutosave } from './state/useAutosave';
import { loadAutosave } from './state/fileIO';
import { useAgentBridge } from './state/agentBridge';

function App() {
  useAutosave();

  const loadProject = useProjectStore((s) => s.loadProject);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const autosaved = loadAutosave();
    if (autosaved) loadProject(autosaved);
  }, [loadProject]);

  useEffect(() => installEditorShortcuts(window), []);

  useAgentBridge();

  return <AppShell />;
}

export default App;
