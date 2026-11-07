import { describe, expect, it } from 'vitest';
import {
  createComposition,
  createDefaultTransform,
  createLayerKeyframe,
  createLayerOfKind,
  createProject,
  instantiateComponentDefinition,
  reconcileComponentInstances,
  transitionLogicErrors,
  type ComponentDefinition,
  type Layer,
  type LayerTransform,
  type Project,
} from '@ograf-editor/scene-model';
import { getExportProfile } from '@ograf-editor/codegen';
import { buildCoordinatedProjectSetArtifacts } from './coordinatedExport';
import type { ProjectSetDocument } from './projectSet';
import { layerStates } from './transitionChoreography';
import { createDefaultTransitionLogic } from './transitionLogicEditing';
import {
  buildPlayoutSetup,
  cellElementMotions,
  layoutChecks,
  proposeLanes,
  templateLayouts,
  templateLookup,
  transitionChecks,
  transitionReferences,
} from './transitionsDesign';

/** A second, differently shaped set: two overlapping scorebugs, a full-frame card, a strap. */
function place(layer: Layer, values: Partial<LayerTransform>): Layer {
  layer.keyframes = [
    createLayerKeyframe(0, createDefaultTransform(values), { id: `${layer.id}-pose` }),
  ];
  for (const [property, value] of Object.entries(values))
    for (const key of layer.animationTracks[property as keyof LayerTransform] ?? [])
      key.value = value;
  return layer;
}

function rect(id: string, values: Partial<LayerTransform>): Layer {
  const layer = createLayerOfKind('rectangle');
  layer.id = id;
  layer.name = id;
  return place(layer, values);
}

function label(id: string, values: Partial<LayerTransform>, fontSize = 32): Layer {
  const layer = createLayerOfKind('text');
  layer.id = id;
  layer.name = id;
  if (layer.element.type === 'text') layer.element.fontSize = fontSize;
  return place(layer, values);
}

const sponsor: ComponentDefinition = {
  id: 'sponsor',
  name: 'Sponsor logo',
  scope: 'set',
  layers: [rect('sponsor-mark', { x: 0, y: 0, width: 200, height: 40 })],
  dataFields: [],
};

function template(
  name: string,
  layers: Layer[],
  sponsorAt?: Partial<LayerTransform>,
): ProjectSetDocument['templates'][number] {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const composition = createComposition({
    id: `${id}-comp`,
    name,
    width: 1920,
    height: 1080,
    frameRate: 50,
    components: [structuredClone(sponsor)],
  });
  composition.layers.push(...layers);
  if (sponsorAt) {
    const { layers: placed } = instantiateComponentDefinition(composition, sponsor, { x: 0, y: 0 });
    for (const layer of placed) place(layer, sponsorAt);
    composition.layers.push(...placed);
    reconcileComponentInstances(composition);
  }
  const project: Project = createProject({
    id: `${id}-project`,
    name,
    mainCompositionId: composition.id,
    compositions: [composition],
  });
  return { id, name, inheritSettings: true, project };
}

function sportsSet(): ProjectSetDocument {
  return {
    id: 'sports',
    name: 'Sports',
    nameOrigin: 'custom',
    templates: [
      template(
        'Scorebug',
        [
          rect('bug', { x: 60, y: 50, width: 420, height: 70 }),
          label('score', { x: 80, y: 60, width: 380, height: 50 }),
        ],
        { x: 60, y: 125, width: 200, height: 40 },
      ),
      template(
        'Scorebug expanded',
        [
          rect('bug-wide', { x: 60, y: 50, width: 620, height: 110 }),
          label('period', { x: 80, y: 60, width: 560, height: 50 }),
        ],
        { x: 60, y: 165, width: 200, height: 40 },
      ),
      template('Stats', [
        rect('card', { x: 0, y: 0, width: 1920, height: 1080 }),
        label('stat', { x: 200, y: 400, width: 900, height: 120 }, 72),
      ]),
      template('Name strap', [
        rect('strap', { x: 100, y: 860, width: 1100, height: 120 }),
        label('name', { x: 130, y: 880, width: 900, height: 60 }, 48),
      ]),
    ],
    controls: [],
    assetSlots: [],
    assets: [],
    componentAssets: [structuredClone(sponsor)],
  };
}

describe('a second, differently shaped template set', () => {
  it('proposes lanes, morphs the shared sponsor, flags clashes and exports', () => {
    const set = sportsSet();
    const layouts = templateLayouts(set);
    const lanes = proposeLanes(set, layouts);
    expect(lanes.map((lane) => [lane.name, lane.templateIds])).toEqual([
      ['Top', ['scorebug', 'scorebug-expanded']],
      ['Name strap', ['name-strap']],
      ['Stats', ['stats']],
    ]);
    expect(lanes[0]!.componentIds).toEqual(['sponsor']);

    const components = set.componentAssets!;
    const references = transitionReferences(set, components);
    const definition = buildPlayoutSetup(createDefaultTransitionLogic(set), {
      set,
      lanes,
      components,
      templates: templateLookup(set),
      references,
      style: 'slide',
      speed: 'natural',
      frameRate: 50,
    });
    expect(transitionLogicErrors(definition, references)).toEqual([]);

    const top = definition.slots.find((slot) => slot.name === 'Top')!;
    const [bug, wide] = layerStates(definition, top.id);
    const motions = cellElementMotions(definition, components, {
      slotId: top.id,
      from: bug!.id,
      to: wide!.id,
    });
    expect(motions.find((motion) => motion.property === 'y')).toMatchObject({ from: 125, to: 165 });
    expect(definition.transitions.some((recipe) => recipe.contentMotion === 'slide')).toBe(true);

    const checks = transitionChecks(definition, layouts);
    expect(checks.filter((check) => check.id.startsWith('clash:')).length).toBe(2);
    expect(layoutChecks(definition, layouts, templateLookup(set), references)).toEqual([]);

    const artifacts = buildCoordinatedProjectSetArtifacts(
      { ...set, transitionLogic: definition },
      getExportProfile('realtime'),
    );
    expect(artifacts.errors).toEqual([]);
    expect(artifacts.valid).toBe(true);
    const linked = artifacts.transitionDescriptor!.templates.filter((entry) =>
      entry.sharedLayers.some((layer) => layer.sourceLayerId === 'sponsor-mark'),
    );
    expect(linked.map((entry) => entry.id).sort()).toEqual(['scorebug', 'scorebug-expanded']);
  });
});
