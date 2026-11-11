import { installEditorShortcuts } from './state/editorShortcuts';
import { useEffect } from 'react';
import { AppShell } from './layout/AppShell';
import { useAutosave } from './state/useAutosave';
import { useAgentBridge } from './state/agentBridge';
import { suppressBrowserContextMenu } from './state/browserContextMenu';
import { installSharedPlayoutAutoFollow } from './state/sharedPlayoutEditor';

function App() {
  useAutosave();

  useEffect(() => installEditorShortcuts(window), []);
  useEffect(() => suppressBrowserContextMenu(document), []);
  useEffect(() => installSharedPlayoutAutoFollow(), []);

  useAgentBridge();

  return <AppShell />;
}

export default App;
