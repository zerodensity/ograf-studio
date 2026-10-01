import { installScriptLogs } from './state/scriptLogsStore';
import { installEditorShortcuts } from './state/editorShortcuts';
import { useEffect, useLayoutEffect } from 'react';
import { AppShell } from './layout/AppShell';
import { useAutosave } from './state/useAutosave';
import { useAgentBridge } from './state/agentBridge';

function App() {
  useAutosave();
  useLayoutEffect(() => installScriptLogs(window), []);

  useEffect(() => installEditorShortcuts(window), []);

  useAgentBridge();

  return <AppShell />;
}

export default App;
