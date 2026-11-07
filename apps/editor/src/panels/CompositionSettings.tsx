import { ColorInput } from '../components/ColorInput';
import { CANVAS_LAYOUT_HELP } from './propertyHelp';
import { WithWarning } from '../components/WarningBadge';
import { PropertyRow } from '../components/PropertyRow';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { TemplateSettingOrigin, TemplateSettingValue } from '../components/TemplateSettingOrigin';
import { InheritanceIcon, ResetInheritanceIcon } from '../components/InheritanceIcons';
import { useRef, useState } from 'react';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { colorPickerValue } from '../canvas/compositionBackground';
import { CanvasCropEditor } from '../canvas/CanvasCropEditor';
import { COMPOSITION_PRESETS, matchesCompositionPreset } from './compositionPresets';
import { FrameDurationControl } from './FrameDurationControl';
import { BrandBackgroundPaintEditor } from './BrandKitStylesEditor';
import {
  applyBackgroundStyle,
  updateCompositionBackgroundPaint,
  resetCompositionBackground,
  getBackgroundOrigin,
} from '../state/brandKitStyles';
import { getPlayoutCompatibilityWarnings } from '@ograf-editor/scene-model';
import { PropertiesFilter } from './PropertiesFilter';
import { usePropertiesFilter } from './propertiesFilterLogic';
import { useProjectSetStore } from '../state/projectSetStore';
import { usePaneRequestStore } from '../state/paneRequestStore';
import {
  setTemplateSettingsInheritance,
  useTemplateSetSettingsStore,
} from '../state/templateSetSettingsStore';
import { setTemplateSettingOverrides } from '../state/templateSetInheritance';
import {
  TEMPLATE_SET_SETTING_KEYS,
  type TemplateSetSettingKey,
} from '../state/templateSetSettings';

export function CompositionSettings({
  filter,
  onFilterChange,
  mode = 'inspector',
  section = 'output',
}: {
  filter: string;
  onFilterChange: (value: string) => void;
  mode?: 'inspector' | 'settings';
  section?: 'output' | 'background' | 'canvas' | 'guides';
}) {
  const inspectorRef = useRef<HTMLDivElement>(null);
  usePropertiesFilter(inspectorRef, filter);
  const [backgroundError, setBackgroundError] = useState('');
  const composition = useActiveComposition();
  const project = useProjectStore((s) => s.project);
  const setActiveComposition = useProjectStore((s) => s.setActiveComposition);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const template = projectSet?.templates.find((item) => item.id === activeTemplateId);
  const inheritsSettings = !!projectSet?.settings && template?.inheritSettings !== false;
  const inheritsCanvas = inheritsSettings && composition.id === project.mainCompositionId;
  const setProjectMeta = useProjectStore((s) => s.setProjectMeta);
  const update = useProjectStore((s) => s.updateCompositionSettings);
  const updateLayout = useProjectStore((s) => s.updateCompositionLayout);
  const addGuide = useProjectStore((s) => s.addCanvasGuide);
  const updateGuide = useProjectStore((s) => s.updateCanvasGuide);
  const removeGuide = useProjectStore((s) => s.removeCanvasGuide);
  const showSection = (page: typeof section) => mode !== 'settings' || section === page;
  const sectionId = (name: string) =>
    `${mode === 'settings' ? 'settings.template' : 'properties'}.${name}`;

  const markOverrides = (keys: string[]) => {
    const supported = keys.filter((key): key is TemplateSetSettingKey =>
      TEMPLATE_SET_SETTING_KEYS.includes(key as TemplateSetSettingKey),
    );
    if (supported.length) setTemplateSettingOverrides(supported, true);
  };
  const updateCanvas = (patch: Parameters<typeof update>[0]) => {
    if (inheritsCanvas) markOverrides(Object.keys(patch));
    update(patch);
  };
  const updateInheritedLayout = (patch: Parameters<typeof updateLayout>[0]) => {
    if (inheritsCanvas) markOverrides(Object.keys(patch).map((key) => `layout.${key}`));
    updateLayout(patch);
  };
  const updateRenderModes = (patch: Parameters<typeof setProjectMeta>[0]) => {
    if (inheritsSettings) markOverrides(Object.keys(patch));
    setProjectMeta(patch);
  };

  const activePresetIndex = COMPOSITION_PRESETS.findIndex((preset) =>
    matchesCompositionPreset(preset, composition.width, composition.height, composition.frameRate),
  );
  const isTransparent = composition.backgroundColor === 'transparent';
  const pickerColor = colorPickerValue(composition.backgroundColor);
  const backgroundOrigin = getBackgroundOrigin();
  const richBackground =
    composition.backgroundPaint !== undefined || !!composition.backgroundStyleId;
  const backgroundChange = (operation: () => unknown) => {
    try {
      operation();
      setBackgroundError('');
    } catch (cause) {
      setBackgroundError(
        cause instanceof Error ? cause.message : 'The background could not be updated.',
      );
    }
  };
  const playoutWarnings = getPlayoutCompatibilityWarnings(project, composition);
  const nonRealtimeWarning = playoutWarnings.find(
    (warning) => warning.id === 'davinci-resolve-non-realtime',
  );
  const backgroundWarning = playoutWarnings.find(
    (warning) => warning.id === 'opaque-composition-background',
  );

  return (
    <div
      className={`inspector${mode === 'settings' ? ' settings-template-inspector' : ''}`}
      ref={inspectorRef}
    >
      {mode === 'inspector' ? (
        <>
          <PropertiesFilter value={filter} onChange={onFilterChange} />
          <p className="panel-placeholder">Nothing selected — editing composition settings.</p>
          <button
            type="button"
            onClick={() => useTemplateSetSettingsStore.getState().show('template')}
          >
            Template Settings…
          </button>
        </>
      ) : project.compositions.length > 1 ? (
        <PropertyRow
          className="inspector-row"
          help="Choose the composition to edit. Template Set canvas defaults apply to the main composition; nested compositions keep their authored settings."
        >
          <span>Composition</span>
          <select
            value={composition.id}
            onChange={(event) => setActiveComposition(event.target.value)}
          >
            {project.compositions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.id === project.mainCompositionId ? ' (Main)' : ''}
              </option>
            ))}
          </select>
        </PropertyRow>
      ) : null}
      {projectSet ? (
        <div className="inspector-set-defaults">
          {projectSet.settings && template ? (
            <label className="inspector-set-defaults-toggle">
              <input
                type="checkbox"
                checked={inheritsSettings}
                onChange={(event) =>
                  setTemplateSettingsInheritance(template.id, event.target.checked)
                }
              />
              Use template set defaults
            </label>
          ) : (
            <p className="inspector-hint">Shared defaults have not been configured for this set.</p>
          )}
          <button
            type="button"
            onClick={() => useTemplateSetSettingsStore.getState().show('template-set')}
          >
            Template Set Settings…
          </button>
        </div>
      ) : null}

      {showSection('output') && (
        <>
          <CollapsibleSection sectionId={sectionId('composition')} title="Composition">
            <PropertyRow
              help={
                'Name of this composition in the project. This does not change text displayed by any layer.'
              }
              className="inspector-row"
            >
              <span>Name</span>
              <input
                type="text"
                value={composition.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </PropertyRow>

            <fieldset className="inspector-inherited-fields">
              <PropertyRow
                help={
                  'Apply a standard canvas resolution and frame rate together. Choose Custom dimensions by editing Width, Height or Frame rate.'
                }
                className="inspector-row"
              >
                <span>Preset</span>
                <select
                  value={activePresetIndex}
                  onChange={(e) => {
                    const preset = COMPOSITION_PRESETS[Number(e.target.value)];
                    if (preset)
                      updateCanvas({
                        width: preset.width,
                        height: preset.height,
                        frameRate: preset.frameRate,
                      });
                  }}
                >
                  {activePresetIndex === -1 && <option value={-1}>Custom</option>}
                  {COMPOSITION_PRESETS.map((preset, i) => (
                    <option key={preset.label} value={i}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </PropertyRow>

              <div className="inspector-grid">
                <PropertyRow
                  help={
                    'Width of the output canvas in pixels. Layer constraints determine how layers respond when the canvas size changes.'
                  }
                  className="inspector-row"
                >
                  <span>Width</span>
                  <TemplateSettingValue setting="width">
                    <input
                      type="number"
                      min={1}
                      value={composition.width}
                      onChange={(e) => updateCanvas({ width: Number(e.target.value) })}
                    />
                  </TemplateSettingValue>
                </PropertyRow>
                <PropertyRow
                  help={
                    'Height of the output canvas in pixels. Layer constraints determine how layers respond when the canvas size changes.'
                  }
                  className="inspector-row"
                >
                  <span>Height</span>
                  <TemplateSettingValue setting="height">
                    <input
                      type="number"
                      min={1}
                      value={composition.height}
                      onChange={(e) => updateCanvas({ height: Number(e.target.value) })}
                    />
                  </TemplateSettingValue>
                </PropertyRow>
              </div>

              <PropertyRow
                as="div"
                help="Choose the canvas output region without moving or resizing the authored layers."
                className="inspector-row"
              >
                <span>Canvas crop</span>
                <CanvasCropEditor />
              </PropertyRow>

              <PropertyRow
                help={
                  'Frames per second used by the timeline and exported graphic. This determines how frame durations convert to seconds.'
                }
                className="inspector-row"
              >
                <span>Frame rate</span>
                <TemplateSettingValue setting="frameRate">
                  <input
                    type="number"
                    min={1}
                    step="any"
                    value={Number(composition.frameRate.toFixed(3))}
                    onChange={(e) => updateCanvas({ frameRate: Number(e.target.value) })}
                  />
                </TemplateSettingValue>
              </PropertyRow>
              <FrameDurationControl
                propertyColumns
                label="Update animation"
                frames={composition.updateTransitionFrames}
                frameRate={composition.frameRate}
                minFrames={0}
                onChange={(updateTransitionFrames) => updateCanvas({ updateTransitionFrames })}
                labelSuffix={<TemplateSettingOrigin setting="updateTransitionFrames" />}
              />
              <PropertyRow
                help="What happens when new data arrives while the previous change is still fading: finish that fade first, or jump straight to the newest data."
                className="inspector-row"
              >
                <span>Data arrives mid-fade</span>
                <TemplateSettingValue setting="updateInterruption">
                  <select
                    value={composition.updateInterruption ?? 'queue'}
                    onChange={(event) =>
                      updateCanvas({
                        updateInterruption: event.target.value as 'queue' | 'replace',
                      })
                    }
                  >
                    <option value="queue">Finish current fade first</option>
                    <option value="replace">Jump to newest data</option>
                  </select>
                </TemplateSettingValue>
              </PropertyRow>
            </fieldset>
          </CollapsibleSection>

          <CollapsibleSection sectionId={sectionId('render-modes')} title="Render modes">
            <fieldset className="inspector-inherited-fields">
              <PropertyRow
                help={
                  'Declare support for real-time playback, where the graphic advances using the playback clock.'
                }
                className="inspector-row inspector-checkbox-row"
              >
                <span>Real-time</span>
                <TemplateSettingValue setting="supportsRealTime">
                  <input
                    type="checkbox"
                    checked={project.supportsRealTime}
                    onChange={(event) =>
                      updateRenderModes({ supportsRealTime: event.target.checked })
                    }
                  />
                </TemplateSettingValue>
              </PropertyRow>
              <PropertyRow
                help={
                  'Declare support for deterministic, time-addressed playback so a renderer can request an exact point in the animation.'
                }
                className="inspector-row inspector-checkbox-row"
              >
                <span>Non-real-time</span>
                <TemplateSettingValue setting="supportsNonRealTime">
                  <WithWarning message={nonRealtimeWarning?.message}>
                    <input
                      type="checkbox"
                      checked={project.supportsNonRealTime}
                      onChange={(event) =>
                        updateRenderModes({ supportsNonRealTime: event.target.checked })
                      }
                    />
                  </WithWarning>
                </TemplateSettingValue>
              </PropertyRow>
            </fieldset>
          </CollapsibleSection>
        </>
      )}

      {showSection('background') && (
        <CollapsibleSection sectionId={sectionId('background')} title="Background">
          <PropertyRow
            help="Choose a named Brand Kit background, or use the canvas color. Template Set defaults are inherited until this template chooses or edits a background. Reset restores inheritance."
            className="inspector-row"
          >
            <span>
              Style{' '}
              <small
                className={`inspector-brand-origin is-${backgroundOrigin.origin}`}
                title={`${backgroundOrigin.origin}: ${backgroundOrigin.sourceName ?? 'local background'}`}
                aria-label={`${backgroundOrigin.origin} background style`}
              >
                {backgroundOrigin.origin === 'local' ? null : (
                  <InheritanceIcon overridden={backgroundOrigin.origin === 'overridden'} />
                )}
                {backgroundOrigin.origin === 'overridden' && (
                  <button
                    type="button"
                    aria-label="Reset background to inherited style"
                    title="Reset background to inherited style"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      backgroundChange(resetCompositionBackground);
                    }}
                  >
                    <ResetInheritanceIcon />
                  </button>
                )}
              </small>
            </span>
            <select
              aria-label="Canvas background style"
              value={composition.backgroundStyleId ?? ''}
              onChange={(event) =>
                backgroundChange(() => applyBackgroundStyle(event.target.value || null))
              }
            >
              <option value="">Canvas color / custom paint</option>
              {(composition.designSystem.backgrounds ?? []).map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name}
                </option>
              ))}
            </select>
          </PropertyRow>
          {backgroundError && (
            <p className="inspector-error" role="alert">
              {backgroundError}
            </p>
          )}
          {richBackground ? (
            <BrandBackgroundPaintEditor
              label="Background paint"
              value={composition.backgroundPaint ?? composition.backgroundColor}
              onChange={(paint) => backgroundChange(() => updateCompositionBackgroundPaint(paint))}
            />
          ) : (
            <>
              <fieldset className="inspector-inherited-fields">
                <PropertyRow
                  help={
                    'Export the canvas background with transparency so the graphic can be placed over video. The checkerboard is only an editor preview.'
                  }
                  className="inspector-row"
                >
                  <span>Transparent output</span>
                  <TemplateSettingValue setting="backgroundColor">
                    <WithWarning message={backgroundWarning?.message}>
                      <input
                        type="checkbox"
                        checked={isTransparent}
                        onChange={(e) =>
                          updateCanvas({
                            backgroundColor: e.target.checked ? 'transparent' : '#000000',
                          })
                        }
                      />
                    </WithWarning>
                  </TemplateSettingValue>
                </PropertyRow>
                <PropertyRow
                  help={
                    'Background color of the output canvas. Choosing a color switches the composition from transparent to opaque output.'
                  }
                  className="inspector-row inspector-background-color"
                >
                  <span>Color</span>
                  <TemplateSettingValue setting="backgroundColor">
                    <ColorInput
                      label="Canvas background color"
                      value={
                        composition.backgroundColor === 'transparent'
                          ? pickerColor
                          : composition.backgroundColor
                      }
                      onChange={(color) => updateCanvas({ backgroundColor: color })}
                    />
                  </TemplateSettingValue>
                </PropertyRow>
                {isTransparent && (
                  <p className="inspector-hint">
                    The checkerboard is editor-only and will not be exported. Choosing a color
                    switches to an opaque background.
                  </p>
                )}
              </fieldset>
              <button
                type="button"
                className="inspector-rich-background-button"
                onClick={() =>
                  backgroundChange(() =>
                    updateCompositionBackgroundPaint(composition.backgroundColor),
                  )
                }
              >
                Use gradient, shader or media paint…
              </button>
            </>
          )}
          {richBackground && (
            <p className="inspector-hint">
              This is the exported canvas background. Preview backgrounds are controlled in Playout
              Controls and are not exported.
            </p>
          )}
        </CollapsibleSection>
      )}

      {showSection('canvas') && (
        <CollapsibleSection sectionId={sectionId('canvas-layout')} title="Canvas layout">
          {(
            [
              ['showRulers', 'Rulers'],
              ['showActionSafe', 'Action safe · EBU R 95 (3.5%)'],
              ['showTitleSafe', 'Title safe · EBU R 95 (5%)'],
              ['showCenterMarker', 'Center marker'],
              ['dimOutsideCanvas', 'Outside canvas · 20% gray'],
              ['snappingEnabled', 'Snapping'],
              ['snapToGrid', 'Snap to grid'],
              ['snapToGuides', 'Snap to guides'],
              ['snapToLayers', 'Snap to layers'],
            ] as const
          ).map(([key, label]) => (
            <PropertyRow
              help={CANVAS_LAYOUT_HELP[key]}
              className="inspector-row inspector-checkbox-row"
              key={key}
            >
              <span>{label}</span>
              <TemplateSettingValue setting={`layout.${key}`}>
                <input
                  type="checkbox"
                  checked={composition.layout[key]}
                  onChange={(event) => updateInheritedLayout({ [key]: event.target.checked })}
                />
              </TemplateSettingValue>
            </PropertyRow>
          ))}
          <div className="inspector-presentation-background-controls">
            <p className="inspector-hint">
              The preview background is shared by the whole output. Choose its image, video or
              webcam in Playout Controls.
            </p>
            <button
              type="button"
              onClick={() => usePaneRequestStore.getState().reveal('playout-controls')}
            >
              Open Playout Controls
            </button>
          </div>
          <div className="inspector-grid">
            <PropertyRow
              help={
                'Grid spacing in composition pixels. Snap to grid uses this interval when snapping is enabled.'
              }
              className="inspector-row"
            >
              <span>Grid</span>
              <TemplateSettingValue setting="layout.gridSize">
                <input
                  type="number"
                  min={1}
                  value={composition.layout.gridSize}
                  onChange={(event) =>
                    updateInheritedLayout({ gridSize: Number(event.target.value) })
                  }
                />
              </TemplateSettingValue>
            </PropertyRow>
            <PropertyRow
              help={
                'Maximum distance in composition pixels at which a nearby snapping target attracts a layer. Larger values make snapping easier to trigger.'
              }
              className="inspector-row"
            >
              <span>Threshold</span>
              <TemplateSettingValue setting="layout.snapThreshold">
                <input
                  type="number"
                  min={0}
                  value={composition.layout.snapThreshold}
                  onChange={(event) =>
                    updateInheritedLayout({ snapThreshold: Number(event.target.value) })
                  }
                />
              </TemplateSettingValue>
            </PropertyRow>
          </div>
          <PropertyRow
            help={
              'Choose whether editing may move layers outside the canvas or should keep them contained within its bounds.'
            }
            className="inspector-row"
          >
            <span>Bounds</span>
            <TemplateSettingValue setting="layout.boundsMode">
              <select
                value={composition.layout.boundsMode}
                onChange={(event) =>
                  updateInheritedLayout({ boundsMode: event.target.value as 'allow' | 'contain' })
                }
              >
                <option value="allow">Allow outside</option>
                <option value="contain">Contain in canvas</option>
              </select>
            </TemplateSettingValue>
          </PropertyRow>
          <PropertyRow
            help={
              'Choose whether the editor shows objects outside the canvas or clips them at its edge. The exported output still uses the composition dimensions.'
            }
            className="inspector-row"
          >
            <span>Overflow preview</span>
            <TemplateSettingValue setting="layout.overflowPreview">
              <select
                value={composition.layout.overflowPreview}
                onChange={(event) =>
                  updateInheritedLayout({
                    overflowPreview: event.target.value as 'visible' | 'clip',
                  })
                }
              >
                <option value="visible">Show pasteboard objects</option>
                <option value="clip">Clip to canvas</option>
              </select>
            </TemplateSettingValue>
          </PropertyRow>
        </CollapsibleSection>
      )}

      {showSection('guides') && (
        <CollapsibleSection
          sectionId={sectionId('guides')}
          title="Guides"
          actions={
            <>
              <button type="button" onClick={() => addGuide('vertical')}>
                + Vertical
              </button>
              <button type="button" onClick={() => addGuide('horizontal')}>
                + Horizontal
              </button>
            </>
          }
        >
          {composition.layout.guides.map((guide) => (
            <PropertyRow
              help={`Position of this ${guide.axis} guide in canvas pixels, measured from the ${guide.axis === 'vertical' ? 'left' : 'top'} edge. Guides are editor-only alignment and snapping aids.`}
              className="inspector-row"
              key={guide.id}
            >
              <span>{guide.axis === 'vertical' ? 'V' : 'H'}</span>
              <input
                type="number"
                value={guide.position}
                onChange={(event) => updateGuide(guide.id, Number(event.target.value))}
              />
              <button type="button" title="Remove guide" onClick={() => removeGuide(guide.id)}>
                ×
              </button>
            </PropertyRow>
          ))}
        </CollapsibleSection>
      )}
    </div>
  );
}
