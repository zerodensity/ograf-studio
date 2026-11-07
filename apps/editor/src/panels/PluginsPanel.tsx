import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isRendererPluginSnapshot,
  rendererPluginKey,
  studioPluginReference,
  type ChartPreset,
} from '@ograf-editor/scene-model';
import { PluginCard } from '../components/PluginCard';
import { PluginTemplateWorkspace } from '../components/PluginTemplateGallery';
import { requiredProjectStudioPlugins } from '../components/configurationPlugins';
import { useDockPaneVisible } from '../layout/PaneVisibilityContext';
import { useConfigurationRequestStore } from '../state/configurationRequestStore';
import { runDiscreteHistoryStep } from '../state/historyStore';
import { studioPluginAllowed, useRendererPluginSettingsStore } from '../state/pluginSettingsStore';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useSelectionStore } from '../state/selectionStore';
import { canvasFrame } from '../state/canvasViewStore';
import { canvasInsertion } from '../canvas/canvasInsertion';
import { AnimationPresetGallery } from './AnimationPresetGallery';
import { ChartPresetGallery } from './ChartPresetGallery';
import { ShaderPackGallery } from './ShaderPackGallery';
import {
  PLUGIN_CATEGORIES,
  pluginGroupsForCategory,
  pluginPanelGroups,
  pluginPanelVersion,
  requestedPluginGroup,
} from './pluginPanelSelection';
import './PluginsPanel.css';

const keepPaneOpen = () => {};

export function PluginsPanel() {
  const visible = useDockPaneVisible();
  const settings = useRendererPluginSettingsStore();
  const initialize = settings.initialize;
  const project = useProjectStore((state) => state.project);
  const composition = useActiveComposition();
  const layerIds = useSelectionStore((state) => state.selectedLayerIds);
  const request = useConfigurationRequestStore();
  const required = useMemo(() => requiredProjectStudioPlugins(project), [project]);
  const groups = useMemo(
    () => pluginPanelGroups(settings.installed, required, settings.defaultProvider),
    [settings.installed, required, settings.defaultProvider],
  );
  const [selectedKey, setSelectedKey] = useState('');
  const [category, setCategory] = useState(request.category);
  const [versions, setVersions] = useState<Record<string, string>>(request.versionKeys);
  const [templateQuery, setTemplateQuery] = useState('');
  const [error, setError] = useState('');
  const handledRequest = useRef(0);
  const categoryGroups = pluginGroupsForCategory(groups, category);
  const requested = requestedPluginGroup(categoryGroups, request.selection);
  const selected =
    categoryGroups.find((group) => group.key === selectedKey) ?? requested ?? categoryGroups[0];
  const entry = selected ? pluginPanelVersion(selected, versions[selected.key]) : undefined;
  const snapshot = entry?.snapshot;
  const reference = snapshot ? studioPluginReference(snapshot) : undefined;
  const versionKey = reference ? rendererPluginKey(reference) : '';
  const allowed = Boolean(
    entry?.enabled && entry.trusted && snapshot && studioPluginAllowed(snapshot),
  );
  const categoryLabel = PLUGIN_CATEGORIES.find((item) => item.kind === category)!.label;

  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    if (!request.requestId || request.requestId === handledRequest.current) return;
    handledRequest.current = request.requestId;
    const chosen = requestedPluginGroup(groups, request.selection);
    setCategory(chosen?.kind ?? request.category);
    if (chosen) setSelectedKey(chosen.key);
    if (request.view === 'settings') {
      useConfigurationRequestStore.getState().openSettings(chosen?.id, chosen?.kind);
    }
    setTemplateQuery('');
    setError('');
  }, [groups, request.requestId, request.selection, request.view, request.category]);

  const chooseCategory = (kind: typeof category) => {
    const first = pluginGroupsForCategory(groups, kind)[0];
    setCategory(kind);
    setSelectedKey(first?.key ?? '');
    setTemplateQuery('');
    setError('');
    useConfigurationRequestStore.setState({
      category: kind,
      selection: first ? { id: first.id, kind: first.kind } : null,
      view: 'templates',
    });
  };

  const chooseVersion = (key: string) => {
    const chosen =
      useRendererPluginSettingsStore
        .getState()
        .installed.find(
          (candidate) => rendererPluginKey(studioPluginReference(candidate.snapshot)) === key,
        )?.snapshot ??
      required.find((candidate) => rendererPluginKey(studioPluginReference(candidate)) === key);
    if (!chosen) return;
    const groupKey = `${chosen.manifest.id}:${chosen.manifest.kind}`;
    setCategory(chosen.manifest.kind);
    setTemplateQuery('');
    setSelectedKey(groupKey);
    setVersions((current) => ({ ...current, [groupKey]: key }));
    useConfigurationRequestStore.setState((current) => ({
      selection: { id: chosen.manifest.id, kind: chosen.manifest.kind },
      category: chosen.manifest.kind,
      versionKeys: { ...current.versionKeys, [groupKey]: key },
    }));
    setError('');
  };
  const createChart = (preset: ChartPreset) => {
    if (!snapshot || !isRendererPluginSnapshot(snapshot) || !allowed || !reference) return;
    try {
      const state = useProjectStore.getState();
      if (state.activeCompositionId !== composition.id)
        throw new Error('The active composition changed. Choose the chart template again.');
      const id = runDiscreteHistoryStep(
        () =>
          state.addChartLayer(
            preset,
            reference,
            canvasInsertion(
              globalThis.document.querySelector('.canvas-stage'),
              composition,
              'chart',
              useSelectionStore.getState().selectedLayerIds,
              canvasFrame(composition),
            ),
          ),
        `Add ${snapshot.manifest.name} chart`,
      );
      useSelectionStore.getState().select(id);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const templatesAvailable = Boolean(selected && snapshot && reference && allowed);
  const pluginHeader = (
    <section className="plugins-panel-category" aria-label={`${categoryLabel} plugins`}>
      <header className="plugins-panel-category-header">
        <strong>{categoryLabel}</strong>
      </header>
      <nav aria-label="Installed plugins" className="plugins-panel-list">
        {categoryGroups.map((group) => (
          <PluginCard
            key={group.key}
            group={group}
            selected={selected?.key === group.key}
            versionKey={versions[group.key]}
            onSelectVersion={chooseVersion}
            onManage={() => {
              setSelectedKey(group.key);
              setTemplateQuery('');
              const chosen = pluginPanelVersion(group, versions[group.key]);
              useConfigurationRequestStore
                .getState()
                .openSettings(
                  group.id,
                  group.kind,
                  rendererPluginKey(studioPluginReference(chosen.snapshot)),
                );
            }}
            onSelect={() => {
              setSelectedKey(group.key);
              setTemplateQuery('');
              const chosen = pluginPanelVersion(group, versions[group.key]);
              useConfigurationRequestStore.setState({
                selection: { id: group.id, kind: group.kind },
                category: group.kind,
                view: 'templates',
              });
              if (!chosen.enabled || !chosen.trusted) {
                useConfigurationRequestStore
                  .getState()
                  .openSettings(
                    group.id,
                    group.kind,
                    rendererPluginKey(studioPluginReference(chosen.snapshot)),
                  );
              }
              setError('');
            }}
          />
        ))}
        {!categoryGroups.length ? (
          <p className="plugins-panel-hint">
            {settings.loading
              ? 'Loading plugins…'
              : `No ${categoryLabel.toLocaleLowerCase()} plugins installed.`}
          </p>
        ) : null}
      </nav>
    </section>
  );
  const browserHeader = (
    <>
      {pluginHeader}
      <header className="plugins-panel-detail-header">
        <input
          className="plugins-panel-template-search"
          type="search"
          aria-label="Find plugin template"
          placeholder="Find template…"
          value={templateQuery}
          onChange={(event) => setTemplateQuery(event.target.value)}
        />
      </header>
    </>
  );

  return (
    <section className="plugins-panel" aria-label="Plugins browser">
      <aside className="plugins-panel-sidebar">
        <div className="plugins-panel-list-header">
          <strong>Categories</strong>
        </div>
        <nav aria-label="Plugin categories" className="plugins-panel-categories">
          {PLUGIN_CATEGORIES.map((item) => (
            <button
              type="button"
              key={item.kind}
              aria-pressed={category === item.kind}
              onClick={() => chooseCategory(item.kind)}
            >
              <span>{item.label}</span>
              <small aria-hidden="true">{pluginGroupsForCategory(groups, item.kind).length}</small>
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="plugins-panel-add"
          onClick={() =>
            useConfigurationRequestStore
              .getState()
              .openSettings(undefined, undefined, undefined, true)
          }
        >
          Add plugin…
        </button>
        <button
          type="button"
          onClick={() => useConfigurationRequestStore.getState().openSettings()}
        >
          Plugin settings…
        </button>
      </aside>
      <div className="plugins-panel-main">
        {!templatesAvailable ? pluginHeader : null}
        <div className="plugins-panel-detail" aria-label="Current plugin view">
          <div
            className="plugins-panel-scroll"
            role="region"
            id="plugin-templates-content"
            aria-label="Plugin templates"
          >
            {visible && selected && snapshot && reference && allowed ? (
              snapshot.manifest.kind === 'chart' && isRendererPluginSnapshot(snapshot) ? (
                <PluginTemplateWorkspace
                  browserHeader={browserHeader}
                  gallery={
                    <>
                      <ChartPresetGallery
                        presets={snapshot.manifest.presets}
                        searchQuery={templateQuery}
                        onSelect={createChart}
                      />
                      <p className="plugins-panel-hint">
                        Click a chart template to add it to the current composition. Each chart
                        keeps this exact provider version.
                      </p>
                    </>
                  }
                />
              ) : snapshot.manifest.kind === 'shader-pack' ? (
                <ShaderPackGallery
                  key={versionKey}
                  embedded
                  composition={composition}
                  layerIds={layerIds}
                  initialReference={reference}
                  pluginId={selected.id}
                  searchQuery={templateQuery}
                  browserHeader={browserHeader}
                  onClose={keepPaneOpen}
                />
              ) : (
                <AnimationPresetGallery
                  key={versionKey}
                  embedded
                  composition={composition}
                  layerIds={layerIds}
                  initialReference={reference}
                  pluginId={selected.id}
                  searchQuery={templateQuery}
                  browserHeader={browserHeader}
                  onClose={keepPaneOpen}
                />
              )
            ) : visible ? (
              <p className="plugins-panel-hint">
                {selected
                  ? 'Review and enable this version in Studio preferences to use its templates.'
                  : 'Install a plugin to browse its templates.'}
                <button
                  type="button"
                  onClick={() =>
                    useConfigurationRequestStore
                      .getState()
                      .openSettings(selected?.id, selected?.kind, versionKey || undefined)
                  }
                >
                  Open plugin settings…
                </button>
              </p>
            ) : null}
            {error ? (
              <p className="plugins-panel-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
