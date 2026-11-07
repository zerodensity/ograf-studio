import { effectParameterHelp } from './propertyHelp';
import { PropertyRow } from '../components/PropertyRow';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { useEditorWindow } from '../layout/EditorWindow';
import { useState } from 'react';
import {
  EFFECT_CATALOG,
  EFFECT_BLEND_MODES,
  type EffectBlendMode,
  EFFECT_TYPES,
  MAX_EFFECTS,
  effectEnabled,
  effectParams,
  getEffectStack,
  getLayerEffectsAtFrame,
  type EffectType,
  type Layer,
} from '@ograf-editor/scene-model';
import { useProjectStore, useActiveComposition } from '../state/projectStore';
import { useTestDataStore } from '../state/testDataStore';
import { resolveDesignerEffects } from '../state/dataBinding';
import { shaderPaintWithPatch } from '../state/shaderResources';
import { SHADER_RESOURCE_MIME, shaderEffectPatchFromResourceDrag } from '../state/shaderDrag';
import { ShaderSourceEditor } from './ShaderSourceEditor';
import { openShaderResourceEditor } from '../state/shaderEditorRequest';
import './EffectStackEditor.css';

const blendLabel = (mode: EffectBlendMode) =>
  mode === 'add' ? 'Add' : mode[0]!.toUpperCase() + mode.slice(1);

/** Interactive controls inside a <summary> must not also toggle the disclosure. */
const swallow = {
  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onKeyDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
};

export function EffectStackEditor({
  layer,
  frame,
  groupLayers = [layer],
}: {
  layer: Layer;
  frame: number;
  groupLayers?: Layer[];
}) {
  const { window } = useEditorWindow();
  const composition = useActiveComposition();
  const fields = composition.dataFields;
  const previewValues = useTestDataStore((state) => state.values);
  const [type, setType] = useState<EffectType>('glow'),
    [error, setError] = useState(''),
    [dragOver, setDragOver] = useState(false),
    [showBuiltIns, setShowBuiltIns] = useState(false);
  const add = useProjectStore((s) => s.addLayerEffect),
    update = useProjectStore((s) => s.updateLayerEffect),
    remove = useProjectStore((s) => s.removeLayerEffect),
    duplicate = useProjectStore((s) => s.duplicateLayerEffect),
    reorder = useProjectStore((s) => s.reorderLayerEffects),
    addGroup = useProjectStore((s) => s.addGroupEffect),
    updateGroup = useProjectStore((s) => s.updateGroupEffect),
    removeGroup = useProjectStore((s) => s.removeGroupEffect),
    duplicateGroup = useProjectStore((s) => s.duplicateGroupEffect),
    reorderGroup = useProjectStore((s) => s.reorderGroupEffects);
  const isGroup = groupLayers.length > 1,
    targetIds = groupLayers.map((candidate) => candidate.id),
    groupLocked = groupLayers.some((candidate) => candidate.isLocked);
  const supportsBackdrop = groupLayers.every(
    (candidate) => candidate.element.type === 'rectangle' || candidate.element.type === 'ellipse',
  );
  const effects = resolveDesignerEffects(
      layer,
      getLayerEffectsAtFrame(layer, frame),
      previewValues,
      fields,
    ),
    stack = getEffectStack(effects).filter(
      (effect) =>
        !isGroup ||
        groupLayers.every((candidate) =>
          getEffectStack(getLayerEffectsAtFrame(candidate, frame)).some(
            (groupEffect) => groupEffect.id === effect.id,
          ),
        ),
    );
  const run = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // Every layer carries a built-in blur and drop shadow. While they are off they are noise, so
  // they stay out of the list until used or asked for.
  const builtInIdle = (effect: (typeof stack)[number]) =>
    effect.legacy === 'blur'
      ? effects.blur <= 0 && !(layer.animationTracks.blur ?? []).some((key) => key.value > 0)
      : effect.legacy === 'drop-shadow'
        ? !effectEnabled(effect, effects)
        : false;
  const idleBuiltIns = stack.filter(builtInIdle);
  const visible = showBuiltIns ? stack : stack.filter((effect) => !builtInIdle(effect));
  /** Swaps with the neighbour the author can see, keeping hidden built-ins in place. */
  const move = (index: number, delta: number) =>
    run(() => {
      const ids = stack.map((e) => e.id);
      const from = ids.indexOf(visible[index]!.id);
      const to = ids.indexOf(visible[index + delta]!.id);
      [ids[from], ids[to]] = [ids[to]!, ids[from]!];
      if (isGroup) reorderGroup(targetIds, ids);
      else reorder(layer.id, ids);
    });
  const addTarget = (effectType: EffectType, patch?: Parameters<typeof add>[2]) =>
      isGroup ? addGroup(targetIds, effectType, patch) : add(layer.id, effectType, patch),
    updateTarget = (effectId: string, patch: Parameters<typeof update>[2]) =>
      isGroup
        ? updateGroup(targetIds, effectId, patch, frame)
        : update(layer.id, effectId, patch, frame),
    removeTarget = (effectId: string) =>
      isGroup ? removeGroup(targetIds, effectId) : remove(layer.id, effectId),
    duplicateTarget = (effectId: string) =>
      isGroup ? duplicateGroup(targetIds, effectId) : duplicate(layer.id, effectId),
    full = groupLayers.some(
      (candidate) => getEffectStack(getLayerEffectsAtFrame(candidate, frame)).length >= MAX_EFFECTS,
    );
  return (
    <div
      className={`effect-stack-editor${dragOver ? ' is-shader-drag-over' : ''}`}
      data-shader-drop-slot="effects"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = full || groupLocked ? 'none' : 'copy';
        setDragOver(!full && !groupLocked);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = full || groupLocked ? 'none' : 'copy';
        setDragOver(!full && !groupLocked);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes(SHADER_RESOURCE_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        if (full || groupLocked) return;
        run(() =>
          addTarget(
            'shader',
            shaderEffectPatchFromResourceDrag(
              useProjectStore.getState().project,
              event.dataTransfer.getData(SHADER_RESOURCE_MIME),
            ),
          ),
        );
      }}
    >
      <CollapsibleSection
        sectionId="properties.effects-stack"
        ariaLabel="Effects stack"
        className="effect-stack-section"
        title={
          <>
            {isGroup ? `Effects stack · ${groupLayers.length} objects` : 'Effects stack'}
            {visible.length > 0 && <span className="effect-stack-count">{visible.length}</span>}
          </>
        }
      >
        <div className="effect-stack-add">
          <select
            aria-label="New effect type"
            value={type}
            onChange={(e) => setType(e.target.value as EffectType)}
          >
            {EFFECT_TYPES.map((t) => (
              <option key={t} value={t} disabled={t === 'backdrop-blur' && !supportsBackdrop}>
                {EFFECT_CATALOG[t].label}
              </option>
            ))}
          </select>
          <button
            disabled={full || groupLocked || (type === 'backdrop-blur' && !supportsBackdrop)}
            title={
              full ? `Limit of ${MAX_EFFECTS} effects reached` : 'Add this effect to the stack'
            }
            onClick={() =>
              run(() =>
                addTarget(type, type === 'backdrop-blur' ? { blendMode: 'normal' } : undefined),
              )
            }
          >
            Add
          </button>
        </div>
        <p className="effect-stack-drop-hint">
          {isGroup
            ? `Applies to all ${groupLayers.length} selected objects separately. Individual layer effects remain independent.`
            : 'Drop a shader here to process this layer without replacing its fill.'}
        </p>
        {error && (
          <p role="alert" className="effect-stack-error">
            {error}
          </p>
        )}
        {idleBuiltIns.length > 0 ? (
          <button
            type="button"
            className="effect-stack-builtins"
            aria-pressed={showBuiltIns}
            onClick={() => setShowBuiltIns((current) => !current)}
          >
            {showBuiltIns ? 'Hide' : 'Show'} built-in{' '}
            {idleBuiltIns.map((effect) => effect.name.toLowerCase()).join(' and ')} (off)
          </button>
        ) : null}
        <div className="effect-stack-list">
          {visible.map((effect, index) => {
            const params = effectParams(effect, effects),
              enabled = effectEnabled(effect, effects),
              catalog = EFFECT_CATALOG[effect.type];
            return (
              <details
                className={`effect-stack-item${enabled ? '' : ' is-bypassed'}`}
                data-effect-id={effect.id}
                key={effect.id}
                open
              >
                <summary aria-label={`Effect ${effect.name}`}>
                  <input
                    className="effect-stack-name"
                    aria-label={`Effect name ${index + 1}`}
                    value={effect.name}
                    title={`${catalog.label} effect`}
                    {...swallow}
                    onChange={(e) => run(() => updateTarget(effect.id, { name: e.target.value }))}
                  />
                  {/* The type only earns space once the name no longer says it. */}
                  {effect.name !== catalog.label && (
                    <span className="effect-stack-type">{catalog.label}</span>
                  )}
                  {!enabled && <span className="effect-stack-badge">bypassed</span>}
                  <span className="effect-stack-actions" {...swallow}>
                    <button
                      aria-label={`Move ${effect.name} up`}
                      title="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Move ${effect.name} down`}
                      title="Move down"
                      disabled={index === visible.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      aria-label={`Duplicate ${effect.name}`}
                      title={full ? `Limit of ${MAX_EFFECTS} effects reached` : 'Duplicate'}
                      disabled={full}
                      onClick={() => run(() => duplicateTarget(effect.id))}
                    >
                      ⧉
                    </button>
                    <button
                      aria-label={`Remove ${effect.name}`}
                      title="Remove this effect and its own animation/bindings"
                      onClick={() => run(() => removeTarget(effect.id))}
                    >
                      ✕
                    </button>
                  </span>
                </summary>
                <PropertyRow
                  className="inspector-row effect-stack-blend"
                  help={
                    effect.type === 'backdrop-blur'
                      ? 'Normal enables backdrop blur. Amount scales its radius; Bypass switches it off.'
                      : 'Bypass skips this effect. A blend mode activates it and combines its result with the incoming image, at the opacity beside it.'
                  }
                >
                  <span>{effect.type === 'backdrop-blur' ? 'Mode / amount' : 'Blend'}</span>
                  <span className="effect-stack-blend-controls">
                    <select
                      aria-label={`${effect.name} blend mode`}
                      value={enabled ? (effect.blendMode ?? 'normal') : 'bypass'}
                      onChange={(event) =>
                        run(() =>
                          updateTarget(
                            effect.id,
                            event.target.value === 'bypass'
                              ? { enabled: false }
                              : { enabled: true, blendMode: event.target.value as EffectBlendMode },
                          ),
                        )
                      }
                    >
                      <option value="bypass">Bypass</option>
                      {EFFECT_BLEND_MODES.filter(
                        (mode) => effect.type !== 'backdrop-blur' || mode === 'normal',
                      ).map((mode) => (
                        <option key={mode} value={mode}>
                          {blendLabel(mode)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      aria-label={`${effect.name} ${effect.type === 'backdrop-blur' ? 'amount' : 'blend opacity'}`}
                      title={
                        effect.type === 'backdrop-blur'
                          ? 'Blur amount: scales the backdrop radius from zero to full strength.'
                          : "Effect opacity: mix this effect's blended result with its input; zero contributes nothing."
                      }
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round((effect.blendOpacity ?? 1) * 100)}
                      onChange={(event) =>
                        run(() =>
                          updateTarget(effect.id, {
                            blendOpacity:
                              Math.max(0, Math.min(100, Number(event.target.value))) / 100,
                          }),
                        )
                      }
                    />
                  </span>
                </PropertyRow>
                {effect.type === 'shader' && effect.shader && (
                  <div className="effect-stack-shader">
                    <p className="inspector-hint">
                      iChannel0 is the result of every preceding effect in this stack.
                    </p>
                    <ShaderSourceEditor
                      element={effect.shader}
                      showSourceEditor={false}
                      onEditShader={() =>
                        openShaderResourceEditor(
                          {
                            compositionId: composition.id,
                            layerId: layer.id,
                            slot: 'effect',
                            effectId: effect.id,
                          },
                          window,
                        )
                      }
                      editShaderLabel={isGroup ? `Edit shader for ${layer.name}…` : undefined}
                      labelPrefix={`${effect.name} shader`}
                      allowImageInput={false}
                      onChange={(patch) =>
                        run(() =>
                          updateTarget(effect.id, {
                            shader: shaderPaintWithPatch(effect.shader!, patch, {
                              channel0Provided: true,
                            }),
                          }),
                        )
                      }
                    />
                  </div>
                )}
                {Object.entries(catalog.params).map(([key, spec]) => (
                  <PropertyRow
                    help={effectParameterHelp(effect.type, key)}
                    className="inspector-row"
                    key={key}
                  >
                    <span>{spec.label}</span>
                    <input
                      aria-label={`${effect.name} ${spec.label}`}
                      type={typeof spec.default === 'number' ? 'number' : 'color'}
                      min={spec.min}
                      max={spec.max}
                      step={spec.step ?? 1}
                      value={
                        typeof spec.default === 'number'
                          ? Number(Number(params[key]).toFixed(4))
                          : String(params[key]).slice(0, 7)
                      }
                      onChange={(e) =>
                        run(() =>
                          updateTarget(effect.id, {
                            params: {
                              [key]:
                                typeof spec.default === 'number'
                                  ? Number(e.target.value)
                                  : e.target.value,
                            },
                          }),
                        )
                      }
                    />
                  </PropertyRow>
                ))}
              </details>
            );
          })}
        </div>
      </CollapsibleSection>
    </div>
  );
}
