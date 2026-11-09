import { ColorInput } from './ColorInput';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorWindow } from '../layout/EditorWindow';
import { useProjectSetStore } from '../state/projectSetStore';
import { createProjectSet, DEFAULT_PROJECT_SET_NAME } from '../state/projectSet';
import { useProjectStore } from '../state/projectStore';
import {
  useTemplateSetSettingsStore,
  saveTemplateSetSettings,
  settingsSectionForScope,
  type SettingsScope,
} from '../state/templateSetSettingsStore';
import {
  templateSetSettingsFromProject,
  templateSetSettingsErrors,
  type TemplateSetSettings,
} from '../state/templateSetSettings';
import {
  createSettingsDialogDraft,
  mergeSettingsDraft,
  rebaseSettingsDialogDraft,
} from '../state/settingsDraft';
import { COMPOSITION_PRESETS, matchesCompositionPreset } from '../panels/compositionPresets';
import { CompositionSettings } from '../panels/CompositionSettings';
import { FrameDurationControl } from '../panels/FrameDurationControl';
import { colorPickerValue } from '../canvas/compositionBackground';
import { WorkspacePreferences } from './WorkspaceDialogs';
import { ExportPreferences } from './ExportPreferences';
import { AssistantContextPreferencesPanel } from './AssistantContextPreferencesPanel';
import { NodosPreferences } from './NodosPreferences';
import { useCropToolStore } from '../state/cropToolStore';
import { useMovableDialog } from './useMovableDialog';
import { ConfigurationDialog } from './ConfigurationDialog';
import { PluginRequirementsSettings } from './PluginRequirementsSettings';
import { useConfigurationRequestStore } from '../state/configurationRequestStore';
import './TemplateSetSettingsDialog.css';

const SETTINGS_PAGES = {
  studio: [
    {
      id: 'workspace',
      label: 'Workspace & windows',
      keywords: 'startup layout dock detached presets application preview sync editor scrub frame',
    },
    {
      id: 'export',
      label: 'Export',
      keywords:
        'save defaults scope format template set coordinated standalone zip html both files',
    },
    {
      id: 'assistant',
      label: 'AI assistant',
      keywords:
        'ai assistant model context tokens conversation history paging tool results budget limits',
    },
    {
      id: 'plugins',
      label: 'Plugins',
      keywords:
        'install trust enable disable charts shaders animation packs bundled default provider',
    },
    {
      id: 'nodos',
      label: 'Nodos',
      keywords: 'nodos electronode preset node menu engine address',
    },
  ],
  'template-set': [
    {
      id: 'output',
      label: 'Output & timing',
      keywords: 'resolution size width height frame rate fps background render real-time',
    },
    { id: 'timing', label: 'Data transitions', keywords: 'fade frames interruption queue replace' },
    {
      id: 'canvas',
      label: 'Canvas & snapping',
      keywords: 'rulers safe center grid bounds overflow',
    },
    {
      id: 'inheritance',
      label: 'Template inheritance',
      keywords: 'defaults overrides shared reset',
    },
    {
      id: 'plugins',
      label: 'Plugins',
      keywords: 'required versions dependencies pinned shared charts shaders animation',
    },
  ],
  template: [
    {
      id: 'output',
      label: 'Output & timing',
      keywords: 'composition name resolution size frame rate fps render data transitions fade',
    },
    {
      id: 'background',
      label: 'Background',
      keywords: 'color alpha transparent paint brand crop gradient shader media',
    },
    {
      id: 'canvas',
      label: 'Canvas & snapping',
      keywords:
        'rulers safe center grid threshold bounds overflow presentation webcam camera image video snapping',
    },
    { id: 'guides', label: 'Guides', keywords: 'horizontal vertical positions' },
    {
      id: 'plugins',
      label: 'Plugins',
      keywords: 'required versions dependencies pinned options charts shaders animation',
    },
  ],
} as const;

export function TemplateSetSettingsDialogHost() {
  const open = useTemplateSetSettingsStore((state) => state.open);
  const set = useProjectSetStore((state) => state.projectSet);
  if (!open) return null;
  return <TemplateSetSettingsDialog key={set?.id ?? 'no-set'} />;
}

function TemplateSetSettingsDialog() {
  const { document } = useEditorWindow();
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const project = useProjectStore((state) => state.project);
  const cropping = useCropToolStore((state) => state.request !== null);
  const scope = useTemplateSetSettingsStore((state) => state.scope);
  const requestedSection = useTemplateSetSettingsStore((state) => state.section);
  const section = settingsSectionForScope(scope, requestedSection);
  const pluginRequest = useConfigurationRequestStore();
  const templateName =
    projectSet?.templates.find((template) => template.id === activeTemplateId)?.name ??
    project.name;
  const [search, setSearch] = useState('');
  const [setDraft, updateSetDraft] = useState(() =>
    createSettingsDialogDraft(
      projectSet?.settings ?? templateSetSettingsFromProject(useProjectStore.getState().project),
      Object.fromEntries(
        projectSet?.templates.map((template) => [
          template.id,
          template.inheritSettings !== false,
        ]) ?? [],
      ),
    ),
  );
  const { settings, inheritance, baselineSettings, baselineInheritance } = setDraft;
  const setSettings = (
    next: TemplateSetSettings | ((current: TemplateSetSettings) => TemplateSetSettings),
  ) =>
    updateSetDraft((current) => ({
      ...current,
      settings: typeof next === 'function' ? next(current.settings) : next,
    }));
  const setInheritance = (
    next: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>),
  ) =>
    updateSetDraft((current) => ({
      ...current,
      inheritance: typeof next === 'function' ? next(current.inheritance) : next,
    }));
  useEffect(() => {
    if (!projectSet) return;
    const liveInheritance = Object.fromEntries(
      projectSet.templates.map((template) => [template.id, template.inheritSettings !== false]),
    );
    updateSetDraft((current) =>
      rebaseSettingsDialogDraft(
        current,
        projectSet.settings ?? current.baselineSettings,
        liveInheritance,
      ),
    );
  }, [projectSet]);
  const pendingSetChanges =
    JSON.stringify(settings) !== JSON.stringify(baselineSettings) ||
    Object.entries(inheritance).some(([id, inherit]) => baselineInheritance[id] !== inherit);
  const inheritingTemplates =
    projectSet?.templates.filter(
      (template) => (inheritance[template.id] ?? template.inheritSettings) !== false,
    ) ?? [];
  const preservedOverrides = inheritingTemplates.reduce(
    (count, template) => count + (template.settingsOverrides?.length ?? 0),
    0,
  );
  const scopeLabel =
    scope === 'studio'
      ? 'OGraf Studio · Preferences for this user'
      : scope === 'template-set'
        ? `Template Set · ${projectSet?.name ?? 'No template set open'}`
        : `Template · ${templateName}`;
  const query = search.trim().toLocaleLowerCase();
  const navigation = (Object.keys(SETTINGS_PAGES) as SettingsScope[])
    .map((itemScope) => {
      const label =
        itemScope === 'studio'
          ? 'OGraf Studio'
          : itemScope === 'template-set'
            ? 'Template Set'
            : 'Template';
      const name =
        itemScope === 'studio'
          ? 'Application preferences'
          : itemScope === 'template-set'
            ? (projectSet?.name ?? 'No set open')
            : templateName;
      const matchScope = `${label} ${name}`.toLocaleLowerCase().includes(query);
      return {
        scope: itemScope,
        label,
        name,
        pages: SETTINGS_PAGES[itemScope].filter(
          (page) =>
            matchScope || `${page.label} ${page.keywords}`.toLocaleLowerCase().includes(query),
        ),
      };
    })
    .filter((group) => group.pages.length > 0);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const movable = useMovableDialog(dialog, { enabled: !cropping });
  const close = () => useTemplateSetSettingsStore.getState().close();
  useEffect(() => {
    if (cropping) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, [document, cropping]);
  const update = (patch: Partial<TemplateSetSettings>) =>
    setSettings((current) => ({ ...current, ...patch }));
  const updateLayout = (patch: Partial<TemplateSetSettings['layout']>) =>
    setSettings((current) => ({ ...current, layout: { ...current.layout, ...patch } }));
  const preset = COMPOSITION_PRESETS.findIndex((candidate) =>
    matchesCompositionPreset(candidate, settings.width, settings.height, settings.frameRate),
  );
  const apply = (andClose: boolean) => {
    try {
      const latestSet = useProjectSetStore.getState().projectSet;
      if (!latestSet) throw new Error('Create or open a template set first.');
      const merged = mergeSettingsDraft(
        latestSet.settings ?? baselineSettings,
        baselineSettings,
        settings,
      );
      const errors = templateSetSettingsErrors(merged);
      if (errors.length) throw new Error(errors.join(' '));
      const changedInheritance = Object.fromEntries(
        Object.entries(inheritance).filter(([id, inherit]) => baselineInheritance[id] !== inherit),
      );
      saveTemplateSetSettings(merged, changedInheritance);
      const saved = useProjectSetStore.getState().projectSet!;
      const savedInheritance = Object.fromEntries(
        saved.templates.map((template) => [template.id, template.inheritSettings !== false]),
      );
      updateSetDraft(createSettingsDialogDraft(merged, savedInheritance));
      setError('');
      if (andClose) close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply settings.');
    }
  };
  // Canvas tools need pointer access to the stage. Keep the dialog and its set
  // draft mounted, then reveal them again after the crop is applied or cancelled.
  if (cropping) return null;
  return createPortal(
    <div className="template-settings-backdrop">
      <section
        ref={dialog}
        {...movable.dialogProps}
        className="template-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-settings-title"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
              ) ?? []),
            ].filter((element) => element.getClientRects().length > 0);
            const index = controls.indexOf(document.activeElement as HTMLElement);
            if (
              (event.shiftKey && index <= 0) ||
              (!event.shiftKey && index === controls.length - 1)
            ) {
              event.preventDefault();
              (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
            }
          }
        }}
      >
        <header {...movable.handleProps}>
          <div>
            <h2 id="template-settings-title">Settings &amp; Preferences</h2>
            <p className="template-settings-scope-label">{scopeLabel}</p>
          </div>
          <button type="button" aria-label="Close settings" onClick={close}>
            ×
          </button>
        </header>
        {!projectSet && scope === 'template-set' ? (
          <div className="template-settings-create-set">
            <button
              type="button"
              onClick={() => {
                const created = createProjectSet(
                  DEFAULT_PROJECT_SET_NAME,
                  useProjectStore.getState().project,
                );
                useProjectSetStore.getState().setProjectSet(created);
                useProjectSetStore.getState().setActiveTemplateId(created.templates[0]!.id);
              }}
            >
              New Template Set
            </button>
            <span>Use the current template as the first template in a set.</span>
          </div>
        ) : null}
        <div className="template-settings-body">
          <nav aria-label="Settings categories">
            <input
              type="search"
              aria-label="Search settings"
              placeholder="Search settings…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {navigation.map(({ scope: itemScope, label, name, pages: matchingPages }) => {
              return (
                <section
                  key={itemScope}
                  className="template-settings-scope"
                  aria-label={`${label} settings`}
                >
                  <button
                    type="button"
                    className="template-settings-scope-root"
                    onClick={() =>
                      useTemplateSetSettingsStore.getState().show(itemScope, matchingPages[0]!.id)
                    }
                  >
                    <span>
                      {label}
                      {itemScope === 'template-set' && pendingSetChanges ? ' •' : ''}
                    </span>
                    <small title={name}>{name}</small>
                  </button>
                  <div className="template-settings-scope-pages">
                    {matchingPages.map((page) => (
                      <button
                        key={page.id}
                        type="button"
                        aria-current={
                          scope === itemScope && section === page.id ? 'page' : undefined
                        }
                        onClick={() =>
                          useTemplateSetSettingsStore.getState().show(itemScope, page.id)
                        }
                      >
                        {page.label}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            {query && !navigation.length ? (
              <p className="template-settings-no-results">No matching categories.</p>
            ) : null}
          </nav>
          <fieldset
            disabled={scope === 'template-set' && !projectSet}
            className={`template-settings-content${scope === 'template' ? ' template-settings-content--template' : ''}${section === 'plugins' ? ' template-settings-content--plugins' : ''}`}
          >
            {scope === 'studio' && section === 'workspace' ? <WorkspacePreferences /> : null}
            {scope === 'studio' && section === 'export' ? <ExportPreferences /> : null}
            {scope === 'studio' && section === 'assistant' ? (
              <AssistantContextPreferencesPanel />
            ) : null}
            {scope === 'studio' && section === 'nodos' ? <NodosPreferences /> : null}
            {scope === 'studio' && section === 'plugins' ? (
              <ConfigurationDialog
                key={pluginRequest.settingsRequestId}
                embedded
                showAll
                selectedPlugin={
                  pluginRequest.settingsSelection?.kind
                    ? {
                        id: pluginRequest.settingsSelection.id,
                        kind: pluginRequest.settingsSelection.kind,
                      }
                    : undefined
                }
                selectedVersionKey={pluginRequest.settingsVersionKey}
                addRequestId={pluginRequest.settingsAddRequestId}
              />
            ) : null}
            {scope !== 'studio' && section === 'plugins' ? (
              <PluginRequirementsSettings scope={scope} />
            ) : null}
            {scope === 'template' && section !== 'plugins' ? (
              <CompositionSettings
                filter=""
                onFilterChange={() => {}}
                mode="settings"
                section={section as 'output' | 'background' | 'canvas' | 'guides'}
              />
            ) : null}
            {scope === 'template-set' && projectSet && section !== 'plugins' && (
              <p className="template-settings-impact" role="status">
                Shared defaults apply to {inheritingTemplates.length}{' '}
                {inheritingTemplates.length === 1 ? 'template' : 'templates'}.
                {preservedOverrides > 0
                  ? ` ${preservedOverrides} local property ${preservedOverrides === 1 ? 'override is' : 'overrides are'} preserved.`
                  : ' Local overrides stay unchanged.'}
                {pendingSetChanges ? ' Changes are pending until Apply.' : ''}
              </p>
            )}
            {scope === 'template-set' && section === 'output' ? (
              <>
                <h3>Output defaults</h3>
                <p>
                  Applied to the main composition of every inheriting template, including new and
                  inserted templates.
                </p>
                <label>
                  Preset
                  <select
                    value={preset}
                    onChange={(event) => {
                      const chosen = COMPOSITION_PRESETS[Number(event.target.value)];
                      if (chosen)
                        update({
                          width: chosen.width,
                          height: chosen.height,
                          frameRate: chosen.frameRate,
                        });
                    }}
                  >
                    <option value={-1}>Custom</option>
                    {COMPOSITION_PRESETS.map((item, index) => (
                      <option key={item.label} value={index}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="template-settings-grid">
                  {(['width', 'height', 'frameRate'] as const).map((key) => (
                    <label key={key}>
                      {
                        {
                          width: 'Width (px)',
                          height: 'Height (px)',
                          frameRate: 'Frame rate (fps)',
                        }[key]
                      }
                      <input
                        type="number"
                        min={1}
                        step={key === 'frameRate' ? 0.001 : 1}
                        value={settings[key]}
                        onChange={(event) => update({ [key]: Number(event.target.value) })}
                      />
                    </label>
                  ))}
                </div>
                <label className="template-settings-check">
                  <input
                    type="checkbox"
                    checked={settings.backgroundColor === 'transparent'}
                    onChange={(event) =>
                      update({
                        backgroundColor: event.target.checked ? 'transparent' : '#000000',
                      })
                    }
                  />
                  Transparent background
                </label>
                <label>
                  Background color
                  <ColorInput
                    label="Template set background color"
                    value={
                      settings.backgroundColor === 'transparent'
                        ? colorPickerValue(settings.backgroundColor)
                        : settings.backgroundColor
                    }
                    onChange={(color) => update({ backgroundColor: color })}
                  />
                </label>
                <h3>Render modes</h3>
                <label className="template-settings-check">
                  <input
                    type="checkbox"
                    checked={settings.supportsRealTime}
                    onChange={(event) => update({ supportsRealTime: event.target.checked })}
                  />
                  Real-time playback
                </label>
                <label className="template-settings-check">
                  <input
                    type="checkbox"
                    checked={settings.supportsNonRealTime}
                    onChange={(event) => update({ supportsNonRealTime: event.target.checked })}
                  />
                  Non-real-time rendering
                </label>
                <p>
                  Templates containing media or audio remain real-time-only. Canvas resizing uses
                  each layer's layout constraints.
                </p>
              </>
            ) : null}
            {scope === 'template-set' && section === 'timing' ? (
              <>
                <h3>Data transitions</h3>
                <FrameDurationControl
                  label="Update animation"
                  frames={settings.updateTransitionFrames}
                  frameRate={settings.frameRate}
                  minFrames={0}
                  onChange={(frames) => update({ updateTransitionFrames: frames })}
                />
                <label>
                  When new data arrives during a fade
                  <select
                    value={settings.updateInterruption}
                    onChange={(event) =>
                      update({ updateInterruption: event.target.value as 'queue' | 'replace' })
                    }
                  >
                    <option value="queue">Finish current fade first</option>
                    <option value="replace">Jump to newest data</option>
                  </select>
                </label>
                <p>
                  Changing frame rate keeps animation keyframes at their authored frame numbers.
                </p>
              </>
            ) : null}
            {scope === 'template-set' && section === 'canvas' ? (
              <>
                <h3>Canvas display</h3>
                {(
                  [
                    ['showRulers', 'Rulers'],
                    ['showActionSafe', 'Action safe area'],
                    ['showTitleSafe', 'Title safe area'],
                    ['showCenterMarker', 'Center marker'],
                    ['dimOutsideCanvas', 'Dim outside canvas'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="template-settings-check" key={key}>
                    <input
                      type="checkbox"
                      checked={settings.layout[key]}
                      onChange={(event) => updateLayout({ [key]: event.target.checked })}
                    />
                    {label}
                  </label>
                ))}
                <h3>Snapping</h3>
                {(
                  [
                    ['snappingEnabled', 'Enable snapping'],
                    ['snapToGrid', 'Snap to grid'],
                    ['snapToGuides', 'Snap to guides'],
                    ['snapToLayers', 'Snap to layers'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="template-settings-check" key={key}>
                    <input
                      type="checkbox"
                      checked={settings.layout[key]}
                      onChange={(event) => updateLayout({ [key]: event.target.checked })}
                    />
                    {label}
                  </label>
                ))}
                <div className="template-settings-grid">
                  <label>
                    Grid size (px)
                    <input
                      type="number"
                      min={1}
                      value={settings.layout.gridSize}
                      onChange={(event) => updateLayout({ gridSize: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    Snap distance (px)
                    <input
                      type="number"
                      min={0}
                      value={settings.layout.snapThreshold}
                      onChange={(event) =>
                        updateLayout({ snapThreshold: Number(event.target.value) })
                      }
                    />
                  </label>
                </div>
                <label>
                  Canvas bounds
                  <select
                    value={settings.layout.boundsMode}
                    onChange={(event) =>
                      updateLayout({ boundsMode: event.target.value as 'allow' | 'contain' })
                    }
                  >
                    <option value="allow">Allow layers outside canvas</option>
                    <option value="contain">Keep layers inside canvas</option>
                  </select>
                </label>
                <label>
                  Overflow preview
                  <select
                    value={settings.layout.overflowPreview}
                    onChange={(event) =>
                      updateLayout({
                        overflowPreview: event.target.value as 'visible' | 'clip',
                      })
                    }
                  >
                    <option value="visible">Show content outside canvas</option>
                    <option value="clip">Clip to canvas</option>
                  </select>
                </label>
                <p>Each template keeps its own guides and timeline folders.</p>
              </>
            ) : null}
            {scope === 'template-set' && section === 'inheritance' ? (
              <>
                <h3>Template inheritance</h3>
                <p>
                  Checked templates follow these set defaults. Uncheck a template to keep custom
                  settings. New templates inherit by default. Individual property overrides remain
                  local until their Reset control is used in Template Settings or Properties.
                </p>
                <div className="template-settings-template-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setInheritance(
                        Object.fromEntries(
                          projectSet!.templates.map((template) => [template.id, true]),
                        ),
                      )
                    }
                  >
                    Enable inheritance for all templates
                  </button>
                </div>
                {projectSet?.templates.map((template) => (
                  <label className="template-settings-check" key={template.id}>
                    <input
                      type="checkbox"
                      checked={inheritance[template.id] ?? true}
                      onChange={(event) =>
                        setInheritance((current) => ({
                          ...current,
                          [template.id]: event.target.checked,
                        }))
                      }
                    />
                    {template.name}
                    <small>
                      {inheritance[template.id] !== false
                        ? `Uses set defaults${template.settingsOverrides?.length ? ` · ${template.settingsOverrides.length} overrides` : ''}`
                        : 'Custom settings'}
                    </small>
                  </label>
                ))}
              </>
            ) : null}
          </fieldset>
        </div>
        {error ? (
          <p role="alert" className="template-settings-error">
            {error}
          </p>
        ) : null}
        <footer>
          <span>
            {scope !== 'studio' && section === 'plugins'
              ? 'Plugin versions and object options are saved in this document. Studio manages installation and execution preferences.'
              : scope === 'studio'
                ? section === 'plugins'
                  ? 'Plugin preferences apply to this Studio user and are saved automatically.'
                  : section === 'nodos'
                    ? 'Nodos preferences apply to this browser and are saved automatically.'
                    : section === 'assistant'
                      ? 'AI assistant preferences apply to this Studio user and are saved automatically.'
                      : section === 'export'
                        ? 'Export preferences apply to this Studio user and are saved automatically.'
                        : 'Workspace preferences are saved automatically.'
                : scope === 'template'
                  ? 'Changes apply immediately. Save the template or set to keep them.'
                  : 'Apply updates the open set. Save the .ogs file to keep changes.'}
            {scope !== 'template-set' && pendingSetChanges ? (
              <small>Template Set changes are pending until Apply.</small>
            ) : null}
          </span>
          {scope !== 'template-set' || section === 'plugins' ? (
            <>
              {pendingSetChanges && projectSet ? (
                <button type="button" onClick={() => apply(false)}>
                  Apply set changes
                </button>
              ) : null}
              <button type="button" onClick={close}>
                Close
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button type="button" disabled={!projectSet} onClick={() => apply(false)}>
                Apply
              </button>
              <button type="button" disabled={!projectSet} onClick={() => apply(true)}>
                OK
              </button>
            </>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
