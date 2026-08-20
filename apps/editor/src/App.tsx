import { useEffect, useRef } from 'react';
import { AppShell } from './layout/AppShell';
import { useProjectStore } from './state/projectStore';
import { useAutosave } from './state/useAutosave';
import { loadAutosave } from './state/fileIO';
import { undo, redo } from './state/historyStore';
import { useAgentBridge } from './state/agentBridge';
import { useTimelineStore } from './state/timelineStore';
import { isInteractiveShortcutTarget } from './state/keyboardShortcuts';

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInteractiveShortcutTarget(e.target)) return;
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        const { controller, isPlaying } = useTimelineStore.getState();
        if (!controller) return;
        e.preventDefault();
        if (isPlaying) controller.pause();
        else controller.play();
        return;
      }
      const isModifier = e.ctrlKey || e.metaKey;
      if (!isModifier || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useAgentBridge();

  return <AppShell />;
}

export default App;
