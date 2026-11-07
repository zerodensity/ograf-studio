import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Project } from '@ograf-editor/scene-model';
import {
  buildProjectSetSceneTree,
  type ProjectSetDocument,
  type ProjectSetSceneNode,
} from '../state/projectSet';
import {
  filterSceneTree,
  findSceneTreePath,
  visibleSceneTreeNodes,
  type VisibleSceneTreeNode,
} from '../state/sceneTreeModel';
import { ProjectSetControlsPanel } from './ProjectSetControlsPanel';
import './ProjectSetControlsPanel.css';
import './SceneTreeExplorer.css';
import {
  LayerCropContextMenu,
  type LayerCropMenuPosition,
} from '../components/LayerCropContextMenu';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { selectionIdsForLayer } from '../canvas/groupSelection';
import { openComponentEditor } from './ComponentEditorDialog';
import { toggleSceneTreeNodeVisibility } from '../state/projectSetSession';

function SceneVisibilityIcon({ visible = true }: { visible?: boolean }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M1.7 9c1.45-2.55 4.05-4.25 7.3-4.25s5.85 1.7 7.3 4.25c-1.45 2.55-4.05 4.25-7.3 4.25S3.15 11.55 1.7 9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="9" cy="9" r="2.1" fill="currentColor" />
      {!visible && <path d="M3 3 15 15" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  );
}

function SceneIcon({ kind }: { kind: ProjectSetSceneNode['kind'] }) {
  const file =
    kind === 'template' ||
    kind === 'field' ||
    kind === 'control' ||
    kind === 'media-cue' ||
    kind === 'component-source-layer';
  const path =
    kind === 'asset-instance' || kind === 'component-instance'
      ? 'M6 10 4 12a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0M10 6l2-2a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0M5 11l6-6'
      : kind === 'layer'
        ? 'm8 1 7 4-7 4-7-4 7-4M1 8l7 4 7-4M1 11l7 4 7-4'
        : kind === 'asset'
          ? 'M2 2h12v12H2zM2 11l4-4 3 3 2-2 3 3M10 5h1'
          : file
            ? 'M3 1h7l3 3v11H3zM10 1v4h3M5 8h6M5 11h6'
            : 'M1 4V2h5l2 2h7v10H1z';
  return (
    <svg className={`scene-tree-icon icon-${kind}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function SceneTreeExplorer({
  set,
  activeTemplateId,
  activeProject,
  selectedLayerId,
  standalone,
  error,
  onActivate,
  onChange,
  onRenameSet,
}: {
  set: ProjectSetDocument;
  activeTemplateId: string;
  activeProject: Project;
  selectedLayerId: string | null;
  standalone: boolean;
  error: string;
  onActivate: (node: ProjectSetSceneNode) => void;
  onChange: (set: ProjectSetDocument, refresh: boolean) => void;
  onRenameSet: (name: string) => void;
}) {
  const root = useMemo(() => {
    const tree = buildProjectSetSceneTree({
      ...set,
      activeTemplateId,
      templates: set.templates.map((template) =>
        template.id === activeTemplateId ? { ...template, project: activeProject } : template,
      ),
    });
    return standalone ? tree.children.find((node) => node.kind === 'template')! : tree;
  }, [set, activeTemplateId, activeProject, standalone]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(
    () => new Set([root.id, ...root.children.map((node) => node.id)]),
  );
  const [selectedId, setSelectedId] = useState(root.id);
  const [followSelection, setFollowSelection] = useState(true);
  const [sharedOpen, setSharedOpen] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);
  const [editingSetName, setEditingSetName] = useState(false);
  const [setNameDraft, setSetNameDraft] = useState('');
  const [setNameError, setSetNameError] = useState('');
  const [visibilityError, setVisibilityError] = useState('');
  const setNameInputRef = useRef<HTMLInputElement>(null);
  const cancelSetNameRef = useRef(false);
  useEffect(() => {
    if (editingSetName) {
      setNameInputRef.current?.focus();
      setNameInputRef.current?.select();
    }
  }, [editingSetName]);
  const beginSetRename = () => {
    cancelSetNameRef.current = false;
    setSetNameDraft(set.name);
    setSetNameError('');
    setEditingSetName(true);
  };
  const commitSetRename = () => {
    if (cancelSetNameRef.current) return;
    try {
      onRenameSet(setNameDraft);
      setEditingSetName(false);
      setSetNameError('');
      setQuery('');
    } catch (cause) {
      setSetNameError(cause instanceof Error ? cause.message : 'Could not rename template set.');
    }
  };
  useEffect(() => {
    setExpanded(new Set([root.id, ...root.children.map((node) => node.id)]));
    setSelectedId(root.id);
    setQuery('');
    setSharedOpen(false);
    setEditingSetName(false);
    setSetNameError('');
    setVisibilityError('');
  }, [root.id]);

  const syncSelection = useCallback(() => {
    const path = findSceneTreePath(
      root,
      (node) =>
        node.templateId === activeTemplateId &&
        (selectedLayerId
          ? node.kind === 'layer' && node.targetId === selectedLayerId
          : node.kind === 'template'),
    );
    if (!path) return;
    setSelectedId(path.at(-1)!.id);
    setExpanded((current) => {
      const ancestors = path.slice(0, -1);
      return ancestors.every((node) => current.has(node.id))
        ? current
        : new Set([...current, ...ancestors.map((node) => node.id)]);
    });
  }, [root, activeTemplateId, selectedLayerId]);
  useEffect(() => {
    if (followSelection) syncSelection();
  }, [followSelection, syncSelection]);

  const filtered = useMemo(() => filterSceneTree(root, query), [root, query]);
  const searching = !!query.trim();
  const visible = useMemo(
    () => (filtered ? visibleSceneTreeNodes(filtered, expanded, searching) : []),
    [filtered, expanded, searching],
  );
  const focusId = visible.some((item) => item.node.id === selectedId)
    ? selectedId
    : visible[0]?.node.id;
  useEffect(() => {
    const row = [
      ...(treeRef.current?.querySelectorAll<HTMLElement>('[data-scene-node-id]') ?? []),
    ].find((element) => element.dataset.sceneNodeId === selectedId);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const focus = (id: string) => {
    setSelectedId(id);
    treeRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => {
      const row = [
        ...(treeRef.current?.querySelectorAll<HTMLElement>('[data-scene-node-id]') ?? []),
      ].find((element) => element.dataset.sceneNodeId === id);
      row?.focus();
    });
  };
  const [cropMenu, setCropMenu] = useState<LayerCropMenuPosition | null>(null);
  const activate = (node: ProjectSetSceneNode) => {
    setSelectedId(node.id);
    if (node.kind === 'control' || node.kind === 'controls' || node.kind === 'asset-slot')
      setSharedOpen(true);
    onActivate(node);
    if (
      (node.kind === 'component-asset' ||
        node.kind === 'component-source-layer' ||
        node.targetKind === 'component-layer') &&
      node.componentId &&
      node.compositionId
    ) {
      const state = useProjectStore.getState();
      if (state.activeCompositionId === node.compositionId)
        openComponentEditor(
          {
            compositionId: node.compositionId,
            componentId: node.componentId,
            sourceLayerId: node.sourceLayerId,
          },
          treeRef.current?.ownerDocument,
        );
    } else if (node.kind === 'component-instance' && node.instanceId) {
      const state = useProjectStore.getState();
      const composition = state.project.compositions.find(
        (item) => item.id === state.activeCompositionId,
      );
      useSelectionStore
        .getState()
        .selectMany(
          composition?.layers
            .filter(
              (layer) =>
                layer.componentLink?.instanceId === node.instanceId &&
                layer.componentLink?.componentId === node.componentId,
            )
            .map((layer) => layer.id) ?? [],
        );
    } else if (node.kind === 'layer' && node.instanceId && node.targetId)
      useSelectionStore.getState().select(node.targetId);
  };
  const navigate = (
    event: KeyboardEvent<HTMLDivElement>,
    item: VisibleSceneTreeNode,
    index: number,
  ) => {
    const { node, parentId } = item;
    if (event.key === 'ArrowDown') focus(visible[Math.min(index + 1, visible.length - 1)]!.node.id);
    else if (event.key === 'ArrowUp') focus(visible[Math.max(index - 1, 0)]!.node.id);
    else if (event.key === 'Home') focus(visible[0]!.node.id);
    else if (event.key === 'End') focus(visible.at(-1)!.node.id);
    else if (event.key === 'ArrowRight') {
      if (node.children.length && !expanded.has(node.id) && !searching) toggle(node.id);
      else if (node.children.length) focus(node.children[0]!.id);
    } else if (event.key === 'ArrowLeft') {
      if (node.children.length && expanded.has(node.id) && !searching) toggle(node.id);
      else if (parentId) focus(parentId);
    } else if (event.key === 'F2' && node.kind === 'set') beginSetRename();
    else if (event.key === 'Enter' || event.key === ' ') activate(node);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <section className="scene-tree-panel" aria-label="Scene Outliner">
      <div className="scene-tree-toolbar">
        <input
          type="search"
          aria-label="Search Scene Outliner"
          placeholder="Search Scene Outliner"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <button
          type="button"
          aria-label="Expand all scene nodes"
          title="Expand all"
          disabled={searching}
          onClick={() =>
            setExpanded(
              new Set(visibleSceneTreeNodes(root, new Set(), true).map((item) => item.node.id)),
            )
          }
        >
          ＋
        </button>
        <button
          type="button"
          aria-label="Collapse all scene nodes"
          title="Collapse all"
          disabled={searching}
          onClick={() => setExpanded(new Set([root.id]))}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Follow editor selection"
          aria-pressed={followSelection}
          title="Follow editor selection"
          onClick={() => {
            setFollowSelection((value) => !value);
          }}
        >
          ↔
        </button>
      </div>
      <div className="scene-tree-columns" aria-hidden="true">
        <span className="scene-tree-z-order" title="Z-order: higher numbers appear in front">
          Z
        </span>
        <span className="scene-tree-visibility-heading" title="Visibility">
          <SceneVisibilityIcon />
        </span>
        <span>Object</span>
      </div>
      <div className="scene-tree-scroll">
        <div
          role="tree"
          aria-label={
            standalone
              ? `${activeProject.name} scene and assets`
              : `${set.name} templates, scenes, and assets`
          }
          ref={treeRef}
          className="scene-tree-hierarchy"
        >
          {visible.map((item, index) => {
            const { node, depth } = item;
            const hasChildren = node.children.length > 0;
            const isExpanded = searching || expanded.has(node.id);
            const isActive = node.kind === 'template' && node.templateId === activeTemplateId;
            return (
              <div
                key={node.id}
                role="treeitem"
                data-scene-node-id={node.id}
                aria-level={depth + 1}
                aria-posinset={item.position}
                aria-setsize={item.siblingCount}
                aria-expanded={hasChildren ? isExpanded : undefined}
                aria-selected={node.id === selectedId}
                tabIndex={node.id === focusId ? 0 : -1}
                className={`scene-tree-row kind-${node.kind}${node.id === selectedId ? ' is-selected' : ''}${isActive ? ' is-active-template' : ''}${node.isVisible === false ? ' is-hidden' : ''}`}
                title={node.referencePath ? `${node.label} · ${node.referencePath}` : node.label}
                onClick={() => activate(node)}
                onContextMenu={(event) => {
                  if (node.kind !== 'layer' || !node.targetId) return;
                  event.preventDefault();
                  const previousSelection = useSelectionStore.getState().selectedLayerIds;
                  const previousComposition = useProjectStore.getState().activeCompositionId;
                  activate(node);
                  const state = useProjectStore.getState();
                  const composition = state.project.compositions.find(
                    (item) => item.id === state.activeCompositionId,
                  );
                  if (!composition?.layers.some((layer) => layer.id === node.targetId)) return;
                  const layerIds =
                    previousComposition === composition.id &&
                    previousSelection.includes(node.targetId)
                      ? previousSelection
                      : selectionIdsForLayer(composition, node.targetId);
                  useSelectionStore.getState().selectMany(layerIds);
                  setCropMenu({ x: event.clientX, y: event.clientY, layerIds });
                }}
                onDoubleClick={() => {
                  if (node.kind === 'set') beginSetRename();
                  else if (hasChildren && !searching) toggle(node.id);
                }}
                onKeyDown={(event) => navigate(event, item, index)}
              >
                <span
                  className="scene-tree-z-order"
                  title={
                    node.zOrder === undefined
                      ? undefined
                      : `Z-order ${node.zOrder} · Higher numbers appear in front`
                  }
                  aria-label={node.zOrder === undefined ? undefined : `Z-order ${node.zOrder}`}
                >
                  {node.zOrder ?? ''}
                </span>
                {node.isVisible === undefined ? (
                  <span />
                ) : (
                  <button
                    type="button"
                    className="scene-tree-visibility"
                    aria-label={`${node.label} visibility`}
                    aria-pressed={node.isVisible}
                    title={`${node.isVisible ? 'Hide' : 'Show'} ${node.label}`}
                    disabled={!node.templateId || !node.compositionId}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      try {
                        toggleSceneTreeNodeVisibility(node);
                        setVisibilityError('');
                      } catch (cause) {
                        setVisibilityError(
                          cause instanceof Error
                            ? cause.message
                            : 'Could not change object visibility.',
                        );
                      }
                    }}
                  >
                    <SceneVisibilityIcon visible={node.isVisible} />
                  </button>
                )}
                <div className="scene-tree-object" style={{ paddingLeft: depth * 16 }}>
                  <button
                    type="button"
                    className="scene-tree-chevron"
                    tabIndex={-1}
                    disabled={!hasChildren || searching}
                    onDoubleClick={(event) => event.stopPropagation()}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(node.id);
                    }}
                  >
                    {hasChildren ? (isExpanded ? '▾' : '▸') : ''}
                  </button>
                  <SceneIcon kind={node.kind} />
                  {node.kind === 'set' && editingSetName ? (
                    <input
                      ref={setNameInputRef}
                      className="scene-tree-name-input"
                      aria-label="Template set name"
                      aria-invalid={!!setNameError}
                      value={setNameDraft}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        setSetNameDraft(event.currentTarget.value);
                        setSetNameError('');
                      }}
                      onBlur={commitSetRename}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitSetRename();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelSetNameRef.current = true;
                          setEditingSetName(false);
                          setSetNameError('');
                        }
                      }}
                    />
                  ) : (
                    <span className="scene-tree-name">{node.label}</span>
                  )}
                  {node.kind === 'set' || node.kind === 'template' ? (
                    <span className="scene-tree-badge">
                      {node.kind === 'set' ? 'Template Set' : 'Template'}
                    </span>
                  ) : null}
                  {isActive ? <span className="scene-tree-badge">Active</span> : null}
                  {node.kind === 'component-asset' ||
                  node.kind === 'component-source-layer' ||
                  node.kind === 'component-instance' ? (
                    <span className="scene-tree-badge">
                      {node.kind === 'component-instance' ? 'Instance' : 'Source'}
                    </span>
                  ) : null}
                  {node.inherited === false ? (
                    <span className="scene-tree-badge">Override</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {!visible.length ? <p className="scene-tree-empty">No matching scenes or assets.</p> : null}
        {!standalone ? (
          <details
            className="project-set-authoring-details"
            open={sharedOpen}
            onToggle={(event) => setSharedOpen(event.currentTarget.open)}
          >
            <summary>Shared controls and asset slots</summary>
            <ProjectSetControlsPanel
              set={set}
              activeTemplateId={activeTemplateId}
              activeProject={activeProject}
              onChange={onChange}
            />
          </details>
        ) : null}
      </div>
      <div className="scene-tree-status" aria-live="polite">
        {visibilityError ||
          setNameError ||
          error ||
          `${visible.length} items · ${standalone ? 'Template' : 'Template Set'}`}
      </div>
      {cropMenu ? <LayerCropContextMenu menu={cropMenu} onClose={() => setCropMenu(null)} /> : null}
    </section>
  );
}
