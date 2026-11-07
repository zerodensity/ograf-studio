import { OgrafLogo } from '../components/OgrafLogo';
import { useMovableDialog } from '../components/useMovableDialog';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { useProjectStore } from '../state/projectStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { insertTemplateProject } from '../state/templateCommands';
import {
  exportProjectSetAsZip,
  retryCertifiedCoordinatedSave,
  hasCertifiedCoordinatedSave,
  subscribeCertifiedCoordinatedSave,
} from '../state/projectSetExport';
import { useSelectionStore } from '../state/selectionStore';
import {
  openProjectFromFile,
  openStudioDocumentFromFile,
  openStudioDocumentFromUrl,
  saveProjectSetToFile,
} from '../state/fileIO';
import type { StudioDocument } from '../state/studioDocument';
import { applyOpenedStudioDocument } from '../state/openStudioDocument';
import { renameProjectSet, saveProjectSetTemplateEdits } from '../state/projectSet';
import { TemplateSaveDialog } from '../components/TemplateSaveDialog';
import {
  getHistorySnapshot,
  redo,
  resetHistory,
  subscribeHistory,
  undo,
} from '../state/historyStore';
import { useAgentBridgeStatus } from '../state/agentBridge';
import { importEditableProjectFromOgraf } from '../state/importOgraf';
import { useImportReportStore } from '../state/importReportStore';
import {
  DOCK_PANE_IDS,
  DOCK_PANE_LABELS,
  revealDockPane,
  type DockPaneId,
} from '../layout/dockModel';
import { selectableLayerIds } from '../state/selectAllLayers';
import './Menubar.css';
import { useDetachedWindows } from '../layout/detachedWindowContext';
import { duplicateSelectedLayers } from '../state/editorShortcuts';
import { STUDIO_BUILD_DATE, STUDIO_VERSION } from '../state/buildInfo';
import {
  canGroupLayers,
  canUngroupLayers,
  copyLayers,
  cutLayers,
  deleteLayers,
  groupLayers,
  pasteLayers,
  ungroupLayers,
} from '../state/layerCommands';
import { useLayerClipboardStore } from '../state/layerClipboardStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import { requestStartupCreation } from '../state/startupCreation';
import { KeyboardShortcutsDialog } from '../components/KeyboardShortcutsDialog';
import { useTemplateSetSettingsStore } from '../state/templateSetSettingsStore';
import { TemplateSetSettingsDialogHost } from '../components/TemplateSetSettingsDialog';
import { useWorkspaceStore } from '../state/workspaceStore';
import { openWorkspaceDialog } from '../components/WorkspaceDialogs';
import { useEditorWindow } from '../layout/EditorWindow';
import { requestPreviewPresentation } from '../state/previewPresentationStore';
import { CoordinatedExportError } from '../state/certifiedArtifactSave';
import {
  readRecentDocument,
  readRecentDocuments,
  type RecentDocument,
} from '../state/recentDocuments';

const USER_GUIDE_URL = 'https://github.com/zerodensity/ograf-studio/blob/stable/docs/USER_GUIDE.md';
const MOD = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';

const historyTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function Menubar({
  style,
  closedDockPanes = [],
  onCenterDockPane,
}: {
  style?: CSSProperties;
  closedDockPanes?: DockPaneId[];
  onCenterDockPane?: (pane: DockPaneId) => void;
}) {
  const projectName = useProjectStore((s) => s.project.name);
  const detached = useDetachedWindows();
  const { window: ownerWindow } = useEditorWindow();
  const workspacePresets = useWorkspaceStore((state) => state.presets);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activePresetId);
  const workspaceModified = useWorkspaceStore((state) => state.modified);
  const workspaceStorageError = useWorkspaceStore((state) => state.storageError);
  const activeWorkspace = workspacePresets.find((preset) => preset.id === activeWorkspaceId);
  const loadProject = useProjectStore((s) => s.loadProject);
  const project = useProjectStore((s) => s.project);
  const activeCompositionId = useProjectStore((s) => s.activeCompositionId);
  const select = useSelectionStore((s) => s.select);
  const deselectAll = useSelectionStore((s) => s.deselectAll);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const [status, setStatus] = useState('');
  const certifiedSaveAvailable = useSyncExternalStore(
    subscribeCertifiedCoordinatedSave,
    hasCertifiedCoordinatedSave,
    () => false,
  );
  const [setExportBusy, setSetExportBusy] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cancelNameEditRef = useRef(false);
  const importReport = useImportReportStore((state) => state.report);
  const setImportReport = useImportReportStore((state) => state.setReport);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const remoteDialog = useRef<HTMLElement>(null);
  const reportDialog = useRef<HTMLElement>(null);
  const movableRemote = useMovableDialog(remoteDialog, { enabled: remoteDialogOpen });
  const movableReport = useMovableDialog(reportDialog, { enabled: !!importReport });
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentUnavailable, setRecentUnavailable] = useState(false);
  const [recentMenuPosition, setRecentMenuPosition] = useState({ top: 36, left: 0 });
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState({ top: 36, left: 0 });
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const setProjectSet = useProjectSetStore((state) => state.setProjectSet);
  const clearProjectSet = useProjectSetStore((state) => state.clearProjectSet);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const recentTriggerRef = useRef<HTMLButtonElement>(null);
  const recentFocusRequested = useRef(false);
  const editMenuRef = useRef<HTMLDivElement>(null);
  const windowMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const clipboardCount = useLayerClipboardStore((state) => state.layers.length);
  const revealPane = usePaneRequestStore((state) => state.reveal);
  const revealedSetId = useRef<string | null>(null);
  const closeMenus = () => {
    setFileMenuOpen(false);
    setRecentMenuOpen(false);
    setEditMenuOpen(false);
    setWindowMenuOpen(false);
    setWorkspacesOpen(false);
    setHelpMenuOpen(false);
  };
  const history = useSyncExternalStore(subscribeHistory, getHistorySnapshot, getHistorySnapshot);
  const agentConnected = useAgentBridgeStatus((state) => state.connected);
  const agentActivity = useAgentBridgeStatus((state) => state.activity);

  useEffect(() => {
    if (!fileMenuOpen) {
      setRecentMenuOpen(false);
      recentFocusRequested.current = false;
      return;
    }
    let cancelled = false;
    setRecentLoading(true);
    void readRecentDocuments().then(({ documents, unavailable }) => {
      if (cancelled) return;
      setRecentDocuments(documents);
      setRecentUnavailable(unavailable);
      setRecentLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fileMenuOpen]);
  useEffect(() => {
    if (!recentMenuOpen || recentLoading || !recentFocusRequested.current) return;
    recentFocusRequested.current = false;
    recentMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [recentMenuOpen, recentLoading, recentDocuments]);
  useLayoutEffect(() => {
    if (!recentMenuOpen || !recentMenuRef.current || !recentTriggerRef.current) return;
    const place = () => {
      const trigger = recentTriggerRef.current!.getBoundingClientRect();
      const menu = recentMenuRef.current!.getBoundingClientRect();
      setRecentMenuPosition({
        top: Math.max(8, Math.min(trigger.top, ownerWindow.innerHeight - menu.height - 8)),
        left: Math.max(8, Math.min(trigger.right + 3, ownerWindow.innerWidth - menu.width - 8)),
      });
    };
    place();
    ownerWindow.addEventListener('resize', place);
    return () => ownerWindow.removeEventListener('resize', place);
  }, [recentMenuOpen, recentDocuments, recentLoading, ownerWindow]);

  useEffect(() => {
    if (!windowMenuOpen) setWorkspacesOpen(false);
  }, [windowMenuOpen]);
  useLayoutEffect(() => {
    if (!workspacesOpen || !workspaceMenuRef.current || !workspaceTriggerRef.current) return;
    const place = () => {
      const trigger = workspaceTriggerRef.current!.getBoundingClientRect();
      const menu = workspaceMenuRef.current!.getBoundingClientRect();
      setWorkspaceMenuPosition({
        top: Math.max(36, Math.min(trigger.top, ownerWindow.innerHeight - menu.height - 8)),
        left: Math.max(8, Math.min(trigger.right + 3, ownerWindow.innerWidth - menu.width - 8)),
      });
    };
    place();
    ownerWindow.addEventListener('resize', place);
    return () => ownerWindow.removeEventListener('resize', place);
  }, [workspacesOpen, workspacePresets.length, ownerWindow]);
  const runWorkspaceAction = (action: () => void, message: string) => {
    try {
      action();
      setStatus(message);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Could not update the workspace.');
    }
    closeMenus();
  };

  const showPreview = async (trigger: HTMLButtonElement) => {
    const detachedPreview = detached.windows.export;
    const inDetachedWindow = detachedPreview && !detachedPreview.window.closed;
    try {
      flushSync(() => {
        closeMenus();
        setStatus('');
        if (!inDetachedWindow) {
          const workspace = useWorkspaceStore.getState();
          workspace.updateLayout(revealDockPane(workspace.current.layout, 'export'));
        }
      });
      await requestPreviewPresentation(trigger);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Unable to enter fullscreen preview.';
      setStatus(
        inDetachedWindow
          ? `${message} Use Preview in the detached window's header to enter fullscreen.`
          : message,
      );
    }
  };

  useEffect(() => {
    const id = projectSet?.id ?? null;
    if (id && id !== revealedSetId.current) revealPane('templates');
    revealedSetId.current = id;
  }, [projectSet?.id, revealPane]);

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  useEffect(() => setEditingName(false), [project.id]);

  const syncActiveTemplateEdits = () => {
    const session = useProjectSetStore.getState();
    if (session.projectSet && session.activeTemplateId)
      session.setProjectSet(
        saveProjectSetTemplateEdits(
          session.projectSet,
          session.activeTemplateId,
          useProjectStore.getState().project,
        ),
      );
  };

  const commitProjectName = () => {
    const name = nameDraft.trim();
    if (!cancelNameEditRef.current && name && name !== projectName) {
      useProjectStore.getState().setProjectMeta({ name });
      syncActiveTemplateEdits();
      setStatus(`Renamed template to “${name}”`);
    }
    cancelNameEditRef.current = false;
    setEditingName(false);
  };

  useEffect(() => {
    if (!fileMenuOpen && !editMenuOpen && !windowMenuOpen && !helpMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        fileMenuRef.current?.contains(target) ||
        editMenuRef.current?.contains(target) ||
        windowMenuRef.current?.contains(target) ||
        helpMenuRef.current?.contains(target)
      )
        return;
      setFileMenuOpen(false);
      setEditMenuOpen(false);
      setWindowMenuOpen(false);
      setHelpMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setFileMenuOpen(false);
      setEditMenuOpen(false);
      setWindowMenuOpen(false);
      setHelpMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [fileMenuOpen, editMenuOpen, windowMenuOpen, helpMenuOpen]);

  const applyUndo = (steps = 1) => {
    const label = history.past.at(-1)?.label;
    undo(steps);
    setEditMenuOpen(false);
    setStatus(steps === 1 && label ? `Undid: ${label}` : `Undid ${steps} changes`);
  };

  const applyRedo = (steps = 1) => {
    const label = history.future[0]?.label;
    redo(steps);
    setEditMenuOpen(false);
    setStatus(steps === 1 && label ? `Redid: ${label}` : `Redid ${steps} changes`);
  };

  const selectAllLayers = () => {
    const composition = project.compositions.find(
      (candidate) => candidate.id === activeCompositionId,
    );
    const layerIds = composition ? selectableLayerIds(composition) : [];
    window.getSelection()?.removeAllRanges();
    selectMany(layerIds);
    setEditMenuOpen(false);
    setStatus(`Selected ${layerIds.length} layer${layerIds.length === 1 ? '' : 's'}`);
  };

  const handleDuplicate = () => {
    const duplicatedIds = duplicateSelectedLayers();
    setEditMenuOpen(false);
    if (duplicatedIds.length > 0) {
      setStatus(`Duplicated ${duplicatedIds.length} layer${duplicatedIds.length === 1 ? '' : 's'}`);
    }
  };

  const plural = (count: number) => `${count} layer${count === 1 ? '' : 's'}`;
  const runLayerCommand = (command: () => string) => {
    setEditMenuOpen(false);
    setStatus(command());
  };

  const handleDeselect = () => {
    deselectAll();
    setEditMenuOpen(false);
    setStatus('Selection cleared');
  };

  const handleNew = () => {
    requestStartupCreation('new-template');
  };

  const handleOpen = async () => {
    try {
      const opened = await openStudioDocumentFromFile(ownerWindow);
      if (!opened) return;
      const currentDocument = useProjectSetStore.getState().projectSet
        ? 'template set'
        : 'template';
      if (
        !ownerWindow.confirm(
          `Open this document? Unsaved changes in the current ${currentDocument} will be lost.`,
        )
      )
        return;
      applyOpenedDocument(opened);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to open project');
    }
  };

  const applyOpenedDocument = (opened: StudioDocument) => {
    setStatus(applyOpenedStudioDocument(opened));
  };

  const handleOpenRecent = async (item: RecentDocument) => {
    closeMenus();
    setStatus(`Opening “${item.name}”…`);
    try {
      const opened = await readRecentDocument(item);
      if (
        !ownerWindow.confirm(
          'Open this recent document? Unsaved changes in the current document will be lost.',
        )
      ) {
        setStatus('Recent document open cancelled.');
        return;
      }
      applyOpenedDocument(opened);
    } catch (cause) {
      setStatus(
        cause instanceof Error
          ? cause.message
          : 'Could not open the recent document. Choose Open to select it again.',
      );
    }
  };

  const handleImportOgraf = async () => {
    if (
      !confirm(
        'Import an OGraf package as an editable project? Unsaved changes in the current project will be lost after a package is selected.',
      )
    )
      return;
    setStatus('Reading OGraf package…');
    try {
      const imported = await importEditableProjectFromOgraf();
      if (!imported) {
        setStatus('Import cancelled');
        return;
      }
      loadProject(imported.project);
      clearProjectSet();
      resetHistory();
      select(null);
      setImportReport(imported);
      setStatus(
        imported.mode === 'compiled-descriptor'
          ? `Imported "${imported.project.name}" with editable layers`
          : imported.mode === 'embedded-project'
            ? `Opened embedded editable source for "${imported.project.name}"`
            : `Imported manifest metadata for "${imported.project.name}"`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to import OGraf package');
    }
  };

  const handleOpenUrl = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!remoteUrl.trim() || remoteBusy) return;
    setRemoteBusy(true);
    setStatus('Downloading remote project…');
    try {
      const opened = await openStudioDocumentFromUrl(remoteUrl);
      const documentName =
        opened.kind === 'template-set' ? opened.projectSet.name : opened.project.name;
      if (
        !confirm(
          `Open remote document "${documentName}"? Unsaved changes in the current document will be lost.`,
        )
      ) {
        setStatus('Remote project open cancelled');
        return;
      }
      applyOpenedDocument(opened);
      setRemoteDialogOpen(false);
      setStatus(
        `Opened remote ${opened.kind === 'template-set' ? 'template set' : 'template'} "${documentName}"`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to open remote project');
    } finally {
      setRemoteBusy(false);
    }
  };

  const handleSave = () => setSaveDialogOpen(true);

  const handleAddTemplate = async () => {
    if (!projectSet) return;
    try {
      const opened = await openProjectFromFile();
      if (!opened) return;
      insertTemplateProject(opened, activeTemplateId);
      setStatus(`Added "${opened.name}" to the template set`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to add template');
    }
  };

  const handleSaveTemplateSet = async () => {
    if (!projectSet) return;
    try {
      const current = activeTemplateId
        ? saveProjectSetTemplateEdits(projectSet, activeTemplateId, project)
        : projectSet;
      const result = await saveProjectSetToFile(current, {
        archiveMode: 'compact',
        onProgress: (progress) =>
          setStatus(`${Math.floor(progress.percent)}% · ${progress.message}`),
      });
      if (result.status === 'cancelled') return;
      const latest = useProjectSetStore.getState().projectSet;
      if (latest?.id === current.id)
        setProjectSet(renameProjectSet(latest, result.projectSet.name));
      setStatus(
        result.status === 'saved'
          ? `Saved template set "${result.projectSet.name}"`
          : 'Template set downloaded',
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed to save template set');
    }
  };

  const handleExportTemplateSet = async () => {
    const current = useProjectSetStore.getState().projectSet;
    if (!current || setExportBusy) return;
    setSetExportBusy(true);
    setStatus(
      current.transitionLogic
        ? 'Preparing and verifying the coordinated playout package…'
        : 'Certifying and exporting every template…',
    );
    try {
      const result = await exportProjectSetAsZip(current, undefined, {
        ownerWindow,
        onProgress: (stage) => setStatus(`Coordinated export: ${stage}…`),
      });
      if (result.saveResult === 'prepared') {
        setStatus(`Certified package “${result.fileName}” is ready to save.`);
        return;
      }
      if (result.saveResult === 'cancelled') {
        setStatus('Template-set export cancelled.');
        return;
      }
      setStatus(
        result.mode === 'coordinated'
          ? `${result.saveResult === 'saved' ? 'Saved and verified' : 'Download requested for'} certified coordinated package "${result.fileName}" (${result.templates.length} overlays).${result.unreferencedTemplates?.length ? ` Unreferenced: ${result.unreferencedTemplates.map((template) => template.name).join(', ')}.` : ''}`
          : `${result.saveResult === 'saved' ? 'Exported' : 'Downloaded'} ${result.templates.length} certified templates in "${result.fileName}".`,
      );
    } catch (err) {
      setStatus(
        err instanceof CoordinatedExportError && err.outcome === 'user-cancelled'
          ? 'Export save cancelled. The certified package remains available from File.'
          : err instanceof Error
            ? err.message
            : 'Failed to export template set',
      );
    } finally {
      setSetExportBusy(false);
    }
  };

  return (
    <header className="menubar" style={style}>
      <TemplateSetSettingsDialogHost />
      {saveDialogOpen ? (
        <TemplateSaveDialog
          project={project}
          onClose={() => setSaveDialogOpen(false)}
          onSaved={(mode, savedProject, bundled) => {
            const current = useProjectStore.getState();
            if (current.project.id === savedProject.id) {
              current.setProjectMeta({
                name: savedProject.name,
                thumbnailFrame: savedProject.thumbnailFrame ?? null,
              });
              syncActiveTemplateEdits();
            }
            setSaveDialogOpen(false);
            setStatus(
              bundled
                ? mode === 'saved'
                  ? 'Template + PNG saved (certified)'
                  : 'Template + PNG ZIP downloaded'
                : mode === 'saved'
                  ? 'Editable .ogs file saved'
                  : 'Editable .ogs file downloaded',
            );
          }}
        />
      ) : null}
      <span className="menubar-brand" aria-label="OGraf Studio">
        <OgrafLogo />
        Studio
      </span>
      {editingName ? (
        <input
          ref={nameInputRef}
          className="menubar-project-name-input"
          aria-label="Template name"
          value={nameDraft}
          onChange={(event) => setNameDraft(event.currentTarget.value)}
          onBlur={commitProjectName}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              cancelNameEditRef.current = event.key === 'Escape';
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="menubar-project-name"
          disabled={!!projectSet && !activeTemplateId}
          aria-label={`Rename template: ${projectName}`}
          title="Rename template"
          onClick={() => {
            setNameDraft(projectName);
            setEditingName(true);
          }}
        >
          {projectName}
        </button>
      )}
      <nav className="menubar-actions">
        <div className="menubar-window-control" ref={fileMenuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
            onClick={() => {
              setFileMenuOpen((open) => !open);
              setEditMenuOpen(false);
              setWindowMenuOpen(false);
              setHelpMenuOpen(false);
            }}
          >
            File
          </button>
          {fileMenuOpen ? (
            <div
              className="menubar-window-menu menubar-file-menu"
              role="menu"
              aria-label="File"
              onPointerOver={(event) => {
                if (!(event.target as Element).closest?.('.menubar-recent-control'))
                  setRecentMenuOpen(false);
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  handleNew();
                }}
              >
                <span aria-hidden="true" />
                New…
              </button>
              <div className="menubar-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  void handleOpen();
                }}
              >
                <span aria-hidden="true" />
                Open…
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  setRemoteDialogOpen(true);
                }}
              >
                <span aria-hidden="true" />
                Open from URL…
              </button>
              <div
                className="menubar-recent-control"
                onPointerEnter={() => setRecentMenuOpen(true)}
              >
                <button
                  ref={recentTriggerRef}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={recentMenuOpen}
                  aria-controls="menubar-recent-menu"
                  onClick={() => {
                    recentFocusRequested.current = true;
                    setRecentMenuOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    event.stopPropagation();
                    recentFocusRequested.current = true;
                    setRecentMenuOpen(true);
                  }}
                >
                  <span aria-hidden="true" />
                  Open Recent<b aria-hidden="true">›</b>
                </button>
                {recentMenuOpen && (
                  <div
                    id="menubar-recent-menu"
                    ref={recentMenuRef}
                    className="menubar-recent-menu"
                    style={recentMenuPosition}
                    role="menu"
                    aria-label="Open Recent"
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft' || event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setRecentMenuOpen(false);
                        recentTriggerRef.current?.focus();
                      } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault();
                        event.stopPropagation();
                        const items = [
                          ...(recentMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                            'button:not(:disabled)',
                          ) ?? []),
                        ];
                        const current = items.indexOf(
                          ownerWindow.document.activeElement as HTMLButtonElement,
                        );
                        if (!items.length) return;
                        const index =
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? items.length - 1
                              : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) %
                                items.length;
                        items[index]?.focus();
                      }
                    }}
                  >
                    {recentLoading ? (
                      <p role="status">Loading recent documents…</p>
                    ) : recentDocuments.length ? (
                      recentDocuments.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitem"
                          title={`${item.name} · ${item.url ? 'URL' : 'Local file'} · ${new Date(item.openedAt).toLocaleString()}`}
                          onClick={() => void handleOpenRecent(item)}
                        >
                          <span aria-hidden="true">{index + 1}</span>
                          <span className="menubar-recent-name">{item.name}</span>
                          <small>{item.url ? 'URL' : ''}</small>
                        </button>
                      ))
                    ) : (
                      <p role="status">
                        {recentUnavailable
                          ? 'Recent document storage is unavailable in this browser.'
                          : 'No recent documents.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  void handleImportOgraf();
                }}
                title="Best-effort conversion from an OGraf .zip package or *.ograf.json manifest."
              >
                <span aria-hidden="true" />
                Import OGraf
              </button>
              {projectSet ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenus();
                    void handleAddTemplate();
                  }}
                >
                  <span aria-hidden="true" />
                  Add .ogs Template…
                </button>
              ) : null}
              <div className="menubar-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  handleSave();
                }}
                title="Choose a filename and location for editable .ogs source."
                disabled={!!projectSet && !activeTemplateId}
              >
                <span aria-hidden="true" />
                Save Template
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!projectSet}
                onClick={() => {
                  closeMenus();
                  void handleSaveTemplateSet();
                }}
                title={
                  projectSet
                    ? 'Save all templates and shared set data as an .ogs document.'
                    : 'Create or open a template set to save it.'
                }
              >
                <span aria-hidden="true" />
                Save Template Set…
              </button>
              <div className="menubar-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  revealPane('export', 'preview.export');
                }}
                title="Open the export options for the current template or template set."
                disabled={!!projectSet && !activeTemplateId}
              >
                <span aria-hidden="true" />
                Export…
              </button>
              {projectSet ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenus();
                    void handleExportTemplateSet();
                  }}
                  disabled={!projectSet.templates.length || setExportBusy}
                  title={
                    projectSet.transitionLogic
                      ? 'Export one certified .ograf.zip graphic with coordinated slots, transitions and shared scene.'
                      : 'Export one certified .ograf.zip package for each template inside a .ograf-set.zip archive.'
                  }
                >
                  <span aria-hidden="true" />
                  {setExportBusy
                    ? 'Exporting Template Set…'
                    : projectSet.transitionLogic
                      ? 'Export Coordinated Package…'
                      : 'Export All Templates…'}
                </button>
              ) : null}
              {certifiedSaveAvailable ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={setExportBusy}
                  onClick={() => {
                    closeMenus();
                    setSetExportBusy(true);
                    void retryCertifiedCoordinatedSave({ ownerWindow })
                      .then((result) => {
                        setStatus(
                          result.saveResult === 'saved'
                            ? `Saved and verified certified package "${result.fileName}".`
                            : `Download requested for certified package "${result.fileName}"; check browser downloads.`,
                        );
                      })
                      .catch((error: unknown) =>
                        setStatus(error instanceof Error ? error.message : String(error)),
                      )
                      .finally(() => setSetExportBusy(false));
                  }}
                >
                  Save Certified Package Again…
                </button>
              ) : null}
              <div className="menubar-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenus();
                  useTemplateSetSettingsStore.getState().show('studio');
                }}
              >
                <span aria-hidden="true" />
                Preferences
              </button>
            </div>
          ) : null}
        </div>
        <div className="menubar-edit-control" ref={editMenuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={editMenuOpen}
            onClick={() => {
              setEditMenuOpen((open) => !open);
              setFileMenuOpen(false);
              setWindowMenuOpen(false);
              setHelpMenuOpen(false);
            }}
          >
            Edit
          </button>
          {editMenuOpen ? (
            <div className="menubar-edit-menu" role="menu" aria-label="Edit and history">
              <button
                type="button"
                role="menuitem"
                disabled={!history.canUndo}
                onClick={() => applyUndo()}
                title={history.canUndo ? `Undo ${history.past.at(-1)?.label}` : undefined}
              >
                <span>{history.canUndo ? `Undo ${history.past.at(-1)?.label}` : 'Undo'}</span>
                <kbd>Ctrl+Z</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!history.canRedo}
                onClick={() => applyRedo()}
                title={history.canRedo ? `Redo ${history.future[0]?.label}` : undefined}
              >
                <span>{history.canRedo ? `Redo ${history.future[0]?.label}` : 'Redo'}</span>
                <kbd>Ctrl+Y</kbd>
              </button>
              <div className="menubar-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={() => runLayerCommand(() => `Cut ${plural(cutLayers())}`)}
              >
                <span>Cut</span>
                <kbd>{MOD}+X</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={() => runLayerCommand(() => `Copied ${plural(copyLayers())}`)}
              >
                <span>Copy</span>
                <kbd>{MOD}+C</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={clipboardCount === 0}
                onClick={() => runLayerCommand(() => `Pasted ${plural(pasteLayers().length)}`)}
              >
                <span>Paste</span>
                <kbd>{MOD}+V</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={handleDuplicate}
              >
                <span>Duplicate</span>
                <kbd>{MOD}+Shift+D</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={() => runLayerCommand(() => `Deleted ${plural(deleteLayers())}`)}
              >
                <span>Delete</span>
                <kbd>Del</kbd>
              </button>
              <div className="menubar-menu-separator" role="separator" />
              {canUngroupLayers() ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    runLayerCommand(() => (ungroupLayers() ? 'Ungrouped' : 'Nothing to ungroup'))
                  }
                >
                  <span>Ungroup</span>
                  <kbd>{MOD}+Shift+G</kbd>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={!canGroupLayers()}
                  onClick={() =>
                    runLayerCommand(() =>
                      groupLayers() ? `Grouped ${plural(selectedLayerIds.length)}` : 'Not grouped',
                    )
                  }
                >
                  <span>Group</span>
                  <kbd>{MOD}+G</kbd>
                </button>
              )}
              <div className="menubar-menu-separator" role="separator" />
              <button type="button" role="menuitem" onClick={selectAllLayers}>
                <span>Select all layers</span>
                <kbd>Ctrl+A</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={selectedLayerIds.length === 0}
                onClick={handleDeselect}
              >
                <span>Deselect all</span>
                <kbd>Ctrl+D</kbd>
              </button>
              <div className="menubar-history-heading" role="presentation">
                History
                <span>{history.past.length + history.future.length} actions</span>
              </div>
              <div className="menubar-history-list" role="group" aria-label="Recent history">
                {[...history.past].reverse().map((item, index) => (
                  <button
                    key={`undo-${item.id}`}
                    type="button"
                    className="menubar-history-item"
                    role="menuitem"
                    title={`Undo ${index + 1} ${index === 0 ? 'action' : 'actions'} — ${item.label}`}
                    onClick={() => applyUndo(index + 1)}
                  >
                    <span aria-hidden="true">↶</span>
                    <span className="menubar-history-label">{item.label}</span>
                    <time>{historyTime(item.timestamp)}</time>
                  </button>
                ))}
                <div className="menubar-history-current" aria-current="step">
                  <span aria-hidden="true">●</span>
                  <span className="menubar-history-label">Current state</span>
                </div>
                {history.future.map((item, index) => (
                  <button
                    key={`redo-${item.id}`}
                    type="button"
                    className="menubar-history-item is-future"
                    role="menuitem"
                    title={`Redo ${index + 1} ${index === 0 ? 'action' : 'actions'} — ${item.label}`}
                    onClick={() => applyRedo(index + 1)}
                  >
                    <span aria-hidden="true">↷</span>
                    <span className="menubar-history-label">{item.label}</span>
                    <time>{historyTime(item.timestamp)}</time>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="menubar-window-control" ref={windowMenuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={windowMenuOpen}
            onClick={() => {
              setWindowMenuOpen((open) => !open);
              setFileMenuOpen(false);
              setEditMenuOpen(false);
              setHelpMenuOpen(false);
            }}
          >
            Window
          </button>
          {windowMenuOpen ? (
            <div className="menubar-window-menu" role="menu" aria-label="Window panes">
              {DOCK_PANE_IDS.map((pane) => {
                const open = !closedDockPanes.includes(pane);
                return (
                  <button
                    key={pane}
                    type="button"
                    role="menuitem"
                    title={`Float ${DOCK_PANE_LABELS[pane]} at the center of Studio`}
                    onClick={() => {
                      onCenterDockPane?.(pane);
                      setWindowMenuOpen(false);
                    }}
                    onPointerEnter={() => setWorkspacesOpen(false)}
                  >
                    <span aria-hidden="true">{open ? '✓' : ''}</span>
                    {DOCK_PANE_LABELS[pane]}
                    {detached.windows[pane] ? ' ↗' : ''}
                  </button>
                );
              })}
              <div className="menubar-menu-separator" role="separator" />
              <div
                className="menubar-workspace-control"
                onPointerEnter={() => setWorkspacesOpen(true)}
              >
                <button
                  ref={workspaceTriggerRef}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={workspacesOpen}
                  onClick={() => {
                    setWorkspacesOpen(true);
                    ownerWindow.requestAnimationFrame(() =>
                      workspaceMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(),
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    event.stopPropagation();
                    setWorkspacesOpen(true);
                    ownerWindow.requestAnimationFrame(() =>
                      workspaceMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(),
                    );
                  }}
                >
                  <span aria-hidden="true" />
                  Workspaces
                  <b aria-hidden="true">›</b>
                </button>
                {workspacesOpen ? (
                  <div
                    ref={workspaceMenuRef}
                    className="menubar-workspace-menu"
                    style={workspaceMenuPosition}
                    role="menu"
                    aria-label="Workspaces"
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft' || event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setWorkspacesOpen(false);
                        workspaceTriggerRef.current?.focus();
                      }
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        event.stopPropagation();
                        const items = [
                          ...(workspaceMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                            'button:not(:disabled)',
                          ) ?? []),
                        ];
                        const index = items.indexOf(
                          ownerWindow.document.activeElement as HTMLButtonElement,
                        );
                        items[
                          (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) %
                            items.length
                        ]?.focus();
                      }
                    }}
                  >
                    <div className="menubar-workspace-status">
                      {activeWorkspace?.name ?? 'Custom workspace'}
                      {workspaceModified ? ' · modified' : ''}
                    </div>
                    <div role="group" aria-label="Workspace presets">
                      {workspacePresets.map((preset) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={preset.id === activeWorkspaceId}
                          key={preset.id}
                          onClick={() =>
                            runWorkspaceAction(() => {
                              useWorkspaceStore.getState().applyPreset(preset.id);
                              detached.restore();
                            }, `Applied workspace “${preset.name}”`)
                          }
                        >
                          <span aria-hidden="true">
                            {preset.id === activeWorkspaceId ? '✓' : ''}
                          </span>
                          <span className="menubar-workspace-name">{preset.name}</span>
                        </button>
                      ))}
                    </div>
                    <div className="menubar-menu-separator" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        closeMenus();
                        openWorkspaceDialog('save', ownerWindow);
                      }}
                    >
                      <span aria-hidden="true" />
                      Save Workspace As…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!activeWorkspace || activeWorkspace.builtin}
                      onClick={() =>
                        runWorkspaceAction(() => {
                          detached.capture();
                          useWorkspaceStore.getState().updateCurrentPreset();
                        }, 'Workspace updated')
                      }
                    >
                      <span aria-hidden="true" />
                      Update Current Workspace
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() =>
                        runWorkspaceAction(() => {
                          useWorkspaceStore.getState().resetCurrent();
                          detached.restore();
                        }, 'Workspace reset to its saved arrangement')
                      }
                    >
                      <span aria-hidden="true" />
                      Reset Current Workspace
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        closeMenus();
                        openWorkspaceDialog('manage', ownerWindow);
                      }}
                    >
                      <span aria-hidden="true" />
                      Manage Workspaces…
                    </button>
                    {workspaceStorageError ? (
                      <div role="status" className="menubar-workspace-error">
                        {workspaceStorageError}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {detached.pending.length ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    runWorkspaceAction(() => detached.restore(), 'Restoring detached windows')
                  }
                >
                  <span aria-hidden="true">↗</span>Restore Detached Windows
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="menubar-window-control" ref={helpMenuRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={helpMenuOpen}
            onClick={() => {
              setHelpMenuOpen((open) => !open);
              setFileMenuOpen(false);
              setEditMenuOpen(false);
              setWindowMenuOpen(false);
            }}
          >
            Help
          </button>
          {helpMenuOpen ? (
            <div className="menubar-window-menu" role="menu" aria-label="Help">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShortcutsOpen(true);
                  closeMenus();
                }}
              >
                <span aria-hidden="true" />
                Keyboard shortcuts
              </button>
              <a
                href={USER_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                className="menubar-menu-link"
                onClick={closeMenus}
              >
                <span aria-hidden="true" />
                User guide ↗
              </a>
              <div className="menubar-build-info" role="presentation">
                <a
                  href="https://github.com/zerodensity/ograf-studio"
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                >
                  OGraf Studio v{STUDIO_VERSION}
                </a>
                <time dateTime={STUDIO_BUILD_DATE}>Build {STUDIO_BUILD_DATE}</time>
              </div>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="menubar-preview-button"
          title="Open fullscreen preview (or fill this window if fullscreen is unavailable). Press Escape to exit."
          onClick={(event) => void showPreview(event.currentTarget)}
        >
          Preview
        </button>
      </nav>
      <label className="menubar-layout-control">
        <span>Layout</span>
        <select
          aria-label="Workspace layout"
          value={activeWorkspaceId}
          title={
            workspaceModified
              ? 'Current layout has unsaved arrangement changes'
              : 'Switch panel layout'
          }
          onFocus={closeMenus}
          onChange={(event) => {
            const preset = workspacePresets.find((item) => item.id === event.target.value);
            if (!preset) return;
            runWorkspaceAction(() => {
              useWorkspaceStore.getState().applyPreset(preset.id);
              detached.restore();
            }, `Applied workspace “${preset.name}”`);
          }}
        >
          {[
            { label: 'Built-in layouts', builtin: true },
            { label: 'Saved layouts', builtin: false },
          ].map(({ label, builtin }) => {
            const presets = workspacePresets.filter((preset) => !!preset.builtin === builtin);
            return presets.length ? (
              <optgroup key={label} label={label}>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                    {preset.id === activeWorkspaceId && workspaceModified ? ' (modified)' : ''}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </label>
      <span
        className={`menubar-agent-status${agentConnected ? ' is-connected' : ''}`}
        title={agentActivity}
      >
        <span className="menubar-agent-dot" />
        {agentActivity}
      </span>
      {status && <span className="menubar-status">{status}</span>}
      {shortcutsOpen ? <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
      {remoteDialogOpen && (
        <section
          className="ograf-import-report remote-project-dialog"
          ref={remoteDialog}
          {...movableRemote.dialogProps}
          role="dialog"
          aria-modal="true"
          aria-labelledby="remote-project-dialog-title"
        >
          <form onSubmit={(event) => void handleOpenUrl(event)}>
            <div className="ograf-import-report-header" {...movableRemote.handleProps}>
              <div>
                <strong id="remote-project-dialog-title">Open from URL</strong>
                <span>Download an editable .ogs document or legacy .ogp over HTTP(S)</span>
              </div>
              <button
                type="button"
                disabled={remoteBusy}
                onClick={() => setRemoteDialogOpen(false)}
                aria-label="Close remote document dialog"
              >
                ×
              </button>
            </div>
            <p>
              The server must allow browser CORS access. The project is downloaded and validated
              before you confirm replacing the current project; credentials are never sent.
            </p>
            <label className="remote-project-url-field">
              <span>Document URL</span>
              <input
                autoFocus
                type="url"
                inputMode="url"
                required
                placeholder="https://raw.githubusercontent.com/owner/repo/main/news.ogs"
                value={remoteUrl}
                disabled={remoteBusy}
                onChange={(event) => setRemoteUrl(event.target.value)}
              />
            </label>
            <div className="ograf-import-report-actions">
              <button
                type="button"
                disabled={remoteBusy}
                onClick={() => setRemoteDialogOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" disabled={remoteBusy || !remoteUrl.trim()}>
                {remoteBusy ? 'Downloading…' : 'Open and replace'}
              </button>
            </div>
          </form>
        </section>
      )}
      {importReport && (
        <section
          className="ograf-import-report"
          ref={reportDialog}
          {...movableReport.dialogProps}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ograf-import-report-title"
        >
          <div className="ograf-import-report-header" {...movableReport.handleProps}>
            <div>
              <strong id="ograf-import-report-title">OGraf import report</strong>
              <span>{importReport.project.name}</span>
            </div>
            <button
              type="button"
              onClick={() => setImportReport(null)}
              aria-label="Close import report"
            >
              ×
            </button>
          </div>
          <p>
            {importReport.mode === 'embedded-project'
              ? 'Exact embedded editor source was recovered.'
              : importReport.mode === 'compiled-descriptor'
                ? 'Compiled layers and timelines were reconstructed as editable content.'
                : 'Only manifest-level information could be reconstructed from the opaque runtime.'}
          </p>
          <dl>
            <div>
              <dt>Manifest</dt>
              <dd>{importReport.manifestFileName}</dd>
            </div>
            <div>
              <dt>Layers</dt>
              <dd>{importReport.project.compositions[0]?.layers.length ?? 0}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{importReport.warnings.length}</dd>
            </div>
          </dl>
          {importReport.warnings.length > 0 && (
            <ul>
              {importReport.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="ograf-import-report-actions">
            <button type="button" onClick={() => setImportReport(null)}>
              Continue editing
            </button>
          </div>
        </section>
      )}
    </header>
  );
}
