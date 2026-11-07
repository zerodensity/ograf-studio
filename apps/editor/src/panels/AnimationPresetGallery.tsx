import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  isAnimationPresetPluginSnapshot,
  layerMotionWindows,
  rendererPluginKey,
  studioPluginReference,
  type AnimationPluginPreset,
  type AnimationPresetApplication,
  type AnimationPresetPluginSnapshot,
  type Composition,
  type Layer,
  type LayerMotionSide,
  type StudioPluginReference,
} from '@ograf-editor/scene-model';
import { useEditorWindow } from '../layout/EditorWindow';
import { useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { useConfigurationRequestStore } from '../state/configurationRequestStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import {
  PluginTemplateGallery,
  PluginTemplateWorkspace,
} from '../components/PluginTemplateGallery';
import { filterPluginTemplates } from '../components/pluginTemplateFilter';
import { useMovableDialog } from '../components/useMovableDialog';
import { FrameDurationControl } from './FrameDurationControl';
import {
  animationPresetParameters,
  animationPresetTargetReason,
  animationSelectionKey,
  parseAnimationPresetOptions,
} from './animationPresetGalleryHelpers';
import './AnimationPresetGallery.css';

function PresetThumbnail({
  preset,
  side,
}: {
  preset: AnimationPluginPreset;
  side: LayerMotionSide;
}) {
  const properties = (preset.tracks[side] ?? []).map((track) => track.property);
  const scale = properties.includes('scale');
  const clip = properties.some((property) => property.startsWith('clip'));
  const rotate = properties.includes('rotation');
  const move = properties.includes('x') || properties.includes('y');
  return (
    <svg className="animation-preset-thumbnail" viewBox="0 0 68 36" aria-hidden="true">
      <rect className="animation-thumbnail-guide" x="19" y="6" width="31" height="24" rx="2" />
      {rotate ? (
        <g transform="rotate(-16 34 18)">
          <rect x="20" y="8" width="28" height="20" rx="2" />
        </g>
      ) : scale ? (
        <rect x="27" y="12" width="15" height="12" rx="1" />
      ) : clip ? (
        <path d="M19 6h15v24H19Z" />
      ) : (
        <rect
          x={move ? 11 : 20}
          y="8"
          width="28"
          height="20"
          rx="2"
          opacity={properties.includes('opacity') ? 0.65 : 1}
        />
      )}
      {move ? <path className="animation-thumbnail-arrow" d="M42 18h17m-4-4 4 4-4 4" /> : null}
    </svg>
  );
}

export function AnimationPresetTiles({
  presets,
  side,
  targets,
  selected,
  onSelect,
  shared = false,
}: {
  presets: readonly AnimationPluginPreset[];
  side: LayerMotionSide;
  targets: readonly Layer[];
  selected?: string;
  onSelect(id: string): void;
  shared?: boolean;
}) {
  if (shared)
    return (
      <PluginTemplateGallery
        items={presets
          .filter((preset) => preset.tracks[side]?.length)
          .map((preset) => {
            const reason = animationPresetTargetReason(preset, side, targets);
            return {
              id: preset.id,
              name: preset.name,
              description: preset.description,
              icon: <PresetThumbnail preset={preset} side={side} />,
              disabled: Boolean(reason),
              disabledReason: reason ?? undefined,
            };
          })}
        selected={selected}
        onSelect={onSelect}
        label="Animation preset gallery"
      />
    );
  return (
    <div className="animation-preset-tiles" role="group" aria-label="Animation preset gallery">
      {presets
        .filter((preset) => preset.tracks[side]?.length)
        .map((preset) => {
          const reason = animationPresetTargetReason(preset, side, targets);
          return (
            <button
              type="button"
              key={preset.id}
              aria-pressed={selected === preset.id}
              disabled={Boolean(reason)}
              title={reason || preset.description || preset.name}
              onClick={() => onSelect(preset.id)}
            >
              <PresetThumbnail preset={preset} side={side} />
              <span>{preset.name}</span>
            </button>
          );
        })}
    </div>
  );
}

export function AnimationPresetGallery({
  composition,
  layerIds,
  initialSide = 'in',
  initialReference,
  initialApplication,
  pluginId,
  anchor,
  onClose,
  embedded = false,
  searchQuery,
  browserHeader,
}: {
  composition: Composition;
  layerIds: readonly string[];
  initialSide?: LayerMotionSide;
  initialReference?: StudioPluginReference;
  initialApplication?: AnimationPresetApplication;
  pluginId?: string;
  anchor?: HTMLButtonElement;
  onClose(): void;
  embedded?: boolean;
  searchQuery?: string;
  browserHeader?: ReactNode;
}) {
  const { window: ownerWindow, document: ownerDocument } = useEditorWindow();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const settings = useRendererPluginSettingsStore();
  const selection = useSelectionStore((state) => state.selectedLayerIds);
  const applyPreset = useProjectStore((state) => state.applyLayerAnimationPreset);
  const packs = useMemo(
    () =>
      settings.installed
        .filter(
          (entry) =>
            entry.enabled &&
            entry.trusted &&
            isAnimationPresetPluginSnapshot(entry.snapshot) &&
            (!pluginId || entry.snapshot.manifest.id === pluginId),
        )
        .map((entry) => entry.snapshot as AnimationPresetPluginSnapshot)
        .sort(
          (left, right) =>
            left.manifest.name.localeCompare(right.manifest.name) ||
            right.manifest.version.localeCompare(left.manifest.version, undefined, {
              numeric: true,
            }),
        ),
    [settings.installed, pluginId],
  );
  const context = useRef({
    compositionId: composition.id,
    projectId: useProjectStore.getState().project.id,
    targets: [...layerIds],
    selection: animationSelectionKey(selection),
    revision: settings.revision,
  });
  if (embedded)
    context.current = {
      compositionId: composition.id,
      projectId: useProjectStore.getState().project.id,
      targets: [...new Set(layerIds)],
      selection: animationSelectionKey(selection),
      revision: settings.revision,
    };
  const [packKey, setPackKey] = useState(() =>
    initialReference
      ? rendererPluginKey(initialReference)
      : packs[0]
        ? rendererPluginKey(studioPluginReference(packs[0]))
        : '',
  );
  const [side, setSide] = useState(initialSide);
  const pack = packs.find(
    (candidate) => rendererPluginKey(studioPluginReference(candidate)) === packKey,
  );
  const historical =
    initialApplication && rendererPluginKey(initialApplication.reference) === packKey
      ? initialApplication
      : undefined;
  const [presetId, setPresetId] = useState(
    () =>
      pack?.presets.find(
        (preset) => preset.id === historical?.presetId && preset.tracks[initialSide]?.length,
      )?.id ??
      pack?.presets.find((preset) => preset.tracks[initialSide]?.length)?.id ??
      '',
  );
  const presets = filterPluginTemplates(pack?.presets ?? [], searchQuery ?? '').filter(
    (candidate) => candidate.tracks[side]?.length,
  );
  const preset = presets.find((candidate) => candidate.id === presetId) ?? presets[0];
  const parameterKey = `${packKey}:${side}:${preset?.id ?? ''}`;
  const [parameterDraft, setParameterDraft] = useState<{
    key: string;
    values: Record<string, string>;
  }>(() => ({
    key: parameterKey,
    values: preset
      ? Object.fromEntries(
          (preset.parameters ?? []).map((parameter) => [
            parameter.id,
            String(
              historical?.presetId === preset.id
                ? (historical.parameters[parameter.id] ?? parameter.default)
                : parameter.default,
            ),
          ]),
        )
      : {},
  }));
  // Search can change the effective preset before an explicit card click. Never reuse another
  // preset's draft values, even when both presets happen to name a parameter identically.
  const parameters =
    parameterDraft.key === parameterKey
      ? parameterDraft.values
      : preset
        ? animationPresetParameters(preset)
        : {};
  const windows = layerMotionWindows(composition);
  const available = windows ? (side === 'in' ? windows.inFrames : windows.outFrames) : 0;
  const [duration, setDuration] = useState(
    String(historical?.durationFrames ?? Math.max(1, Math.min(12, available))),
  );
  const [offset, setOffset] = useState(String(historical?.offsetFrames ?? 0));
  const [presetError, setPresetError] = useState({ key: '', message: '' });
  const error = presetError.key === parameterKey ? presetError.message : '';
  const panel = useRef<HTMLElement>(null);
  const { dialogProps, handleProps, hasMoved } = useMovableDialog(panel, { enabled: !embedded });
  const hasMovedRef = useRef(hasMoved);
  hasMovedRef.current = hasMoved;
  const placePanel = useRef<(() => void) | null>(null);
  const [position, setPosition] = useState({ top: 80, left: 80 });
  const targets = composition.layers.filter((layer) => context.current.targets.includes(layer.id));
  const unlocked = targets.filter((layer) => !layer.isLocked);
  let reason = !pack
    ? 'Install and enable an animation preset pack in Plugins.'
    : !preset
      ? searchQuery?.trim()
        ? 'No matching animation templates.'
        : `This pack has no ${side === 'in' ? 'In' : 'Out'} preset.`
      : !targets.length
        ? 'Select an object to apply a preset.'
        : !unlocked.length
          ? 'The selected objects are locked.'
          : targets.length !== context.current.targets.length
            ? 'A selected object no longer exists.'
            : animationPresetTargetReason(preset, side, targets);
  let options: ReturnType<typeof parseAnimationPresetOptions> | undefined;
  if (!reason && preset) {
    try {
      options = parseAnimationPresetOptions(
        preset,
        side,
        composition,
        duration,
        parameters,
        offset,
      );
    } catch (cause) {
      reason = cause instanceof Error ? cause.message : String(cause);
    }
  }
  useEffect(() => {
    if (embedded) return;
    if (
      composition.id !== context.current.compositionId ||
      settings.revision !== context.current.revision ||
      animationSelectionKey(selection) !== context.current.selection
    )
      onCloseRef.current();
  }, [embedded, composition.id, settings.revision, selection]);
  useEffect(() => {
    if (embedded) return;
    const place = () => {
      if (hasMovedRef.current) return;
      const width = Math.min(410, ownerWindow.innerWidth - 16);
      const height = panel.current?.offsetHeight ?? 400;
      const rect = anchor?.getBoundingClientRect();
      const left = rect?.left ?? (ownerWindow.innerWidth - width) / 2;
      const below = rect ? rect.bottom + 4 : (ownerWindow.innerHeight - height) / 2;
      setPosition({
        left: Math.max(8, Math.min(left, ownerWindow.innerWidth - width - 8)),
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
    const close = () => {
      onCloseRef.current();
      if (anchor?.isConnected) anchor.focus();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !anchor?.contains(target)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
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
    snapshot: AnimationPresetPluginSnapshot | undefined,
    nextSide: LayerMotionSide,
    id?: string,
  ) => {
    const chosen =
      snapshot?.presets.find(
        (candidate) => candidate.id === id && candidate.tracks[nextSide]?.length,
      ) ?? snapshot?.presets.find((candidate) => candidate.tracks[nextSide]?.length);
    setPresetId(chosen?.id ?? '');
    setParameterDraft({
      key: `${snapshot ? rendererPluginKey(studioPluginReference(snapshot)) : ''}:${nextSide}:${chosen?.id ?? ''}`,
      values: chosen ? animationPresetParameters(chosen) : {},
    });
    setPresetError({ key: '', message: '' });
    if (nextSide !== side) setOffset('0');
    const nextWindows = layerMotionWindows(composition);
    const max = nextWindows
      ? nextSide === 'in'
        ? nextWindows.inFrames
        : nextWindows.outFrames
      : 0;
    setDuration((previous) => String(Math.max(1, Math.min(Number(previous) || 12, max))));
  };
  const apply = () => {
    if (!pack || !preset || !options || reason) return;
    const state = useProjectStore.getState();
    if (
      state.project.id !== context.current.projectId ||
      state.activeCompositionId !== context.current.compositionId ||
      !state.project.compositions.some(
        (candidate) => candidate.id === context.current.compositionId,
      ) ||
      useRendererPluginSettingsStore.getState().revision !== context.current.revision ||
      animationSelectionKey(useSelectionStore.getState().selectedLayerIds) !==
        context.current.selection
    ) {
      if (!embedded) onClose();
      return;
    }
    try {
      runDiscreteHistoryStep(
        () =>
          applyPreset(
            context.current.targets,
            studioPluginReference(pack),
            preset.id,
            side,
            options!,
          ),
        `Apply ${preset.name} ${side === 'in' ? 'In' : 'Out'}`,
      );
      if (!embedded) onClose();
    } catch (cause) {
      setPresetError({
        key: parameterKey,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };
  const timingControls = (
    <>
      <select
        aria-label="Animation side"
        value={side}
        onChange={(event) => {
          const next = event.target.value as LayerMotionSide;
          setSide(next);
          choose(pack, next);
        }}
      >
        <option value="in">In</option>
        <option value="out">Out</option>
      </select>
      <FrameDurationControl
        compact
        label="Preset duration"
        frames={Number(duration) || 1}
        frameRate={composition.frameRate}
        minFrames={1}
        maxFrames={Math.max(1, available)}
        onChange={(frames) => setDuration(String(frames))}
      />
      <FrameDurationControl
        compact
        label="Finish offset"
        frames={Number(offset) || 0}
        frameRate={composition.frameRate}
        minFrames={0}
        maxFrames={available}
        onChange={(frames) => setOffset(String(frames))}
      />
    </>
  );
  const presetSettings = (
    <>
      {preset?.description ? <p className="animation-preset-hint">{preset.description}</p> : null}
      {preset?.parameters?.length ? (
        <div className="animation-preset-parameters">
          {preset.parameters.map((parameter) => (
            <label key={parameter.id}>
              <span>{parameter.label}</span>
              <input
                aria-label={parameter.label}
                type="number"
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                value={parameters[parameter.id] ?? String(parameter.default)}
                onChange={(event) =>
                  setParameterDraft((current) => ({
                    key: parameterKey,
                    values: {
                      ...(current.key === parameterKey
                        ? current.values
                        : animationPresetParameters(preset)),
                      [parameter.id]: event.target.value,
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
      ) : null}
      <p className="animation-preset-hint">
        Replaces keys on this preset’s channels in the selected In/Out window; other tracks and
        loops stay unchanged.
      </p>
      <p className="animation-preset-hint">
        {unlocked.length} unlocked {unlocked.length === 1 ? 'object' : 'objects'}
        {targets.length !== unlocked.length
          ? `; ${targets.length - unlocked.length} locked ignored`
          : ''}
        . Applied presets become editable timeline keys.
      </p>
      {reason || error ? (
        <p className="animation-preset-error" role={error ? 'alert' : 'status'}>
          {error || reason}
        </p>
      ) : null}
      <footer>
        {!embedded ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              useConfigurationRequestStore.getState().open();
            }}
          >
            Manage plugins…
          </button>
        ) : null}
        <button type="button" disabled={Boolean(reason)} onClick={apply}>
          Apply {side === 'in' ? 'In' : 'Out'}
        </button>
      </footer>
    </>
  );
  const gallery =
    pack && presets.length ? (
      <AnimationPresetTiles
        presets={presets}
        side={side}
        targets={targets}
        selected={preset?.id}
        onSelect={(id) => choose(pack, side, id)}
        shared={embedded}
      />
    ) : pack && searchQuery?.trim() ? (
      <p className="animation-preset-hint">No matching animation templates.</p>
    ) : null;
  if (embedded)
    return (
      <section
        ref={panel}
        className="animation-preset-picker is-embedded"
        role="region"
        aria-label="Apply animation preset"
      >
        <PluginTemplateWorkspace
          browserHeader={browserHeader}
          gallery={gallery}
          details={
            <>
              <div className="animation-preset-controls">{timingControls}</div>
              {presetSettings}
            </>
          }
          detailsLabel="Animation Settings"
        />
      </section>
    );
  return createPortal(
    <section
      {...dialogProps}
      ref={panel}
      className="animation-preset-picker"
      role="dialog"
      aria-label="Apply animation preset"
      tabIndex={-1}
      style={position}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header {...handleProps}>
        <strong>{pluginId && pack ? pack.manifest.name : 'Animation presets'}</strong>
        <button type="button" aria-label="Close animation gallery" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="animation-preset-controls">
        <select
          aria-label="Animation pack version"
          value={packKey}
          onChange={(event) => {
            setPackKey(event.target.value);
            choose(
              packs.find(
                (candidate) =>
                  rendererPluginKey(studioPluginReference(candidate)) === event.target.value,
              ),
              side,
            );
          }}
        >
          <option value="" disabled>
            Choose a preset pack…
          </option>
          {packs.map((snapshot) => (
            <option
              key={rendererPluginKey(studioPluginReference(snapshot))}
              value={rendererPluginKey(studioPluginReference(snapshot))}
            >
              {snapshot.manifest.name} {snapshot.manifest.version}
              {packs.filter(
                (other) =>
                  other.manifest.id === snapshot.manifest.id &&
                  other.manifest.version === snapshot.manifest.version,
              ).length > 1
                ? ` · ${snapshot.sha256.slice(0, 8)}`
                : ''}
            </option>
          ))}
        </select>
        {timingControls}
      </div>
      {gallery}
      {presetSettings}
    </section>,
    ownerDocument.body,
  );
}
