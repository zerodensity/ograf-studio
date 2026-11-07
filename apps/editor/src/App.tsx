import { installEditorShortcuts } from './state/editorShortcuts';
import { useEffect } from 'react';
import { AppShell } from './layout/AppShell';
import { useAutosave } from './state/useAutosave';
import { useAgentBridge } from './state/agentBridge';
import { suppressBrowserContextMenu } from './state/browserContextMenu';

function App() {
  useAutosave();

  useEffect(() => installEditorShortcuts(window), []);
  useEffect(() => suppressBrowserContextMenu(document), []);

  useAgentBridge();

  return <AppShell />;
}

export default App;
