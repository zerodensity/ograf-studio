import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createCustomActionDefinition,
  createFieldDefinition,
  createMediaCue,
  createProject,
  type LogicFunctionDefinition,
  type TransitionLogicDefinition,
} from '@ograf-editor/scene-model';
import { compileDescriptor } from './compileDescriptor';
import { buildExportArtifactsWithRuntime } from './buildExportArtifacts';
import { buildCoordinatedExportArtifactsWithRuntime } from './buildCoordinatedExportArtifacts';
import { getExportProfile } from './exportProfiles';

function fixture() {
  const project = createProject({ supportsNonRealTime: false });
  const composition = project.compositions[0]!;
  composition.dataFields = [
    createFieldDefinition('number', { id: 'score-source', key: 'gameScore', exposeToOgraf: false }),
  ];
  composition.customActions = [
    createCustomActionDefinition({ actionId: 'increment' }),
    createCustomActionDefinition({ actionId: 'done' }),
  ];
  composition.assets = [
    createAsset({
      id: 'music-source',
      name: 'Music.wav',
      kind: 'audio',
      mimeType: 'audio/wav',
      dataUri: 'data:audio/wav;base64,AQID',
      durationMs: 1000,
    }),
  ];
  composition.mediaCues = [
    createMediaCue({
      id: 'music',
      activeSourceId: 'audio',
      sources: [
        { id: 'audio', name: 'Music', kind: 'clip', mediaType: 'audio', src: 'asset:music-source' },
      ],
    }),
  ];
  const definition: LogicFunctionDefinition = {
    type: 'javascript',
    version: 1,
    id: 'counter',
    name: 'Counter',
    enabled: true,
    pointer: true,
    source: '({data,state})=>({data:{score:data.score+1},state})',
    inputs: { score: 'score-source' },
    outputs: { score: 'score-source' },
    actions: ['increment'],
    emits: { finished: 'done' },
    media: { music: 'music' },
    initialState: { count: 0 },
    timeoutMs: 250,
  };
  composition.functions = [definition];
  return { project, composition, definition };
}
describe('portable function compilation', () => {
  it('resolves only mapped field IDs and keeps source/private defaults unchanged', () => {
    const { composition, definition } = fixture();
    const before = JSON.stringify(composition);
    const descriptor = compileDescriptor(composition);
    expect(descriptor.functions).toEqual([
      { ...definition, inputs: { score: 'gameScore' }, outputs: { score: 'gameScore' } },
    ]);
    expect(descriptor.functions![0]!.pointer).toBe(true);
    expect(descriptor.functions![0]!.initialState).not.toBe(definition.initialState);
    expect(descriptor.dataDefaults).toHaveProperty('gameScore');
    expect(descriptor.dataExposure?.gameScore?.exposed).toBe(false);
    expect(JSON.stringify(composition)).toBe(before);
  });
  it('packages media normally while retaining alias bindings and all registered actions', () => {
    const { project, composition } = fixture();
    const result = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
      getExportProfile('realtime'),
    );
    expect(result.valid, result.errors.join('\n')).toBe(true);
    expect(result.manifest.supportsNonRealTime).toBe(false);
    expect(result.manifest.customActions?.map((action) => action.id)).toEqual([
      'increment',
      'done',
    ]);
    const audio = result.resources.filter((resource) => resource.mimeType === 'audio/wav');
    expect(audio).toHaveLength(1);
    expect(result.descriptor!.mediaCues![0]!.sources[0]).toMatchObject({ src: audio[0]!.path });
    expect(result.descriptor!.functions![0]!.media).toEqual({ music: 'music' });
    expect(result.mainJs).toContain('"inputs":{"score":"gameScore"}');
  });
  it.each(['non-realtime', 'dual'] as const)('rejects the %s profile explicitly', (profile) => {
    const { project, composition } = fixture();
    const result = buildExportArtifactsWithRuntime(
      project,
      composition,
      'class GraphicElement {}',
      getExportProfile(profile),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('uses Functions');
  });
  it('rejects coordinated export instead of silently losing function behavior', () => {
    const { project } = fixture();
    const definition: TransitionLogicDefinition = {
      version: 4,
      id: 'logic',
      name: 'Game',
      defaultTransitionId: 'cut',
      slots: [{ id: 'game', name: 'Game', order: 0 }],
      states: [{ id: 'game-on', name: 'Game', slotId: 'game', templateId: 'game' }],
      transitions: [
        {
          id: 'cut',
          name: 'Cut',
          durationFrames: 0,
          outgoingFrames: 0,
          incomingStartFrame: 0,
          incomingFrames: 0,
          sharedFrames: 0,
          easing: 'linear',
        },
      ],
      routes: [],
      sharedInstances: [],
      initialSharedValues: [],
    };
    const result = buildCoordinatedExportArtifactsWithRuntime(
      {
        id: 'game-set',
        name: 'Game set',
        definition,
        templates: [{ id: 'game', name: 'Game', project }],
        componentAssets: [],
      },
      'class CoordinatedGraphicElement {}',
      getExportProfile('realtime'),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('Functions require standalone real-time export');
  });
});
