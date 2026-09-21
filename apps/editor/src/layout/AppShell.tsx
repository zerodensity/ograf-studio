import { DetachedWindowsProvider } from './DetachedWindows';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Menubar } from '../panels/Menubar';
import { Stage } from '../canvas/Stage';
import { AgentProposalCanvas } from '../canvas/AgentProposalCanvas';
import { useAgentReviewStore } from '../state/agentReviewStore';
import { DockWorkspace, type DockPaneCommand } from './DockWorkspace';
import type { DockPaneId } from './dockModel';
import { NumericScrubController } from '../components/NumericScrubController';
import { PatternDialogHost } from '../panels/PatternResources';
import { useProjectFonts } from '../state/useProjectFonts';
import './AppShell.css';

export function AppShell() {
  useProjectFonts();
  const proposals = useAgentReviewStore((state) => state.proposals);
  const proposal = proposals[0];
  useEffect(() => {
    const pending = proposals.filter((item) => !item.staleReason);
    if (!pending.length) return;
    const expiresAt = Math.min(...pending.map((item) => Date.parse(item.previewExpiresAt)));
    const timer = window.setTimeout(
      () => {
        for (const item of useAgentReviewStore.getState().proposals)
          if (Date.parse(item.previewExpiresAt) <= Date.now())
            useAgentReviewStore.getState().update(item.id, {
              staleReason: 'This proposal expired. Ask the assistant to regenerate it.',
              previewReady: false,
            });
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [proposals]);
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
    <DetachedWindowsProvider>
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
          center={
            proposal && !proposal.staleReason ? (
              <AgentProposalCanvas key={proposal.id} proposal={proposal} />
            ) : (
              <Stage />
            )
          }
        />
        <NumericScrubController />
        <PatternDialogHost />
      </div>
    </DetachedWindowsProvider>
  );
}
