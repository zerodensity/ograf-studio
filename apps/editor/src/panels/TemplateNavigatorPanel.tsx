import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type KeyboardEvent,
} from 'react';
import {
  moveProjectSetTemplate,
  reorderProjectSetTemplate,
  renameProjectSetTemplate,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
} from '../state/projectSet';
import { addSecondTemplateToNewSet } from '../state/templateSetConversion';
import { revealPaneOnFirstUse } from '../state/firstUsePanes';
import { activateProjectSetTemplate } from '../state/projectSetSession';
import { useProjectSetStore } from '../state/projectSetStore';
import { useProjectStore } from '../state/projectStore';
import { openProjectFromFile } from '../state/fileIO';
import { createTemplateThumbnail } from '../state/templateThumbnail';
import { schedulePreviewBackgroundWork } from '../state/previewBackgroundWork';
import { ContextMenu } from '../components/ContextMenu';
import {
  copyTemplate,
  duplicateTemplate,
  pasteTemplate,
  removeTemplate,
  insertTemplateProject,
  undoRemoveTemplate,
  useTemplateClipboardStore,
} from '../state/templateCommands';
import { requestStartupCreation } from '../state/startupCreation';
import './TemplateNavigatorPanel.css';
import { useTemplateSetSettingsStore } from '../state/templateSetSettingsStore';

type TemplateDropTarget = { templateId: string; side: 'before' | 'after' };

function TemplateCard({
  name,
  project,
  index,
  active,
  onActivate,
  onMove,
  onRename,
  onRemove,
  canRemove,
  onContextMenu,
  onCommandKey,
  renameRevision = 0,
  canMoveUp,
  canMoveDown,
  dragging,
  dropSide,
  templateId,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  name: string;
  project: ReturnType<typeof resolveProjectSetTemplate>;
  index: number;
  active: boolean;
  onActivate: (event: MouseEvent<HTMLButtonElement>) => void;
  onMove: (offset: -1 | 1) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onCommandKey: (event: KeyboardEvent<HTMLElement>) => void;
  renameRevision?: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragging: boolean;
  dropSide?: TemplateDropTarget['side'];
  templateId: string;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const thumbnailUrlRef = useRef<string | null>(null);
  const thumbnailGeneration = useRef(0);
  const thumbnailBusy = useRef(false);
  const thumbnailPending = useRef<{ project: typeof project; generation: number } | null>(null);
  const thumbnailMounted = useRef(true);
  const thumbnailRequested = useRef(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [thumbnailError, setThumbnailError] = useState('');
  const [visible, setVisible] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [renameError, setRenameError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const cancelledRenameRef = useRef(false);
  const handledRenameRevision = useRef(0);

  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [editingName]);

  const startRename = useCallback(() => {
    cancelledRenameRef.current = false;
    setNameDraft(name);
    setRenameError('');
    setEditingName(true);
  }, [name]);
  useEffect(() => {
    if (renameRevision && renameRevision !== handledRenameRevision.current) {
      handledRenameRevision.current = renameRevision;
      startRename();
    }
  }, [renameRevision, startRename]);

  const commitRename = () => {
    if (cancelledRenameRef.current) return;
    try {
      onRename(nameDraft);
      setEditingName(false);
      setRenameError('');
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Could not rename template');
    }
  };

  useEffect(() => {
    const element = cardRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const generation = ++thumbnailGeneration.current;
    const delay = thumbnailRequested.current ? 300 : 0;
    thumbnailRequested.current = true;
    thumbnailPending.current = null;
    const renderPending = async () => {
      if (thumbnailBusy.current || !thumbnailMounted.current) return;
      const request = thumbnailPending.current;
      if (!request) return;
      thumbnailPending.current = null;
      thumbnailBusy.current = true;
      try {
        const blob = await createTemplateThumbnail(request.project);
        if (!thumbnailMounted.current || request.generation !== thumbnailGeneration.current) return;
        const url = URL.createObjectURL(blob);
        const previous = thumbnailUrlRef.current;
        thumbnailUrlRef.current = url;
        setThumbnailUrl(url);
        setThumbnailError('');
        if (previous) URL.revokeObjectURL(previous);
      } catch (cause) {
        if (thumbnailMounted.current && request.generation === thumbnailGeneration.current)
          setThumbnailError(cause instanceof Error ? cause.message : 'Could not update thumbnail.');
      } finally {
        thumbnailBusy.current = false;
        if (thumbnailPending.current) void renderPending();
      }
    };
    const cancel = schedulePreviewBackgroundWork(() => {
      thumbnailPending.current = { project, generation };
      void renderPending();
    }, delay);
    return () => {
      cancel();
      thumbnailPending.current = null;
      thumbnailGeneration.current += 1;
    };
  }, [project, visible, refreshRevision]);

  useEffect(() => {
    thumbnailMounted.current = true;
    return () => {
      thumbnailMounted.current = false;
      thumbnailGeneration.current += 1;
      thumbnailPending.current = null;
      if (thumbnailUrlRef.current) URL.revokeObjectURL(thumbnailUrlRef.current);
    };
  }, []);

  return (
    <article
      ref={cardRef}
      className={`template-card${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}${dropSide ? ` drop-${dropSide}` : ''}`}
      aria-current={active ? 'page' : undefined}
      role="listitem"
      data-template-card-id={templateId}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('input')) return;
        onContextMenu(event);
      }}
      onKeyDown={onCommandKey}
    >
      <div className="template-card-main">
        <button
          type="button"
          className="template-card-select"
          onClick={onActivate}
          onDoubleClick={startRename}
          aria-label={`Open template ${index + 1}: ${name}`}
          aria-pressed={active}
          draggable={false}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          title="Drag to reorder · Double-click to rename"
        >
          <span className="template-card-preview">
            {thumbnailUrl ? (
              <img src={thumbnailUrl} alt="" draggable={false} />
            ) : (
              <span className="template-card-preview-empty">OGraf</span>
            )}
            <span className="template-card-number">{index + 1}</span>
          </span>
          {!editingName ? (
            <span className="template-card-caption" title={name}>
              {name}
            </span>
          ) : null}
        </button>
        {editingName ? (
          <div className="template-card-name-editor">
            <input
              ref={nameInputRef}
              aria-label={`Rename template ${name}`}
              aria-invalid={!!renameError}
              value={nameDraft}
              onChange={(event) => {
                setNameDraft(event.currentTarget.value);
                setRenameError('');
              }}
              onBlur={commitRename}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelledRenameRef.current = true;
                  setEditingName(false);
                  setRenameError('');
                }
              }}
            />
            {renameError ? (
              <small className="template-card-name-error" role="alert">
                {renameError}
              </small>
            ) : null}
          </div>
        ) : null}
      </div>
      <span className="template-card-order" aria-label={`Reorder ${name}`}>
        <button
          type="button"
          onClick={() => setRefreshRevision((revision) => revision + 1)}
          aria-label={`Refresh thumbnail for ${name}`}
          title={
            thumbnailError
              ? `Preview could not update: ${thumbnailError}. Click to retry.`
              : 'Refresh thumbnail'
          }
        >
          {thumbnailError ? '!' : '↻'}
        </button>
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={!canMoveUp}
          aria-label={`Move ${name} earlier`}
          title="Move earlier"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={!canMoveDown}
          aria-label={`Move ${name} later`}
          title="Move later"
        >
          ↓
        </button>
        <button
          type="button"
          className="template-card-remove"
          aria-label={`Remove template ${name}`}
          title="Remove template from set"
          disabled={!canRemove}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6" />
          </svg>
        </button>
      </span>
    </article>
  );
}

export function TemplateNavigatorPanel() {
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const setProjectSet = useProjectSetStore((state) => state.setProjectSet);
  const project = useProjectStore((state) => state.project);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; templateId: string | null } | null>(
    null,
  );
  const [renameRequest, setRenameRequest] = useState<{
    templateId: string;
    revision: number;
  } | null>(null);
  const clipboard = useTemplateClipboardStore((state) => state.copied);
  const removed = useTemplateClipboardStore((state) => state.removed);
  const gestureRef = useRef<{
    templateId: string;
    pointerId: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  const suppressDragClickRef = useRef(false);
  const [draggingTemplateId, setDraggingTemplateId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TemplateDropTarget | null>(null);
  const templatesListRef = useRef<HTMLDivElement>(null);
  const resolvedProjects = useMemo(
    () =>
      projectSet?.templates.map((template) => resolveProjectSetTemplate(projectSet, template.id)) ??
      [],
    [projectSet],
  );

  const clearDrag = () => {
    gestureRef.current = null;
    setDraggingTemplateId(null);
    setDropTarget(null);
  };

  useEffect(clearDrag, [projectSet?.id]);

  const startDrag = (event: PointerEvent<HTMLButtonElement>, templateId: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.stopPropagation();
    suppressDragClickRef.current = false;
    gestureRef.current = {
      templateId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const targetAtPointer = (event: PointerEvent<HTMLButtonElement>): TemplateDropTarget | null => {
    const card = event.currentTarget.ownerDocument
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-template-card-id]');
    const templateId = card?.dataset.templateCardId;
    if (!card || !templateId || !templatesListRef.current?.contains(card)) return null;
    const bounds = card.getBoundingClientRect();
    return {
      templateId,
      side: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
    };
  };

  const previewDrop = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.dragging) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
      gesture.dragging = true;
      setDraggingTemplateId(gesture.templateId);
    }
    event.preventDefault();
    event.stopPropagation();
    const hovered = targetAtPointer(event);
    const nextTarget = hovered?.templateId === gesture.templateId ? null : hovered;
    setDropTarget((current) =>
      current?.templateId === nextTarget?.templateId && current?.side === nextTarget?.side
        ? current
        : nextTarget,
    );
    const list = templatesListRef.current;
    if (list) {
      const bounds = list.getBoundingClientRect();
      if (event.clientY < bounds.top + 35) list.scrollTop -= 12;
      else if (event.clientY > bounds.bottom - 35) list.scrollTop += 12;
    }
  };

  const dropTemplate = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!gesture.dragging) {
      clearDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suppressDragClickRef.current = true;
    const target = targetAtPointer(event);
    try {
      if (!target || target.templateId === gesture.templateId) return;
      // Read fresh state so edits or selection changes during a drag stay intact.
      const session = useProjectSetStore.getState();
      if (!session.projectSet || !session.activeTemplateId) return;
      const current = saveProjectSetTemplateEdits(
        session.projectSet,
        session.activeTemplateId,
        useProjectStore.getState().project,
      );
      const reordered = reorderProjectSetTemplate(
        current,
        gesture.templateId,
        target.templateId,
        target.side,
      );
      session.setProjectSet(reordered);
      const index = reordered.templates.findIndex((template) => template.id === gesture.templateId);
      setStatus(`Moved template to position ${index + 1}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not reorder templates');
    } finally {
      clearDrag();
    }
  };

  const addTemplate = async (
    targetId: string | null = null,
    side: 'before' | 'after' = 'after',
  ) => {
    if (!projectSet || busy) return;
    setBusy(true);
    setStatus('Choose an .ogs template…');
    try {
      const opened = await openProjectFromFile();
      if (!opened) {
        setStatus('');
        return;
      }
      const name = insertTemplateProject(opened, targetId, side);
      setStatus(`Inserted “${name}”`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not add template');
    } finally {
      setBusy(false);
    }
  };

  const addSecondTemplate = async () => {
    if (busy) return;
    const originalId = useProjectStore.getState().project.id;
    setBusy(true);
    setStatus('Choose an .ogs template…');
    try {
      const opened = await openProjectFromFile();
      if (!opened) {
        setStatus('');
        return;
      }
      const name = addSecondTemplateToNewSet(opened, originalId);
      window.setTimeout(() => revealPaneOnFirstUse('transitions'), 100);
      setStatus(`Created a template set and added “${name}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not add template');
    } finally {
      setBusy(false);
    }
  };

  const moveTemplate = (templateId: string, offset: -1 | 1) => {
    if (!projectSet || !activeTemplateId) return;
    try {
      const current = saveProjectSetTemplateEdits(projectSet, activeTemplateId, project);
      setProjectSet(moveProjectSetTemplate(current, templateId, offset));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not reorder templates');
    }
  };

  const renameTemplate = (templateId: string, name: string) => {
    const session = useProjectSetStore.getState();
    if (!session.projectSet || !session.activeTemplateId)
      throw new Error('The template set is no longer open.');
    const current = saveProjectSetTemplateEdits(
      session.projectSet,
      session.activeTemplateId,
      useProjectStore.getState().project,
    );
    const renamed = renameProjectSetTemplate(current, templateId, name);
    const nextName = renamed.templates.find((template) => template.id === templateId)!.name;
    if (templateId === session.activeTemplateId)
      useProjectStore.getState().setProjectMeta({ name: nextName });
    session.setProjectSet(renamed);
    setStatus(`Renamed template to “${nextName}”`);
  };

  const openTemplate = (templateId: string) => {
    try {
      if (activateProjectSetTemplate(templateId)) setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not open template');
    }
  };

  const runCommand = (command: () => string, verb: string) => {
    try {
      setStatus(`${verb} “${command()}”`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : 'Could not update template set.');
    }
  };
  const remove = (templateId: string) => runCommand(() => removeTemplate(templateId), 'Removed');
  const requestRename = (templateId: string) =>
    setRenameRequest((previous) => ({ templateId, revision: (previous?.revision ?? 0) + 1 }));
  const openMenu = (event: MouseEvent<HTMLElement>, templateId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (templateId) openTemplate(templateId);
    setMenu({ x: event.clientX, y: event.clientY, templateId });
  };
  const commandKey = (event: KeyboardEvent<HTMLElement>, templateId: string) => {
    if ((event.target as HTMLElement).closest('input') || busy) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let action: (() => void) | null = null;
    if (modifier && key === 'c')
      action = () => runCommand(() => copyTemplate(templateId), 'Copied');
    else if (modifier && key === 'v')
      action = () => runCommand(() => pasteTemplate(templateId), 'Pasted');
    else if (modifier && key === 'd')
      action = () => runCommand(() => duplicateTemplate(templateId), 'Duplicated');
    else if (modifier && key === 'x')
      action = () =>
        runCommand(() => {
          copyTemplate(templateId);
          return removeTemplate(templateId);
        }, 'Cut');
    else if (event.key === 'Delete' || event.key === 'Backspace') action = () => remove(templateId);
    else if (event.key === 'F2') action = () => requestRename(templateId);
    else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
      action = () => {
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu({ x: rect.left + 20, y: rect.top + 20, templateId });
      };
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      action();
    }
  };

  if (!projectSet) {
    return (
      <section className="template-navigator-panel template-navigator-empty">
        <p>Add another template to create a Template Set and coordinate transitions.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => requestStartupCreation('second-template')}
        >
          New template…
        </button>
        <button type="button" disabled={busy} onClick={() => void addSecondTemplate()}>
          Add existing template…
        </button>
        {status && <p role="status">{status}</p>}
      </section>
    );
  }

  return (
    <section className="template-navigator-panel" aria-label={`Templates in ${projectSet.name}`}>
      <header className="template-navigator-header">
        <div>
          <strong title={projectSet.name}>{projectSet.name}</strong>
          <span>
            {projectSet.templates.length}{' '}
            {projectSet.templates.length === 1 ? 'template' : 'templates'}
          </span>
        </div>
        <div className="template-navigator-actions" role="group" aria-label="Template set actions">
          <button
            type="button"
            onClick={() => void addTemplate(activeTemplateId)}
            disabled={busy}
            aria-label="Add an .ogs template"
            title="Add an .ogs template"
          >
            ＋
          </button>
          <button
            type="button"
            aria-label="Template set settings"
            title="Template set settings"
            onClick={() => useTemplateSetSettingsStore.getState().show('template-set')}
          >
            ⚙
          </button>
        </div>
      </header>
      <div
        ref={templatesListRef}
        className="template-navigator-list"
        role="list"
        aria-label="Templates"
        onContextMenu={(event) => openMenu(event, null)}
      >
        {!projectSet.templates.length ? (
          <div className="template-navigator-empty-set">
            <p>No templates in this set.</p>
            <button type="button" onClick={() => requestStartupCreation('set-template')}>
              New Template
            </button>
            <button type="button" onClick={() => void addTemplate()}>
              Insert Template…
            </button>
            <button
              type="button"
              disabled={!clipboard}
              onClick={() => runCommand(() => pasteTemplate(), 'Pasted')}
            >
              Paste Template
            </button>
          </div>
        ) : null}
        {projectSet.templates.map((template, index) => (
          <TemplateCard
            key={template.id}
            name={template.name}
            project={template.id === activeTemplateId ? project : resolvedProjects[index]!}
            index={index}
            active={template.id === activeTemplateId}
            onActivate={(event) => {
              if (suppressDragClickRef.current && event.detail > 0) {
                suppressDragClickRef.current = false;
                return;
              }
              openTemplate(template.id);
            }}
            onMove={(offset) => moveTemplate(template.id, offset)}
            onRename={(name) => renameTemplate(template.id, name)}
            onRemove={() => remove(template.id)}
            canRemove={!busy}
            onContextMenu={(event) => openMenu(event, template.id)}
            onCommandKey={(event) => commandKey(event, template.id)}
            renameRevision={renameRequest?.templateId === template.id ? renameRequest.revision : 0}
            canMoveUp={index > 0}
            canMoveDown={index < projectSet.templates.length - 1}
            dragging={template.id === draggingTemplateId}
            dropSide={dropTarget?.templateId === template.id ? dropTarget.side : undefined}
            templateId={template.id}
            onPointerDown={(event) => startDrag(event, template.id)}
            onPointerMove={previewDrop}
            onPointerUp={dropTemplate}
            onPointerCancel={clearDrag}
          />
        ))}
      </div>
      <footer className="template-navigator-footer" aria-live="polite">
        <span>
          {status ||
            (projectSet.templates.length
              ? 'Select to edit · Drag to reorder.'
              : 'Insert a template to begin.')}
        </span>
        {removed?.setId === projectSet.id ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => runCommand(undoRemoveTemplate, 'Restored')}
          >
            Undo Remove
          </button>
        ) : null}
      </footer>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Template actions"
          onClose={() => setMenu(null)}
          items={[
            {
              id: 'new-before',
              label: 'New Template Before',
              disabled: busy || !menu.templateId,
              onSelect: () => requestStartupCreation('set-template', menu.templateId, 'before'),
            },
            {
              id: 'new-after',
              label: menu.templateId ? 'New Template After' : 'New Template',
              disabled: busy,
              onSelect: () => requestStartupCreation('set-template', menu.templateId),
            },
            {
              id: 'insert-before',
              label: 'Insert Template Before…',
              disabled: busy || !menu.templateId,
              onSelect: () => void addTemplate(menu.templateId, 'before'),
            },
            {
              id: 'insert-after',
              label: menu.templateId ? 'Insert Template After…' : 'Insert Template…',
              disabled: busy,
              onSelect: () => void addTemplate(menu.templateId),
            },
            {
              id: 'duplicate',
              label: 'Duplicate',
              separatorBefore: true,
              disabled: busy || !menu.templateId,
              onSelect: () => runCommand(() => duplicateTemplate(menu.templateId!), 'Duplicated'),
            },
            {
              id: 'cut',
              label: 'Cut',
              disabled: busy || !menu.templateId,
              onSelect: () =>
                runCommand(() => {
                  copyTemplate(menu.templateId!);
                  return removeTemplate(menu.templateId!);
                }, 'Cut'),
            },
            {
              id: 'copy',
              label: 'Copy',
              disabled: busy || !menu.templateId,
              onSelect: () => runCommand(() => copyTemplate(menu.templateId!), 'Copied'),
            },
            {
              id: 'paste',
              label: 'Paste',
              disabled: busy || !clipboard,
              onSelect: () => runCommand(() => pasteTemplate(menu.templateId), 'Pasted'),
            },
            {
              id: 'template-settings',
              label: 'Template Settings…',
              separatorBefore: true,
              disabled: busy || !menu.templateId,
              onSelect: () => {
                try {
                  activateProjectSetTemplate(menu.templateId!);
                  useTemplateSetSettingsStore.getState().show('template');
                } catch (cause) {
                  setStatus(
                    cause instanceof Error ? cause.message : 'Could not open template settings.',
                  );
                }
              },
            },
            {
              id: 'rename',
              label: 'Rename',
              separatorBefore: true,
              disabled: busy || !menu.templateId,
              onSelect: () => requestRename(menu.templateId!),
            },
            {
              id: 'remove',
              label: 'Remove',
              disabled: busy || !menu.templateId,
              title: 'Remove template from set',
              onSelect: () => remove(menu.templateId!),
            },
            {
              id: 'restore',
              label: 'Undo Remove Template',
              disabled: busy || removed?.setId !== projectSet.id,
              onSelect: () => runCommand(undoRemoveTemplate, 'Restored'),
            },
            {
              id: 'move-earlier',
              label: 'Move Earlier',
              separatorBefore: true,
              disabled: busy || !menu.templateId || projectSet.templates[0]?.id === menu.templateId,
              onSelect: () => moveTemplate(menu.templateId!, -1),
            },
            {
              id: 'move-later',
              label: 'Move Later',
              disabled:
                busy || !menu.templateId || projectSet.templates.at(-1)?.id === menu.templateId,
              onSelect: () => moveTemplate(menu.templateId!, 1),
            },
          ]}
        />
      ) : null}
    </section>
  );
}
