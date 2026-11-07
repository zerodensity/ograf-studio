import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  isShaderPackPluginSnapshot,
  rendererPluginKey,
  studioPluginReference,
  type Composition,
  type ShaderPackPluginSnapshot,
  type ShaderPackPreset,
  type ShaderPackPresetTarget,
  type ShaderPaint,
  type StudioPluginReference,
} from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import {
  assertStudioPluginsAllowed,
  studioPluginAllowed,
  useRendererPluginSettingsStore,
} from '../state/pluginSettingsStore';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useConfigurationRequestStore } from '../state/configurationRequestStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { encodeShaderPluginPresetDrag, SHADER_PLUGIN_PRESET_MIME } from '../state/shaderCanvasDrag';
import {
  PluginTemplateGallery,
  PluginTemplateWorkspace,
} from '../components/PluginTemplateGallery';
import { ShaderLivePreview } from './ShaderLivePreview';
import { ShaderPresetIcon } from '../components/ShaderPresetIcon';
import { useMovableDialog } from '../components/useMovableDialog';
import {
  filterShaderPackPresets,
  shaderPackPreviewPaint,
  shaderPackResourceTarget,
  shaderPackSelectionKey,
  shaderPackTargetReason,
  SHADER_PACK_TARGET_LABELS,
} from './shaderPackGalleryHelpers';
import './ShaderPackGallery.css';

/** Names are inert controls; only the shared selected preview owns a GPU canvas. */
export function ShaderPackPresetList({
  presets,
  selected,
  onSelect,
  onDragStart,
  embedded = false,
}: {
  presets: readonly ShaderPackPreset[];
  selected?: string;
  onSelect(id: string): void;
  onDragStart?(id: string, event: DragEvent<HTMLButtonElement>): void;
  embedded?: boolean;
}) {
  if (embedded)
    return (
      <PluginTemplateGallery
        items={presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          icon: <ShaderPresetIcon name={preset.name} id={preset.id} />,
          ...(preset.description ? { description: preset.description } : {}),
        }))}
        selected={selected}
        onSelect={onSelect}
        onDragStart={onDragStart}
        label="Shader preset gallery"
      />
    );
  return (
    <div className="shader-pack-presets" role="group" aria-label="Shader preset gallery">
      {presets.map((preset) => (
        <button
          type="button"
          key={preset.id}
          aria-pressed={selected === preset.id}
          title={preset.description ?? preset.name}
          onClick={() => onSelect(preset.id)}
          draggable={Boolean(onDragStart)}
          onDragStart={onDragStart ? (event) => onDragStart(preset.id, event) : undefined}
        >
          <span>{preset.name}</span>
        </button>
      ))}
    </div>
  );
}

export function ShaderPackGallery({
  composition,
  layerIds,
  initialReference,
  pluginId,
  searchQuery,
  browserHeader,
  anchor,
  onClose,
  embedded = false,
}: {
  composition: Composition;
  layerIds: readonly string[];
  initialReference?: StudioPluginReference;
  pluginId?: string;
  searchQuery?: string;
  browserHeader?: ReactNode;
  anchor?: HTMLButtonElement;
  onClose(): void;
  embedded?: boolean;
}) {
  const { window: ownerWindow, document: ownerDocument } = useEditorWindow();
  const settings = useRendererPluginSettingsStore();
  const selection = useSelectionStore((state) => state.selectedLayerIds);
  const applyPreset = useProjectStore((state) => state.applyShaderPackPreset);
  const importPreset = useProjectStore((state) => state.importShaderPackPreset);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const context = useRef({
    projectId: useProjectStore.getState().project.id,
    compositionId: composition.id,
    revision: settings.revision,
    selection: shaderPackSelectionKey(selection),
    targetIds: [...new Set(layerIds)],
  });
  if (embedded)
    context.current = {
      projectId: useProjectStore.getState().project.id,
      compositionId: composition.id,
      revision: settings.revision,
      selection: shaderPackSelectionKey(selection),
      targetIds: [...new Set(layerIds)],
    };
  const packs = useMemo(
    () =>
      settings.installed.flatMap((entry) =>
        entry.enabled &&
        entry.trusted &&
        isShaderPackPluginSnapshot(entry.snapshot) &&
        (!pluginId || entry.snapshot.manifest.id === pluginId)
          ? [entry.snapshot]
          : [],
      ),
    [settings.installed, pluginId],
  );
  const [packKey, setPackKey] = useState(() =>
    initialReference
      ? rendererPluginKey(initialReference)
      : packs[0]
        ? rendererPluginKey(studioPluginReference(packs[0]))
        : '',
  );
  const pack = packs.find(
    (snapshot) => rendererPluginKey(studioPluginReference(snapshot)) === packKey,
  );
  const initialTarget: ShaderPackPresetTarget = pack?.shaders.some((entry) =>
    entry.targets.includes('fill'),
  )
    ? 'fill'
    : pack?.shaders.some((entry) => entry.targets.includes('outline'))
      ? 'outline'
      : 'effect';
  const [target, setTarget] = useState<ShaderPackPresetTarget>(initialTarget);
  const [presetId, setPresetId] = useState(
    () => pack?.shaders.find((preset) => preset.targets.includes(initialTarget))?.id ?? '',
  );
  const [localQuery, setLocalQuery] = useState('');
  const query = searchQuery ?? localQuery;
  const [error, setError] = useState('');
  const [position, setPosition] = useState({ top: 80, left: 80 });
  const panel = useRef<HTMLElement>(null);
  const { dialogProps, handleProps, hasMoved } = useMovableDialog(panel, { enabled: !embedded });
  const hasMovedRef = useRef(hasMoved);
  hasMovedRef.current = hasMoved;
  const placePanel = useRef<(() => void) | null>(null);
  const presets = filterShaderPackPresets(pack?.shaders ?? [], target, query);
  const preset = presets.find((entry) => entry.id === presetId) ?? presets[0];
  const targets = composition.layers.filter((layer) =>
    context.current.targetIds.includes(layer.id),
  );
  const allowed = useMemo(
    () =>
      Boolean(
        pack &&
        settings.installed.some(
          (entry) => entry.snapshot === pack && entry.enabled && entry.trusted,
        ) &&
        studioPluginAllowed(pack),
      ),
    [pack, settings.installed],
  );
  const reason =
    !pack || !allowed
      ? 'Install, review and enable this exact shader pack in Plugins.'
      : !preset
        ? 'Choose a shader for this target.'
        : targets.length !== context.current.targetIds.length
          ? 'A selected object no longer exists.'
          : shaderPackTargetReason(preset, target, targets);
  const resourceTarget = preset ? shaderPackResourceTarget(preset, target) : undefined;
  const previewKey = `${packKey}:${preset?.id ?? ''}:${target}`;
  const preview = useMemo<{ paint: ShaderPaint | null; error: string }>(() => {
    if (!pack || !preset || !allowed) return { paint: null, error: '' };
    try {
      assertStudioPluginsAllowed([pack]);
      return { paint: shaderPackPreviewPaint(pack, preset.id, target), error: '' };
    } catch (cause) {
      return { paint: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [pack, preset, target, allowed]);
  const close = () => {
    if (embedded) return;
    closeRef.current();
    if (anchor?.isConnected) anchor.focus();
  };
  const freshContext = () => {
    const state = useProjectStore.getState();
    return (
      state.project.id === context.current.projectId &&
      state.activeCompositionId === context.current.compositionId &&
      useRendererPluginSettingsStore.getState().revision === context.current.revision &&
      shaderPackSelectionKey(useSelectionStore.getState().selectedLayerIds) ===
        context.current.selection
    );
  };

  useEffect(() => {
    if (embedded) return;
    if (
      composition.id !== context.current.compositionId ||
      settings.revision !== context.current.revision ||
      shaderPackSelectionKey(selection) !== context.current.selection ||
      useProjectStore.getState().project.id !== context.current.projectId
    )
      closeRef.current();
  }, [embedded, composition.id, settings.revision, selection]);
  useEffect(() => {
    if (embedded) return;
    const place = () => {
      if (hasMovedRef.current) return;
      const width = Math.min(620, ownerWindow.innerWidth - 16);
      const height = panel.current?.offsetHeight ?? 430;
      const rect = anchor?.getBoundingClientRect();
      const below = rect ? rect.bottom + 4 : (ownerWindow.innerHeight - height) / 2;
      setPosition({
        left: Math.max(
          8,
          Math.min(
            rect?.left ?? (ownerWindow.innerWidth - width) / 2,
            ownerWindow.innerWidth - width - 8,
          ),
        ),
        top: Math.max(
          8,
          below + height <= ownerWindow.innerHeight - 8
            ? below
            : rect
              ? rect.top - height - 4
              : below,
        ),
      });
    };
    placePanel.current = place;
    const dismiss = () => {
      closeRef.current();
      if (anchor?.isConnected) anchor.focus();
    };
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node))
        dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    place();
    panel.current?.focus();
    ownerDocument.addEventListener('pointerdown', outside);
    ownerDocument.addEventListener('keydown', key, true);
    ownerWindow.addEventListener('resize', place);
    ownerDocument.addEventListener('scroll', place, true);
    return () => {
      placePanel.current = null;
      ownerDocument.removeEventListener('pointerdown', outside);
      ownerDocument.removeEventListener('keydown', key, true);
      ownerWindow.removeEventListener('resize', place);
      ownerDocument.removeEventListener('scroll', place, true);
    };
  }, [embedded, anchor, ownerDocument, ownerWindow]);
  useEffect(() => {
    if (!embedded && !hasMoved) placePanel.current?.();
  }, [embedded, hasMoved]);
  const choose = (
    snapshot: ShaderPackPluginSnapshot | undefined,
    nextTarget: ShaderPackPresetTarget,
    id?: string,
  ) => {
    setError('');
    setPresetId(
      snapshot?.shaders.find((entry) => entry.id === id && entry.targets.includes(nextTarget))
        ?.id ??
        snapshot?.shaders.find((entry) => entry.targets.includes(nextTarget))?.id ??
        '',
    );
  };
  const perform = (action: 'apply' | 'import') => {
    if (!pack || !preset) return;
    if (!freshContext()) {
      close();
      return;
    }
    try {
      assertStudioPluginsAllowed([pack]);
      if (action === 'import') {
        if (!resourceTarget) throw new Error('This shader cannot be saved as a resource.');
        runDiscreteHistoryStep(
          () => importPreset(studioPluginReference(pack), preset.id, resourceTarget),
          `Import shader “${preset.name}”`,
        );
        close();
      } else {
        if (reason) throw new Error(reason);
        runDiscreteHistoryStep(
          () =>
            applyPreset(context.current.targetIds, studioPluginReference(pack), preset.id, target),
          `Apply shader “${preset.name}” as ${SHADER_PACK_TARGET_LABELS[target]}`,
        );
        close();
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const targetControl = (
    <label>
      <span>Use as</span>
      <select
        aria-label="Shader target"
        value={target}
        onChange={(event) => {
          const next = event.target.value as ShaderPackPresetTarget;
          setTarget(next);
          choose(pack, next, preset?.id);
        }}
      >
        {Object.entries(SHADER_PACK_TARGET_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
  const searchControl = (
    <input
      type="search"
      placeholder="Find shader…"
      aria-label="Find shader preset"
      value={query}
      onChange={(event) => setLocalQuery(event.target.value)}
    />
  );
  const presetList = (
    <>
      <ShaderPackPresetList
        presets={presets}
        selected={preset?.id}
        onSelect={(id) => choose(pack, target, id)}
        onDragStart={
          allowed && pack
            ? (id, event) => {
                try {
                  // Resolve fresh local state: dragging never installs, imports or trusts bytes.
                  assertStudioPluginsAllowed([pack]);
                  const current = useRendererPluginSettingsStore
                    .getState()
                    .installed.find(
                      (entry) =>
                        entry.enabled &&
                        entry.trusted &&
                        isShaderPackPluginSnapshot(entry.snapshot) &&
                        rendererPluginKey(studioPluginReference(entry.snapshot)) === packKey,
                    );
                  if (
                    !current ||
                    !isShaderPackPluginSnapshot(current.snapshot) ||
                    !current.snapshot.shaders.some((shader) => shader.id === id)
                  )
                    throw new Error('This exact shader pack is no longer available.');
                  event.dataTransfer.setData(
                    SHADER_PLUGIN_PRESET_MIME,
                    encodeShaderPluginPresetDrag(
                      useProjectStore.getState().project.id,
                      studioPluginReference(current.snapshot),
                      id,
                    ),
                  );
                  event.dataTransfer.effectAllowed = 'copy';
                } catch (cause) {
                  event.preventDefault();
                  setError(cause instanceof Error ? cause.message : String(cause));
                }
              }
            : undefined
        }
        embedded={embedded}
      />
      {!presets.length ? (
        <p className="shader-pack-hint">No matching shaders for this target.</p>
      ) : null}
    </>
  );
  const selectedPreview = (
    <section className="shader-pack-preview" aria-label="Selected shader preview">
      {!embedded ? <strong>{preset?.name ?? 'Shader preview'}</strong> : null}
      {preview.paint ? (
        <ShaderLivePreview
          key={previewKey}
          paint={preview.paint}
          label={preset?.name ?? 'Shader'}
        />
      ) : (
        <div className="shader-pack-preview-placeholder">
          {preview.error || 'Choose a shader to preview.'}
        </div>
      )}
    </section>
  );
  const presetInformation = (
    <>
      {preset?.description ? <p className="shader-pack-hint">{preset.description}</p> : null}
      <p className="shader-pack-hint">
        Only the selected shader runs. Preview can use GPU resources.
      </p>
      {preview.paint && target === 'effect' ? (
        <p className="shader-pack-hint">
          Preview uses a checkerboard. Applying the effect uses the actual layer image, including
          video.
        </p>
      ) : null}
      <p className="shader-pack-hint">
        Creates an editable copy; pack updates/removal do not change existing shaders.
        {target === 'outline' ? ' Outline uses the current Stroke Width.' : ''}
      </p>
      {reason || error || preview.error ? (
        <p className="shader-pack-error" role={error || preview.error ? 'alert' : 'status'}>
          {error || preview.error || reason}
        </p>
      ) : null}
    </>
  );
  const actions = (
    <footer>
      {!embedded ? (
        <button
          type="button"
          onClick={() => {
            close();
            useConfigurationRequestStore.getState().open();
          }}
        >
          Manage plugins
        </button>
      ) : null}
      <div>
        <button
          type="button"
          disabled={!allowed || !resourceTarget}
          title={
            resourceTarget
              ? resourceTarget === 'effect'
                ? 'Copy this shader into Resources → Shaders as an effect source; its stack supplies the incoming image.'
                : 'Copy this shader into Resources → Shaders.'
              : 'This shader cannot be saved as a resource.'
          }
          onClick={() => perform('import')}
        >
          Add to Resources
        </button>
        <button
          type="button"
          disabled={Boolean(reason)}
          title={
            reason || `Apply to ${targets.length} selected object${targets.length === 1 ? '' : 's'}`
          }
          onClick={() => perform('apply')}
        >
          Apply {SHADER_PACK_TARGET_LABELS[target]}
        </button>
      </div>
    </footer>
  );
  const content = (
    <section
      {...(!embedded ? dialogProps : {})}
      ref={panel}
      className={`shader-pack-picker${embedded ? ' is-embedded' : ''}`}
      role={embedded ? 'region' : 'dialog'}
      aria-label="Shader pack gallery"
      tabIndex={embedded ? undefined : -1}
      style={embedded ? undefined : position}
      onKeyDown={embedded ? undefined : (event) => event.stopPropagation()}
    >
      {embedded ? (
        <PluginTemplateWorkspace
          browserHeader={browserHeader}
          gallery={presetList}
          detailsLabel="Shader Preview"
          details={
            <>
              {selectedPreview}
              <div className="plugin-template-info">
                <div className="shader-pack-controls">{targetControl}</div>
                {presetInformation}
                {actions}
              </div>
            </>
          }
        />
      ) : (
        <>
          <header {...handleProps}>
            <strong>{pack?.manifest.name ?? 'Shader packs'}</strong>
            <button type="button" aria-label="Close shader gallery" onClick={close}>
              ×
            </button>
          </header>
          <div className="shader-pack-controls">
            <select
              aria-label="Shader pack version"
              value={packKey}
              onChange={(event) => {
                const value = event.target.value;
                setPackKey(value);
                choose(
                  packs.find((entry) => rendererPluginKey(studioPluginReference(entry)) === value),
                  target,
                );
              }}
            >
              <option value="" disabled>
                Choose a shader pack…
              </option>
              {packs.map((snapshot) => (
                <option
                  key={rendererPluginKey(studioPluginReference(snapshot))}
                  value={rendererPluginKey(studioPluginReference(snapshot))}
                >
                  {snapshot.manifest.name} {snapshot.manifest.version}
                  {packs.filter(
                    (entry) =>
                      entry.manifest.id === snapshot.manifest.id &&
                      entry.manifest.version === snapshot.manifest.version,
                  ).length > 1
                    ? ` · ${snapshot.sha256.slice(0, 8)}`
                    : ''}
                </option>
              ))}
            </select>
            {targetControl}
            {searchControl}
          </div>
          <div className="shader-pack-browser">
            <div className="shader-pack-list">{presetList}</div>
            {selectedPreview}
          </div>
          {presetInformation}
          {actions}
        </>
      )}
    </section>
  );
  return embedded ? content : createPortal(content, ownerDocument.body);
}
