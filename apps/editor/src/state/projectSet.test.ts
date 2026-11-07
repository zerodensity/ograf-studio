import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createFieldDefinition,
  createImageLayer,
  createProject,
  createTextLayer,
} from '@ograf-editor/scene-model';
import {
  addProjectSetControl,
  addProjectSetTemplate,
  bindProjectSetAsset,
  bindProjectSetControl,
  buildProjectSetSceneTree,
  createProjectSet,
  createProjectSetArchive,
  migrateProjectSetDocument,
  moveProjectSetTemplate,
  openProjectSetArchive,
  reorderProjectSetTemplate,
  renameProjectSetTemplate,
  resolveProjectSetTemplate,
  saveProjectSetTemplateEdits,
  setProjectSetAssetBindingInherited,
  setProjectSetControlBindingInherited,
  setProjectSetControlValue,
  type ProjectSetDocument,
  type ProjectSetSceneNode,
} from './projectSet';

describe('empty template-set archive compatibility', () => {
  it('keeps ordinary DATA-prefixed names and field text while pooling actual embedded resources', async () => {
    const project = createProject({ name: 'DATA: STOCKS RISE' });
    const composition = project.compositions[0]!;
    const text = createTextLayer();
    if (text.element.type !== 'text') throw new Error('Expected text layer.');
    text.element.content = 'DATA: STOCKS RISE';
    composition.layers.push(text);
    composition.dataFields.push(
      createFieldDefinition('text', {
        id: 'data-prefixed-field',
        key: 'dataPrefixedText',
        defaultValue: 'data: unavailable',
      }),
    );
    composition.assets.push(
      createAsset({
        id: 'real-data-resource',
        name: 'Embedded logo',
        kind: 'image',
        mimeType: 'image/png',
        dataUri: 'data:image/png;base64,AQID',
        byteSize: 3,
      }),
    );
    const set = createProjectSet('DATA: Market graphics', project);
    const archive = await createProjectSetArchive(set);
    const reopened = await openProjectSetArchive(new Uint8Array(await archive.arrayBuffer()));
    expect(reopened.name).toBe(set.name);
    expect(reopened.templates[0]!.name).toBe('DATA: STOCKS RISE');
    expect(reopened.templates[0]!.project).toEqual(project);
  });

  it.each([{ archiveMode: 'compatible' as const }, { legacyFormat: true }])(
    'rejects an empty compatible or legacy set that would lose unused shared component sources',
    async (options) => {
      const set = createProjectSet('Unplaced sources', createProject());
      set.templates = [];
      delete set.activeTemplateId;
      set.componentAssets = [
        {
          id: 'unplaced-component',
          name: 'Unplaced component',
          scope: 'set',
          layers: [],
          dataFields: [],
        },
      ];
      await expect(createProjectSetArchive(set, options)).rejects.toThrow(
        /at least one template.*shared components.*compact/i,
      );
      const compact = await createProjectSetArchive(set);
      const reopened = await openProjectSetArchive(new Uint8Array(await compact.arrayBuffer()));
      expect(reopened.componentAssets).toEqual(set.componentAssets);
      expect(reopened.templates).toEqual([]);
    },
  );

  it.each([{ archiveMode: 'compatible' as const }, { legacyFormat: true }])(
    'continues to save an empty compatible or legacy set without shared sources',
    async (options) => {
      const set = createProjectSet('Empty set', createProject());
      set.templates = [];
      delete set.activeTemplateId;
      const archive = await createProjectSetArchive(set, options);
      const reopened = await openProjectSetArchive(new Uint8Array(await archive.arrayBuffer()));
      expect(reopened.templates).toEqual([]);
      expect(reopened.componentAssets ?? []).toEqual([]);
    },
  );
});

function fixtureProject(name: string, suffix: string) {
  const project = createProject({ name });
  const composition = project.compositions[0]!;
  const asset = createAsset({
    id: `logo-${suffix}`,
    name: `${name} logo`,
    kind: 'image',
    dataUri: suffix === 'a' ? 'data:image/png;base64,AQID' : 'data:image/png;base64,BAUG',
    mimeType: 'image/png',
    byteSize: 3,
  });
  const field = createFieldDefinition('image-url', {
    id: `logo-field-${suffix}`,
    key: 'logo',
    label: `${name} logo`,
    defaultValue: `asset:${asset.id}`,
  });
  composition.assets.push(asset);
  composition.dataFields.push(field);
  const layer = createImageLayer();
  if (layer.element.type !== 'image') throw new Error('Expected an image layer.');
  layer.element.src = `asset:${asset.id}`;
  composition.layers.push(layer);
  return { project, composition, asset, field, layer };
}

function flatten(nodes: ProjectSetSceneNode[]): ProjectSetSceneNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe('OGraf template sets', () => {
  it('rejects duplicate slide names and renames the child source while preserving its identity', () => {
    const news = fixtureProject('News', 'a');
    let set = createProjectSet('News show', news.project);
    const templateId = set.templates[0]!.id;
    set = addProjectSetTemplate(set, fixtureProject('Sports', 'b').project);
    set = addProjectSetControl(set, templateId, news.composition.id, news.field.id, news.project);

    expect(() => renameProjectSetTemplate(set, templateId, '  SPORTS  ')).toThrow('already exists');
    expect(() => renameProjectSetTemplate(set, templateId, '   ')).toThrow('Enter a template name');
    const renamed = renameProjectSetTemplate(set, templateId, '  Morning News  ');
    expect(renamed.templates[0]).toMatchObject({
      id: templateId,
      name: 'Morning News',
      project: { id: news.project.id, name: 'Morning News' },
    });
    expect(renamed.activeTemplateId).toBe(templateId);
    expect(renamed.controls).toEqual(set.controls);
    expect(renamed.assetSlots).toEqual(set.assetSlots);
    expect(set.templates[0]!.name).toBe('News');
    expect(renameProjectSetTemplate(renamed, templateId, 'Morning News')).toBe(renamed);
  });

  it('persists a child rename in the slide label and archive without changing its bindings', async () => {
    const fixture = fixtureProject('Untitled Template', 'a');
    let set = createProjectSet('News show', fixture.project);
    const templateId = set.templates[0]!.id;
    set = addProjectSetControl(
      set,
      templateId,
      fixture.composition.id,
      fixture.field.id,
      fixture.project,
    );
    const edited = { ...resolveProjectSetTemplate(set, templateId), name: 'News Bulletin' };
    const renamed = saveProjectSetTemplateEdits(set, templateId, edited);
    const archive = await createProjectSetArchive(renamed);
    const restored = await openProjectSetArchive(await archive.arrayBuffer());

    expect(restored.templates[0]).toMatchObject({
      id: templateId,
      name: 'News Bulletin',
      project: { name: 'News Bulletin' },
    });
    expect(restored.controls).toEqual(set.controls);
    expect(restored.assetSlots).toEqual(set.assetSlots);
    expect(set.templates[0]!.name).toBe('Untitled Template');
  });

  it('reorders slides while preserving the active template ID and set bindings', () => {
    const first = fixtureProject('News', 'a');
    const second = fixtureProject('Sports', 'b');
    const third = fixtureProject('Weather', 'c');
    let set = createProjectSet('Evening show', first.project);
    set = addProjectSetTemplate(set, second.project);
    set = addProjectSetTemplate(set, third.project);
    const activeId = set.templates[1]!.id;
    set.activeTemplateId = activeId;

    const reordered = moveProjectSetTemplate(set, activeId, 1);

    expect(reordered.templates.map((template) => template.name)).toEqual([
      'News',
      'Weather',
      'Sports',
    ]);
    expect(reordered.activeTemplateId).toBe(activeId);
    expect(moveProjectSetTemplate(reordered, activeId, 1)).toBe(reordered);
  });

  it('moves a slide before or after a distant target and persists that order with its bindings', async () => {
    const news = fixtureProject('News', 'a');
    let set = createProjectSet('Evening show', news.project);
    set = addProjectSetTemplate(set, fixtureProject('Sports', 'b').project);
    set = addProjectSetTemplate(set, fixtureProject('Weather', 'c').project);
    const [first, second, third] = set.templates;
    set = addProjectSetControl(set, first!.id, news.composition.id, news.field.id, news.project);

    const movedDown = reorderProjectSetTemplate(set, first!.id, third!.id, 'after');
    expect(movedDown.templates.map((template) => template.name)).toEqual([
      'Sports',
      'Weather',
      'News',
    ]);
    const movedUp = reorderProjectSetTemplate(movedDown, third!.id, second!.id, 'before');
    expect(movedUp.templates.map((template) => template.name)).toEqual([
      'Weather',
      'Sports',
      'News',
    ]);
    expect(movedUp.activeTemplateId).toBe(first!.id);
    expect(movedUp.controls).toEqual(set.controls);
    expect(reorderProjectSetTemplate(movedUp, first!.id, first!.id, 'before')).toBe(movedUp);
    expect(set.templates.map((template) => template.name)).toEqual(['News', 'Sports', 'Weather']);

    const archive = await createProjectSetArchive(movedUp);
    const restored = await openProjectSetArchive(await archive.arrayBuffer());
    expect(restored.templates.map((template) => template.id)).toEqual([
      third!.id,
      second!.id,
      first!.id,
    ]);
    expect(restored.activeTemplateId).toBe(first!.id);
    expect(restored.controls).toEqual(set.controls);
  });

  it('round-trips templates, active selection, shared controls, slots and asset bytes', async () => {
    const first = fixtureProject('News', 'a');
    const second = fixtureProject('Sports', 'b');
    let set = createProjectSet('Evening show', first.project);
    const firstTemplate = set.templates[0]!;
    set = addProjectSetTemplate(set, second.project);
    const secondTemplate = set.templates[1]!;
    set.activeTemplateId = secondTemplate.id;

    set = addProjectSetControl(
      set,
      firstTemplate.id,
      first.composition.id,
      first.field.id,
      first.project,
    );
    const control = set.controls[0]!;
    const slot = set.assetSlots[0]!;
    expect(control.value).toBe(`asset-slot:${slot.id}`);

    set = bindProjectSetAsset(
      set,
      slot.id,
      secondTemplate.id,
      second.composition.id,
      second.asset.id,
    );
    set = bindProjectSetControl(
      set,
      control.field.id,
      secondTemplate.id,
      second.composition.id,
      second.field.id,
    );
    set = setProjectSetControlValue(set, control.field.id, `asset-slot:${slot.id}`);

    const resolved = resolveProjectSetTemplate(set, secondTemplate.id);
    const resolvedComposition = resolved.compositions.find(
      (item) => item.id === second.composition.id,
    )!;
    expect(
      resolvedComposition.dataFields.find((item) => item.id === second.field.id)?.defaultValue,
    ).toBe(`asset:${second.asset.id}`);
    expect(resolvedComposition.assets.find((item) => item.id === second.asset.id)?.dataUri).toBe(
      first.asset.dataUri,
    );
    expect(
      set.templates[1]!.project.compositions[0]!.assets.find((item) => item.id === second.asset.id)
        ?.dataUri,
    ).toBe(second.asset.dataUri);

    const archive = await createProjectSetArchive(set);
    const reopened = await openProjectSetArchive(new Uint8Array(await archive.arrayBuffer()));
    expect(reopened.activeTemplateId).toBe(secondTemplate.id);
    expect(reopened.templates.map((template) => template.name)).toEqual(['News', 'Sports']);
    expect(
      resolveProjectSetTemplate(reopened, secondTemplate.id).compositions[0]!.assets[0]!.dataUri,
    ).toBe(first.asset.dataUri);
  });

  it('keeps template-local field and asset fallbacks when inheritance is disabled', () => {
    const first = fixtureProject('News', 'a');
    const second = fixtureProject('Sports', 'b');
    let set = createProjectSet('Evening show', first.project);
    const firstTemplate = set.templates[0]!;
    set = addProjectSetTemplate(set, second.project);
    const secondTemplate = set.templates[1]!;
    set = addProjectSetControl(set, firstTemplate.id, first.composition.id, first.field.id);
    const control = set.controls[0]!;
    const slot = set.assetSlots[0]!;
    set = bindProjectSetAsset(
      set,
      slot.id,
      secondTemplate.id,
      second.composition.id,
      second.asset.id,
    );
    set = bindProjectSetControl(
      set,
      control.field.id,
      secondTemplate.id,
      second.composition.id,
      second.field.id,
    );
    const binding = set.assetSlots[0]!.bindings.find(
      (item) => item.templateId === secondTemplate.id,
    )!;
    set = setProjectSetAssetBindingInherited(set, slot.id, binding.id, false);
    set = setProjectSetControlBindingInherited(
      set,
      control.field.id,
      secondTemplate.id,
      second.composition.id,
      second.field.id,
      false,
    );

    const resolved = resolveProjectSetTemplate(set, secondTemplate.id);
    const composition = resolved.compositions.find((item) => item.id === second.composition.id)!;
    expect(composition.dataFields.find((item) => item.id === second.field.id)?.defaultValue).toBe(
      second.field.defaultValue,
    );
    expect(composition.assets.find((item) => item.id === second.asset.id)?.dataUri).toBe(
      second.asset.dataUri,
    );
  });

  it('shows asset definitions, their instances, owner links and missing references in the scene tree', () => {
    const fixture = fixtureProject('News', 'a');
    const set = createProjectSet('Evening show', fixture.project);
    const missingLayer = createImageLayer();
    if (missingLayer.element.type !== 'image') throw new Error('Expected an image layer.');
    missingLayer.name = 'Missing graphic';
    missingLayer.element.src = 'asset:missing-logo';
    set.templates[0]!.project.compositions[0]!.layers.push(missingLayer);

    const nodes = flatten(buildProjectSetSceneTree(set).children);
    expect(
      nodes.some((node) => node.kind === 'asset-instance' && node.targetId === fixture.layer.id),
    ).toBe(true);
    expect(nodes.some((node) => node.label === 'Missing asset · missing-logo')).toBe(true);
  });

  it('migrates pre-inheritance bindings and preserves their local defaults', () => {
    const source = fixtureProject('News', 'a');
    const set = createProjectSet('Evening show', source.project);
    const legacy = structuredClone(set) as ProjectSetDocument;
    delete legacy.activeTemplateId;
    legacy.assetSlots = [
      {
        id: 'legacy-slot',
        key: 'legacy',
        label: 'Legacy slot',
        kind: 'image',
        required: false,
        assetId: null,
        bindings: [
          {
            templateId: legacy.templates[0]!.id,
            compositionId: source.composition.id,
            templateAssetId: source.asset.id,
          } as ProjectSetDocument['assetSlots'][number]['bindings'][number],
        ],
      },
    ];
    const migrated = migrateProjectSetDocument(legacy);
    expect(migrated.activeTemplateId).toBe(legacy.templates[0]!.id);
    expect(migrated.assetSlots[0]!.bindings[0]).toMatchObject({ inherit: true });
    expect(migrated.assetSlots[0]!.bindings[0]!.id).toMatch(/^assetinstance-/);
  });
});
