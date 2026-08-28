import { useCallback, useRef, useState } from 'react';
import { Menubar } from '../panels/Menubar';
import { Stage } from '../canvas/Stage';
import { AgentReviewPanel } from '../panels/AgentReviewPanel';
import { DockWorkspace, type DockPaneCommand } from './DockWorkspace';
import type { DockPaneId } from './dockModel';
import { NumericScrubController } from '../components/NumericScrubController';
import './AppShell.css';

export function AppShell() {
  const [closedDockPanes, setClosedDockPanes] = useState<DockPaneId[]>([]);
  const [dockPaneCommand, setDockPaneCommand] = useState<DockPaneCommand | null>(null);
  const dockCommandId = useRef(0);

  const updateClosedDockPanes = useCallback((panes: DockPaneId[]) => {
    setClosedDockPanes(panes);
  }, []);
  const commandDockPane = (pane: DockPaneId, action: DockPaneCommand['action']) => {
    setDockPaneCommand({ id: ++dockCommandId.current, pane, action });
  };

  return (
    <div className="app-shell">
      <Menubar
        closedDockPanes={closedDockPanes}
        onToggleDockPane={(pane) =>
          commandDockPane(pane, closedDockPanes.includes(pane) ? 'open' : 'close')
        }
      />
      <DockWorkspace
        paneCommand={dockPaneCommand}
        onClosedPanesChange={updateClosedDockPanes}
        center={<Stage />}
      />
      <AgentReviewPanel />
      <NumericScrubController />
    </div>
  );
}
