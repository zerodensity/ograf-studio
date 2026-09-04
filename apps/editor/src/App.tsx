import { installEditorShortcuts } from './state/editorShortcuts';
import { useEffect } from 'react';
import { AppShell } from './layout/AppShell';
import { useAutosave } from './state/useAutosave';
import { useAgentBridge } from './state/agentBridge';

function App() {
  useAutosave();

  useEffect(() => installEditorShortcuts(window), []);

  useAgentBridge();

  return <AppShell />;
}

export default App;
