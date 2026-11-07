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
import { ShaderResourceEditorHost } from '../panels/ShaderResources';
import { ComponentEditorDialogHost } from '../panels/ComponentEditorDialog';
import { WorkspaceDialogHost } from '../components/WorkspaceDialogs';
import { CertifiedPackageSaveDialogHost } from '../components/CertifiedPackageSaveDialog';
import { PluginLoadWarningDialogHost } from '../components/PluginLoadWarningDialog';
import { useProjectFonts } from '../state/useProjectFonts';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { StartupScreen } from '../components/StartupScreen';
import { useProjectStore } from '../state/projectStore';
import { revealPaneOnFirstUse } from '../state/firstUsePanes';
import { DOCK_PANE_LABELS } from './dockModel';
import './AppShell.css';

export function AppShell() {
  useProjectFonts();
  const [paneNotice, setPaneNotice] = useState('');
  useEffect(() => {
    let timer: number | undefined;
    let deferredReveal: number | undefined;
    const notice = (event: Event) => {
      const pane = (event as CustomEvent<DockPaneId>).detail;
      setPaneNotice(`${DOCK_PANE_LABELS[pane]} opened. Use its close button to hide it.`);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPaneNotice(''), 4500);
    };
    window.addEventListener('ograf-first-use-pane', notice);
    let previous = useProjectStore.getState();
    const unsubscribeProject = useProjectStore.subscribe((next) => {
      if (
        next.project.id === previous.project.id &&
        next.activeCompositionId === previous.activeCompositionId
      ) {
        const oldComp = previous.project.compositions.find(
          (item) => item.id === previous.activeCompositionId,
        );
        const newComp = next.project.compositions.find(
          (item) => item.id === next.activeCompositionId,
        );
        if (oldComp && newComp) {
          const addedData = newComp.dataFields.length > oldComp.dataFields.length;
          if (addedData) revealPaneOnFirstUse('data');
          const countRules = (layers: typeof newComp.layers) =>
            layers.reduce((total, layer) => total + (layer.visualRules?.length ?? 0), 0);
          if (countRules(newComp.layers) > countRules(oldComp.layers)) {
            if (addedData)
              deferredReveal = window.setTimeout(() => revealPaneOnFirstUse('rules'), 100);
            else revealPaneOnFirstUse('rules');
          }
        }
      }
      previous = next;
    });
    return () => {
      unsubscribeProject();
      window.removeEventListener('ograf-first-use-pane', notice);
      window.clearTimeout(timer);
      window.clearTimeout(deferredReveal);
    };
  }, []);
  useEffect(() => {
    const pane = new URLSearchParams(window.location.search).get('pane');
    if (pane === 'transition-logic' || pane === 'transitions')
      usePaneRequestStore.getState().reveal('transitions');
    else if (pane === 'functions') usePaneRequestStore.getState().reveal('functions');
  }, []);
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
          onCenterDockPane={(pane) => commandDockPane(pane, 'float-center')}
        />
        <PluginLoadWarningDialogHost />
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
        <ShaderResourceEditorHost />
        <ComponentEditorDialogHost />
        <WorkspaceDialogHost />
        <CertifiedPackageSaveDialogHost />
        <StartupScreen />
        {paneNotice && (
          <div className="app-first-use-notice" role="status">
            {paneNotice}
          </div>
        )}
      </div>
    </DetachedWindowsProvider>
  );
}
