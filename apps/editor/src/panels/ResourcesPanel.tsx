import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  findAssetConsumers,
  findMissingAssetReferences,
  isSafePackagePath,
  type Asset,
  type Composition,
  type MediaCue,
} from '@ograf-editor/scene-model';
import { getActiveComposition, useActiveComposition, useProjectStore } from '../state/projectStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { createSharedAssetScope } from '../state/sharedResourceUsage';
import { useSelectionStore } from '../state/selectionStore';
import { useSoundEventSelectionStore } from '../state/soundEventSelectionStore';
import { isSoundEventCue, soundEventSource } from '../state/soundEvents';
import { ResourceTreeBranch, ResourceTreeItem } from './ResourceTreeComponents';
import { Panel } from './Panel';
import { PatternResources } from './PatternResources';
import { MediaCueEditor } from './MediaCueEditor';
import { SelectedLiveInputControls } from './SelectedLiveInputControls';
import { SoundEventEditor } from './SoundEventEditor';
import { ShaderResources } from './ShaderResources';
import { SharedResourcesPanel } from './SharedResourcesPanel';
import { openComponentEditor } from './ComponentEditorDialog';
import { partitionResourceAssets } from './resourceTree';
import './ResourcesPanel.css';
import { useImagePlacement } from '../state/useImagePlacement';
import { prepareEditableSvg } from '../state/svgRasterFallback';
import { buildFigmaPluginPackage } from '../state/figmaPluginPackage';
import { runDiscreteHistoryStep } from '../state/historyStore';
import {
  AUDIO_FILE_ACCEPT,
  MEDIA_FILE_ACCEPT,
  audioFileBatchImportError,
  mediaFileBatchImportError,
  type MediaImportStatus,
} from './mediaFileImport';

const formatBytes = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function mediaCueTriggerLabel(cue: MediaCue, composition: Composition) {
  const trigger = cue.trigger;
  if (trigger.type === 'lifecycle') {
    const keyframe = composition.keyframes.find((candidate) => candidate.id === trigger.keyframeId);
    return `Keyframe: ${keyframe?.name ?? 'Missing'}`;
  }
  if (trigger.type === 'timeline') return `Frame ${trigger.startFrame}`;
  if (trigger.type === 'customAction') return `Action: ${trigger.actionId}`;
  return 'Manual';
}

export function ResourcesPanel() {
  const imagePlacement = useImagePlacement();
  const composition = useActiveComposition();
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const [scope, setScope] = useState<'template' | 'set'>('template');
  const importAsset = useProjectStore((s) => s.importAsset);
  const importSvgBundle = useProjectStore((s) => s.importSvgBundle);
  const updateAsset = useProjectStore((s) => s.updateAsset);
  const removeAsset = useProjectStore((s) => s.removeAsset);
  const addMediaCueFromAsset = useProjectStore((s) => s.addMediaCueFromAsset);
  const addSoundEventFromAsset = useProjectStore((s) => s.addSoundEventFromAsset);
  const addLiveMediaCue = useProjectStore((s) => s.addLiveMediaCue);
  const createComponent = useProjectStore((s) => s.createComponent);
  const instantiateComponent = useProjectStore((s) => s.instantiateComponent);
  const updateComponentFromLayers = useProjectStore((s) => s.updateComponentFromLayers);
  const renameComponent = useProjectStore((s) => s.renameComponent);
  const removeComponent = useProjectStore((s) => s.removeComponent);
  const selectedLayerIds = useSelectionStore((s) => s.selectedLayerIds);
  const selectMany = useSelectionStore((s) => s.selectMany);
  const selectSoundEvent = useSoundEventSelectionStore((s) => s.selectSoundEvent);
  const [svgImportStatus, setSvgImportStatus] = useState<string | null>(null);
  const [componentError, setComponentError] = useState('');
  const [mediaImportStatus, setMediaImportStatus] = useState<MediaImportStatus | null>(null);
  const [audioImportStatus, setAudioImportStatus] = useState<MediaImportStatus | null>(null);
  const [previewingAudioAssetId, setPreviewingAudioAssetId] = useState<string | null>(null);
  const [audioPreviewError, setAudioPreviewError] = useState<string | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editableSvgInputRef = useRef<HTMLInputElement>(null);
  const psdInputRef = useRef<HTMLInputElement>(null);
  const figmaInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const missingReferences = useMemo(() => findMissingAssetReferences(composition), [composition]);
  const assetsByKind = useMemo(
    () => partitionResourceAssets(composition.assets),
    [composition.assets],
  );
  const imageAssets = assetsByKind.images;
  const mediaAssets = assetsByKind.media;
  const audioAssets = assetsByKind.audio;
  const fontAssets = assetsByKind.fonts;
  const sourceAssets = assetsByKind.sources;
  const soundEvents = (composition.mediaCues ?? []).filter(isSoundEventCue);
  const mediaCues = (composition.mediaCues ?? []).filter((cue) => !isSoundEventCue(cue));

  const stopAudioPreview = () => {
    const audio = audioPreviewRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
      audioPreviewRef.current = null;
    }
    setPreviewingAudioAssetId(null);
  };

  const toggleAudioPreview = (asset: Asset) => {
    if (previewingAudioAssetId === asset.id) {
      stopAudioPreview();
      return;
    }
    stopAudioPreview();
    setAudioPreviewError(null);
    const audio = new Audio(asset.dataUri);
    audio.preload = 'auto';
    audio.onended = () => {
      audioPreviewRef.current = null;
      setPreviewingAudioAssetId(null);
    };
    audio.onerror = () => {
      audioPreviewRef.current = null;
      setPreviewingAudioAssetId(null);
      setAudioPreviewError(`Could not preview ${asset.name}.`);
    };
    audioPreviewRef.current = audio;
    setPreviewingAudioAssetId(asset.id);
    void audio.play().catch((cause: unknown) => {
      if (audioPreviewRef.current !== audio) return;
      audioPreviewRef.current = null;
      setPreviewingAudioAssetId(null);
      setAudioPreviewError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  useEffect(
    () => () => {
      const audio = audioPreviewRef.current;
      if (!audio) return;
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
    [],
  );

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length === 0) return;
    if (files.some((file) => file.name.toLowerCase().endsWith('.svg'))) {
      setSvgImportStatus('Importing portable SVG bundle…');
      void importSvgBundle(files)
        .then(({ warnings }) => {
          setSvgImportStatus(
            warnings.length === 0
              ? 'SVG bundle imported with all selected resources embedded.'
              : `SVG imported with ${warnings.length} unresolved companion resource${warnings.length === 1 ? '' : 's'}: ${warnings.join(' ')}`,
          );
        })
        .catch((error: unknown) => {
          setSvgImportStatus(error instanceof Error ? error.message : String(error));
        });
    } else {
      for (const file of files) {
        void importAsset(file);
      }
      setSvgImportStatus(
        `${files.length} resource${files.length === 1 ? '' : 's'} imported; identical payloads reuse one registry entry.`,
      );
    }
  };

  const handleEditableSvg = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const start = useProjectStore.getState();
    try {
      const source = await file.text();
      const current = useProjectStore.getState();
      if (
        current.project !== start.project ||
        current.activeCompositionId !== start.activeCompositionId
      )
        throw new Error('The active template changed during import. Please try again.');
      const { layers, warnings } = await prepareEditableSvg(
        source,
        getActiveComposition(current.project, current.activeCompositionId),
      );
      const afterPreparation = useProjectStore.getState();
      if (
        afterPreparation.project !== start.project ||
        afterPreparation.activeCompositionId !== start.activeCompositionId
      )
        throw new Error('The active template changed during import. Please try again.');
      const ids = runDiscreteHistoryStep(() => {
        const pasted = useProjectStore.getState().pasteLayers(layers, 0);
        pasted.forEach((id, index) =>
          useProjectStore.getState().renameLayer(id, layers[index]!.name),
        );
        return pasted;
      }, 'Import editable SVG');
      useSelectionStore.getState().selectMany(ids);
      setSvgImportStatus(
        warnings.length
          ? `Imported ${ids.length} layers. ${warnings.join(' ')}`
          : `Imported ${ids.length} editable SVG layers.`,
      );
    } catch (error) {
      setSvgImportStatus(
        `${error instanceof Error ? error.message : String(error)} You can use Import as image instead.`,
      );
    }
  };

  const handlePsd = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const start = useProjectStore.getState();
    try {
      const { preparePsd } = await import('../state/psdImport');
      const result = await preparePsd(
        file,
        getActiveComposition(start.project, start.activeCompositionId),
      );
      const current = useProjectStore.getState();
      if (
        current.project !== start.project ||
        current.activeCompositionId !== start.activeCompositionId
      )
        throw new Error('The active template changed during import. Please try again.');
      const ids = runDiscreteHistoryStep(() => {
        const pasted = useProjectStore.getState().pasteLayers(result.layers, 0);
        pasted.forEach((id, index) =>
          useProjectStore.getState().renameLayer(id, result.layers[index]!.name),
        );
        return pasted;
      }, 'Import PSD');
      useSelectionStore.getState().selectMany(ids);
      setSvgImportStatus(
        result.warnings.length
          ? `Imported ${ids.length} PSD layers. ${result.warnings.join(' ')}`
          : `Imported ${ids.length} PSD layers.`,
      );
    } catch (error) {
      setSvgImportStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleFigma = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const start = useProjectStore.getState();
    try {
      const { prepareFigma } = await import('../state/figmaImport');
      const result = await prepareFigma(
        file,
        getActiveComposition(start.project, start.activeCompositionId),
      );
      const current = useProjectStore.getState();
      if (
        current.project !== start.project ||
        current.activeCompositionId !== start.activeCompositionId
      )
        throw new Error('The active template changed during import. Please try again.');
      const ids = runDiscreteHistoryStep(() => {
        const pasted = useProjectStore.getState().pasteLayers(result.layers, 0);
        pasted.forEach((id, index) =>
          useProjectStore.getState().renameLayer(id, result.layers[index]!.name),
        );
        return pasted;
      }, 'Import Figma');
      useSelectionStore.getState().selectMany(ids);
      setSvgImportStatus(
        result.warnings.length
          ? `Imported ${ids.length} Figma layers. ${result.warnings.join(' ')}`
          : `Imported ${ids.length} Figma layers.`,
      );
    } catch (error) {
      setSvgImportStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const downloadFigmaPlugin = async () => {
    try {
      const archive = await buildFigmaPluginPackage();
      const url = URL.createObjectURL(archive);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ograf-studio-figma-plugin.zip';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setSvgImportStatus(
        'Unzip the plugin, import its manifest in Figma Development, then export your selected layers.',
      );
    } catch (error) {
      setSvgImportStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const handleMediaFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    const problem = mediaFileBatchImportError(files);
    if (problem) {
      setMediaImportStatus({ kind: 'error', message: problem });
      return;
    }
    setMediaImportStatus({ kind: 'info', message: 'Importing video clips…' });
    void Promise.all(files.map((file) => importAsset(file)))
      .then(() =>
        setMediaImportStatus({
          kind: 'info',
          message: `${files.length} media clip${files.length === 1 ? '' : 's'} imported.`,
        }),
      )
      .catch((cause: unknown) =>
        setMediaImportStatus({
          kind: 'error',
          message:
            cause instanceof Error ? cause.message : 'The media clips could not be imported.',
        }),
      );
  };

  const handleAudioFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    const problem = audioFileBatchImportError(files);
    if (problem) {
      setAudioImportStatus({ kind: 'error', message: problem });
      return;
    }
    setAudioImportStatus({ kind: 'info', message: 'Importing audio clips…' });
    void Promise.all(files.map((file) => importAsset(file)))
      .then(() =>
        setAudioImportStatus({
          kind: 'info',
          message: `${files.length} audio clip${files.length === 1 ? '' : 's'} imported.`,
        }),
      )
      .catch((cause: unknown) =>
        setAudioImportStatus({
          kind: 'error',
          message:
            cause instanceof Error ? cause.message : 'The audio clips could not be imported.',
        }),
      );
  };

  const usageCount = (asset: Asset) => {
    const consumers = findAssetConsumers(composition, asset);
    return (
      consumers.layerIds.length +
      consumers.fieldIds.length +
      consumers.fontLayerIds.length +
      consumers.mediaCueIds.length +
      (consumers.componentIds?.length ?? 0) +
      (consumers.backgroundStyleIds?.length ?? 0) +
      (consumers.typographyStyleIds?.length ?? 0) +
      Number(consumers.compositionBackground === true)
    );
  };
  const assetScope = useMemo(
    () => createSharedAssetScope(projectSet, activeTemplateId, composition.id),
    [projectSet, activeTemplateId, composition.id],
  );
  const linkedInstanceCount = (componentId: string) =>
    new Set(
      composition.layers
        .filter((layer) => layer.componentLink?.componentId === componentId)
        .map((layer) => layer.componentLink!.instanceId),
    ).size;
  const runComponent = (action: () => void) => {
    try {
      action();
      setComponentError('');
    } catch (cause) {
      setComponentError(
        cause instanceof Error ? cause.message : 'The component action could not be completed.',
      );
    }
  };

  const scopeControls = projectSet && (
    <div className="resources-scope" role="group" aria-label="Resource scope">
      <button
        type="button"
        aria-pressed={scope === 'template'}
        onClick={() => setScope('template')}
      >
        Template
      </button>
      <button type="button" aria-pressed={scope === 'set'} onClick={() => setScope('set')}>
        Template Set
      </button>
    </div>
  );
  if (scope === 'set' && projectSet) {
    return (
      <Panel title="Resources">
        <div className="resources-panel">
          {scopeControls}
          <SharedResourcesPanel />
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Resources">
      <div className="resources-panel">
        {scopeControls}
        <div className="resources-tree" role="tree" aria-label="Project resources">
          <ShaderResources />
          <PatternResources />

          <ResourceTreeBranch label="Components" count={composition.components.length}>
            <div className="resources-tree-toolbar">
              <span>Reusable components · instances inherit source edits</span>
              <button
                type="button"
                disabled={selectedLayerIds.length === 0}
                onClick={(event) =>
                  runComponent(() => {
                    const id = createComponent(selectedLayerIds);
                    if (!id)
                      throw new Error(
                        'The selection could not be saved as a component. Include its mask and motion-path sources.',
                      );
                    openComponentEditor(
                      { compositionId: composition.id, componentId: id },
                      event.currentTarget.ownerDocument,
                    );
                  })
                }
              >
                + Create Component
              </button>
            </div>
            {composition.components.length === 0 ? (
              <p className="panel-placeholder">No saved components.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {composition.components.map((component) => {
                  const linked = linkedInstanceCount(component.id);
                  return (
                    <ResourceTreeItem
                      key={component.id}
                      label={component.name}
                      meta={`${component.layers.length} source layers · ${linked} instances`}
                      badge={component.scope === 'set' ? 'Set' : undefined}
                      preview={<span className="resources-tree-item-icon">C</span>}
                    >
                      <input
                        aria-label="Component name"
                        value={component.name}
                        onChange={(event) =>
                          runComponent(() => renameComponent(component.id, event.target.value))
                        }
                      />
                      <div className="resources-tree-actions wrap">
                        <button
                          type="button"
                          onClick={() =>
                            runComponent(() =>
                              selectMany(instantiateComponent(component.id, undefined, true)),
                            )
                          }
                        >
                          Insert Instance
                        </button>
                        <button
                          type="button"
                          onClick={(event) =>
                            openComponentEditor(
                              { compositionId: composition.id, componentId: component.id },
                              event.currentTarget.ownerDocument,
                            )
                          }
                        >
                          Edit Component
                        </button>
                        <button
                          type="button"
                          disabled={linked === 0}
                          onClick={() =>
                            selectMany(
                              composition.layers
                                .filter(
                                  (layer) => layer.componentLink?.componentId === component.id,
                                )
                                .map((layer) => layer.id),
                            )
                          }
                        >
                          Select Instances
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            runComponent(() =>
                              selectMany(instantiateComponent(component.id, undefined, false)),
                            )
                          }
                        >
                          Insert Copy
                        </button>
                        <button
                          type="button"
                          disabled={selectedLayerIds.length === 0}
                          title="Update the source from the current selection. Linked instances inherit the changes."
                          onClick={() =>
                            runComponent(() => {
                              if (!updateComponentFromLayers(component.id, selectedLayerIds))
                                throw new Error(
                                  'The component could not be updated from this selection.',
                                );
                            })
                          }
                        >
                          Update from Selection
                        </button>
                        <button
                          type="button"
                          className="data-table-delete"
                          disabled={linked > 0}
                          title={
                            linked > 0
                              ? 'This source is used by instances. Make them independent before removing it.'
                              : 'Remove this component source'
                          }
                          onClick={() => runComponent(() => removeComponent(component.id))}
                        >
                          Delete
                        </button>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>
          {componentError && (
            <p className="resources-component-error" role="alert">
              {componentError}
            </p>
          )}

          <ResourceTreeBranch label="Images" count={imageAssets.length}>
            <div className="resources-tree-toolbar">
              <span>Images and SVG bundles</span>
              <button type="button" onClick={() => fileInputRef.current?.click()}>
                Import as image
              </button>
              <button type="button" onClick={() => editableSvgInputRef.current?.click()}>
                Import editable SVG
              </button>
              <button type="button" onClick={() => psdInputRef.current?.click()}>
                Import PSD
              </button>
              <button type="button" onClick={() => figmaInputRef.current?.click()}>
                Import Figma JSON
              </button>
              <input
                ref={figmaInputRef}
                type="file"
                accept=".json,application/json"
                className="resources-file-input"
                onChange={(event) => void handleFigma(event)}
              />
              <input
                ref={psdInputRef}
                type="file"
                accept=".psd,image/vnd.adobe.photoshop"
                className="resources-file-input"
                onChange={(event) => void handlePsd(event)}
              />
              <input
                ref={editableSvgInputRef}
                type="file"
                accept=".svg,image/svg+xml"
                className="resources-file-input"
                onChange={(event) => void handleEditableSvg(event)}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.css,.ttf,.otf,.woff,.woff2"
                multiple
                className="resources-file-input"
                onChange={handleFileChange}
              />
            </div>
            {imageAssets.length === 0 ? (
              <p className="panel-placeholder">No images imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {imageAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <ResourceTreeItem
                      key={asset.id}
                      label={asset.name}
                      meta={`${formatBytes(asset.byteSize)} · ${uses} uses`}
                      badge={assetScope(asset)}
                      preview={<img src={asset.dataUri} alt="" className="resources-asset-thumb" />}
                    >
                      <div className="resources-asset-fields">
                        <input
                          aria-label="Resource name"
                          value={asset.name}
                          onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                        />
                        <span className="resources-asset-meta">
                          {asset.originalFileName || asset.name} · {asset.mimeType}
                        </span>
                        <input
                          aria-label="Package path"
                          className={
                            !asset.packagePath || isSafePackagePath(asset.packagePath)
                              ? ''
                              : 'invalid'
                          }
                          placeholder={`assets/${asset.id}`}
                          value={asset.packagePath ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, {
                              packagePath: event.target.value || undefined,
                            })
                          }
                        />
                        <div className="resources-tree-actions">
                          <span>{uses} use(s)</span>
                          <button
                            type="button"
                            disabled={imagePlacement.busy}
                            onClick={() => void imagePlacement.place({ assetId: asset.id })}
                          >
                            Add to canvas
                          </button>
                          <button
                            type="button"
                            className="data-table-delete"
                            disabled={uses > 0}
                            onClick={() => removeAsset(asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
            <p className="inspector-hint">Select SVG companion files together when importing.</p>
            <p className="inspector-hint">
              Editable SVG import preserves unsupported parts as images. Text positioning is
              approximate.
            </p>
            <p className="inspector-hint">
              For Figma artwork,{' '}
              <button type="button" onClick={() => void downloadFigmaPlugin()}>
                download the Figma export plugin
              </button>
              .
            </p>
            {imagePlacement.error && (
              <p className="image-placement-error" role="alert">
                {imagePlacement.error}
              </p>
            )}
            {svgImportStatus && <p className="inspector-hint">{svgImportStatus}</p>}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Media" count={mediaAssets.length}>
            <div className="resources-tree-toolbar">
              <span>
                Playable sources · {mediaCues.length} playback cue
                {mediaCues.length === 1 ? '' : 's'}
              </span>
              <button type="button" onClick={() => mediaInputRef.current?.click()}>
                + Video
              </button>
              <input
                ref={mediaInputRef}
                type="file"
                accept={MEDIA_FILE_ACCEPT}
                multiple
                className="resources-file-input"
                onChange={handleMediaFileChange}
              />
            </div>
            {mediaImportStatus ? (
              <p
                className={
                  mediaImportStatus.kind === 'error' ? 'inspector-error' : 'inspector-hint'
                }
                role={mediaImportStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {mediaImportStatus.message}
              </p>
            ) : null}
            <SelectedLiveInputControls />
            <details className="resources-advanced-media">
              <summary>Playback cues (advanced)</summary>
              <p className="inspector-hint">
                Use cues for scheduled playback and source switching.
              </p>
              <button
                type="button"
                onClick={() => {
                  addLiveMediaCue();
                  useSelectionStore.getState().select(null);
                }}
              >
                + Live playback cue
              </button>
              {mediaCues.length > 0 ? (
                <div className="resources-media-cues" role="group" aria-label="Playback cues">
                  <span className="resources-media-cues-heading">Playback cues</span>
                  {mediaCues.map((cue) => {
                    const activeSource = cue.sources.find(
                      (source) => source.id === cue.activeSourceId,
                    );
                    return (
                      <ResourceTreeItem
                        key={cue.id}
                        label={cue.name}
                        meta={`${activeSource?.name ?? 'No source'} · ${mediaCueTriggerLabel(cue, composition)}`}
                        preview={
                          <span className="resources-tree-item-icon">
                            {activeSource?.kind === 'clip' && activeSource.mediaType === 'audio'
                              ? '♪'
                              : '▶'}
                          </span>
                        }
                      >
                        <MediaCueEditor cue={cue} />
                      </ResourceTreeItem>
                    );
                  })}
                </div>
              ) : null}
            </details>
            {mediaAssets.length === 0 ? (
              <p className="panel-placeholder">No video media imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {mediaAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <ResourceTreeItem
                      key={asset.id}
                      label={asset.name}
                      meta={`${formatBytes(asset.byteSize)} · ${uses} uses`}
                      badge={assetScope(asset)}
                      preview={
                        <video
                          src={asset.dataUri}
                          className="resources-asset-thumb resources-media-thumb"
                          muted
                          playsInline
                          preload="metadata"
                        />
                      }
                    >
                      <div className="resources-asset-fields">
                        <input
                          aria-label="Media resource name"
                          value={asset.name}
                          onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                        />
                        <span className="resources-asset-meta">
                          {asset.originalFileName || asset.name} · {asset.mimeType}
                        </span>
                        <input
                          aria-label="Media package path"
                          className={
                            !asset.packagePath || isSafePackagePath(asset.packagePath)
                              ? ''
                              : 'invalid'
                          }
                          placeholder={`assets/${asset.id}`}
                          value={asset.packagePath ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, {
                              packagePath: event.target.value || undefined,
                            })
                          }
                        />
                        <div className="resources-tree-actions">
                          <span>{uses} use(s)</span>
                          <button
                            type="button"
                            onClick={() => {
                              addMediaCueFromAsset(asset.id);
                              useSelectionStore.getState().select(null);
                            }}
                          >
                            Create Cue at Keyframe
                          </button>
                          <button
                            type="button"
                            className="data-table-delete"
                            disabled={uses > 0}
                            onClick={() => removeAsset(asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Audio" count={audioAssets.length}>
            <div className="resources-tree-toolbar">
              <span>
                Sound effects · {soundEvents.length} event{soundEvents.length === 1 ? '' : 's'}
              </span>
              <button type="button" onClick={() => audioInputRef.current?.click()}>
                + Audio
              </button>
              <input
                ref={audioInputRef}
                type="file"
                accept={AUDIO_FILE_ACCEPT}
                multiple
                className="resources-file-input"
                onChange={handleAudioFileChange}
              />
            </div>
            <p className="inspector-hint">
              Drag an audio file onto the Timeline ruler, or add it at the playhead.
            </p>
            {audioPreviewError ? (
              <p className="inspector-error" role="alert">
                {audioPreviewError}
              </p>
            ) : null}
            {audioImportStatus ? (
              <p
                className={
                  audioImportStatus.kind === 'error' ? 'inspector-error' : 'inspector-hint'
                }
                role={audioImportStatus.kind === 'error' ? 'alert' : 'status'}
              >
                {audioImportStatus.message}
              </p>
            ) : null}
            {soundEvents.length > 0 ? (
              <div className="resources-media-cues" role="group" aria-label="Sound Events">
                <span className="resources-media-cues-heading">Sound Events</span>
                {soundEvents.map((cue) => {
                  const source = soundEventSource(cue);
                  const frame = cue.trigger.type === 'timeline' ? cue.trigger.startFrame : 0;
                  return (
                    <ResourceTreeItem
                      key={cue.id}
                      label={cue.name}
                      meta={`${source?.name ?? 'No audio'} · Frame ${frame}`}
                      preview={<span className="resources-tree-item-icon">🔊</span>}
                    >
                      <SoundEventEditor cue={cue} />
                    </ResourceTreeItem>
                  );
                })}
              </div>
            ) : null}
            {audioAssets.length === 0 ? (
              <p className="panel-placeholder">No audio imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {audioAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <div
                      className="resources-audio-drag-source"
                      draggable
                      key={asset.id}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'copy';
                        event.dataTransfer.setData('application/x-ograf-audio-asset-id', asset.id);
                      }}
                    >
                      <ResourceTreeItem
                        label={asset.name}
                        meta={`${formatBytes(asset.byteSize)} · ${uses} uses`}
                        badge={assetScope(asset)}
                        preview={<span className="resources-tree-item-icon">♪</span>}
                      >
                        <div className="resources-asset-fields">
                          <input
                            aria-label="Audio resource name"
                            value={asset.name}
                            onChange={(event) =>
                              updateAsset(asset.id, { name: event.target.value })
                            }
                          />
                          <span className="resources-asset-meta">
                            {asset.originalFileName || asset.name} · {asset.mimeType}
                          </span>
                          <div className="resources-tree-actions wrap">
                            <span>{uses} use(s)</span>
                            <button
                              type="button"
                              draggable={false}
                              aria-label={`${previewingAudioAssetId === asset.id ? 'Stop' : 'Play'} preview of ${asset.name}`}
                              onClick={() => toggleAudioPreview(asset)}
                            >
                              {previewingAudioAssetId === asset.id ? '■ Stop' : '▶ Play'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const cueId = addSoundEventFromAsset(asset.id);
                                selectSoundEvent(cueId);
                                useSelectionStore.getState().select(null);
                              }}
                            >
                              Add at Playhead
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                addMediaCueFromAsset(asset.id);
                                useSelectionStore.getState().select(null);
                              }}
                            >
                              Create Playback Cue
                            </button>
                            <button
                              type="button"
                              className="data-table-delete"
                              disabled={uses > 0}
                              onClick={() => removeAsset(asset.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </ResourceTreeItem>
                    </div>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Fonts" count={fontAssets.length}>
            <div className="resources-tree-toolbar">
              <span>Packaged font faces</span>
              <button type="button" onClick={() => fontInputRef.current?.click()}>
                + Import
              </button>
              <input
                ref={fontInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
                className="resources-file-input"
                onChange={handleFileChange}
              />
            </div>
            {fontAssets.length === 0 ? (
              <p className="panel-placeholder">No fonts imported.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {fontAssets.map((asset) => {
                  const uses = usageCount(asset);
                  return (
                    <ResourceTreeItem
                      key={asset.id}
                      label={asset.name}
                      meta={`${asset.fontFamily || 'Unassigned family'} · ${uses} uses`}
                      badge={assetScope(asset)}
                      preview={
                        <span
                          className="resources-tree-font-preview"
                          title={`Template font: ${asset.fontFamily || asset.name}`}
                        >
                          Aa
                        </span>
                      }
                    >
                      <div className="resources-asset-fields">
                        <input
                          aria-label="Resource name"
                          value={asset.name}
                          onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                        />
                        <span className="resources-asset-meta">
                          {asset.originalFileName || asset.name} · {formatBytes(asset.byteSize)}
                        </span>
                        <input
                          aria-label="Font family"
                          placeholder="Font family"
                          value={asset.fontFamily ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { fontFamily: event.target.value })
                          }
                        />
                        <div className="resources-asset-inline">
                          <input
                            aria-label="Font weight"
                            placeholder="100 900"
                            value={asset.fontWeight ?? ''}
                            onChange={(event) =>
                              updateAsset(asset.id, { fontWeight: event.target.value })
                            }
                          />
                          <select
                            aria-label="Font style"
                            value={asset.fontStyle ?? 'normal'}
                            onChange={(event) =>
                              updateAsset(asset.id, {
                                fontStyle: event.target.value as Asset['fontStyle'],
                              })
                            }
                          >
                            <option value="normal">Normal</option>
                            <option value="italic">Italic</option>
                            <option value="oblique">Oblique</option>
                          </select>
                        </div>
                        <input
                          aria-label="Package path"
                          className={
                            !asset.packagePath || isSafePackagePath(asset.packagePath)
                              ? ''
                              : 'invalid'
                          }
                          placeholder={`assets/${asset.id}`}
                          value={asset.packagePath ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, {
                              packagePath: event.target.value || undefined,
                            })
                          }
                        />
                        <input
                          aria-label="Font license name"
                          placeholder="License name, e.g. OFL-1.1"
                          value={asset.licenseName ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { licenseName: event.target.value })
                          }
                        />
                        <input
                          aria-label="Font license URL"
                          placeholder="License URL"
                          value={asset.licenseUrl ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { licenseUrl: event.target.value })
                          }
                        />
                        <textarea
                          aria-label="Font license text"
                          rows={2}
                          placeholder="Optional license text packaged under licenses/"
                          value={asset.licenseText ?? ''}
                          onChange={(event) =>
                            updateAsset(asset.id, { licenseText: event.target.value })
                          }
                        />
                        <div className="resources-tree-actions">
                          <span>{uses} use(s)</span>
                          <button
                            type="button"
                            className="data-table-delete"
                            disabled={uses > 0}
                            onClick={() => removeAsset(asset.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </ResourceTreeItem>
                  );
                })}
              </div>
            )}
          </ResourceTreeBranch>

          <ResourceTreeBranch label="Source attachments" count={sourceAssets.length}>
            <div className="resources-tree-toolbar">
              <span>CSS, JSON and source references</span>
              <button type="button" onClick={() => sourceInputRef.current?.click()}>
                + Attach
              </button>
              <input
                ref={sourceInputRef}
                type="file"
                accept=".css,.json,.txt,.md,.xml,.license,text/*,application/json"
                multiple
                className="resources-file-input"
                onChange={handleFileChange}
              />
            </div>
            {sourceAssets.length === 0 ? (
              <p className="panel-placeholder">No source documents attached.</p>
            ) : (
              <div className="resources-tree-items" role="group">
                {sourceAssets.map((asset) => (
                  <ResourceTreeItem
                    key={asset.id}
                    label={asset.name}
                    meta={`${asset.mimeType} · ${formatBytes(asset.byteSize)}`}
                    badge={assetScope(asset)}
                    preview={<span className="resources-tree-item-icon">S</span>}
                  >
                    <div className="resources-asset-fields">
                      <input
                        aria-label="Resource name"
                        value={asset.name}
                        onChange={(event) => updateAsset(asset.id, { name: event.target.value })}
                      />
                      <span className="resources-asset-meta">
                        {asset.originalFileName || asset.name} · {asset.mimeType}
                      </span>
                      <input
                        aria-label="Package path"
                        className={
                          !asset.packagePath || isSafePackagePath(asset.packagePath)
                            ? ''
                            : 'invalid'
                        }
                        placeholder={`assets/${asset.id}`}
                        value={asset.packagePath ?? ''}
                        onChange={(event) =>
                          updateAsset(asset.id, {
                            packagePath: event.target.value || undefined,
                          })
                        }
                      />
                      <div className="resources-tree-actions">
                        <span>{formatBytes(asset.byteSize)}</span>
                        <button
                          type="button"
                          className="data-table-delete"
                          onClick={() => removeAsset(asset.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </ResourceTreeItem>
                ))}
              </div>
            )}
          </ResourceTreeBranch>
        </div>

        {missingReferences.length > 0 && (
          <p className="resources-asset-warning" role="alert">
            Missing resources: {missingReferences.join(', ')}
          </p>
        )}
      </div>
    </Panel>
  );
}
