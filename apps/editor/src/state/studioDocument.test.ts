import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  createAsset,
  createFieldDefinition,
  createImageLayer,
  createProject,
  createTextLayer,
} from '@ograf-editor/scene-model';
import {
  addProjectSetAssetSlot,
  addProjectSetControl,
  addProjectSetTemplate,
  bindProjectSetAsset,
  bindProjectSetControl,
  createProjectSet,
  createProjectSetArchive,
  openProjectSetArchive,
  setProjectSetControlValue,
} from './projectSet';
import { parseStudioDocument, singleTemplateFromStudioDocument } from './studioDocument';

function fixture(name: string, suffix: string) {
  const project = createProject({ name });
  const composition = project.compositions[0]!;
  const field = createFieldDefinition('text', {
    id: `headline-${suffix}`,
    key: 'headline',
    defaultValue: name,
  });
  const asset = createAsset({
    id: `logo-${suffix}`,
    name: 'Logo',
    kind: 'image',
    mimeType: 'image/png',
    dataUri: 'data:image/png;base64,AQID',
    byteSize: 3,
  });
  const text = createTextLayer();
  text.id = `title-${suffix}`;
  text.bindings = [{ fieldId: field.id, targetProperty: 'content' }];
  const image = createImageLayer();
  image.id = `image-${suffix}`;
  if (image.element.type !== 'image') throw new Error('Expected image');
  image.element.src = `asset:${asset.id}`;
  composition.layers.push(text, image);
  composition.dataFields.push(field);
  composition.assets.push(asset);
  return { project, composition, field, asset, text, image };
}

function sharedFixture() {
  const first = fixture('News', 'a');
  const second = fixture('Sports', 'b');
  let set = addProjectSetTemplate(createProjectSet('Broadcast', first.project), second.project);
  const [a, b] = set.templates;
  set = addProjectSetControl(set, a!.id, first.composition.id, first.field.id, first.project);
  const control = set.controls[0]!;
  set = bindProjectSetControl(set, control.field.id, b!.id, second.composition.id, second.field.id);
  set = setProjectSetControlValue(set, control.field.id, 'Shared bulletin');
  set = addProjectSetAssetSlot(set, a!.id, first.composition.id, first.asset.id, first.project);
  set = bindProjectSetAsset(
    set,
    set.assetSlots[0]!.id,
    b!.id,
    second.composition.id,
    second.asset.id,
  );
  set.activeTemplateId = b!.id;
  return { set, first, second };
}

describe('Studio document content routing', () => {
  it('reads current and legacy standalone JSON without converting or losing source values', async () => {
    const project = createProject({ name: 'Réseau – Günün haberleri' });
    const legacy = { ...project, documentVersion: 1 };
    for (const source of [project, legacy]) {
      const document = await parseStudioDocument(
        new TextEncoder().encode(`\uFEFF${JSON.stringify(source)}`),
      );
      expect(document).toEqual({ kind: 'template', project: source });
      await expect(singleTemplateFromStudioDocument(document)).resolves.toEqual(source);
    }
  });

  it('rejects .ogp filenames even for supported project content', async () => {
    const project = createProject();
    const source = JSON.stringify(project);
    await expect(parseStudioDocument(new Blob([source]), 'Renamed.OGP')).rejects.toThrow(
      'no longer supports .ogp',
    );
    await expect(
      parseStudioDocument(new File([source], 'Also renamed.ogp'), 'Other name.ogs'),
    ).rejects.toThrow('no longer supports .ogp');
    const archive = await createProjectSetArchive(createProjectSet('Set', project));
    await expect(openProjectSetArchive(new File([archive], 'Renamed.ogp'))).rejects.toThrow(
      'no longer supports .ogp',
    );
  });

  it('rejects a schema-4 archive renamed to .ogs', async () => {
    const { set } = sharedFixture();
    const archive = await createProjectSetArchive(set, { archiveMode: 'compatible' });
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    zip.file('manifest.json', JSON.stringify({ ...manifest, schemaVersion: 4 }));
    await expect(
      parseStudioDocument(await zip.generateAsync({ type: 'uint8array' }), 'Renamed.ogs'),
    ).rejects.toThrow('Unsupported template-set version: 4');
  });

  it('reads a one-template .ogs ZIP and resolves its shared values as a standalone project', async () => {
    const { project, composition, field } = fixture('Single', 'single');
    let set = createProjectSet('Single set', project);
    set = addProjectSetControl(set, set.templates[0]!.id, composition.id, field.id, project);
    set = setProjectSetControlValue(set, set.controls[0]!.field.id, 'Resolved single');
    const document = await parseStudioDocument(
      await (await createProjectSetArchive(set)).arrayBuffer(),
    );
    expect(document.kind).toBe('template-set');
    const selected = await singleTemplateFromStudioDocument(document);
    expect(
      selected.compositions[0]!.dataFields.find((item) => item.id === field.id)!.defaultValue,
    ).toBe('Resolved single');
    expect(selected.compositions[0]!.assets[0]!.dataUri).toBe('data:image/png;base64,AQID');
  });

  it('preserves a multi-template ZIP, active member, controls and shared asset bindings', async () => {
    const { set } = sharedFixture();
    const archive = await createProjectSetArchive(set);
    for (const input of [new Uint8Array(await archive.arrayBuffer()), archive]) {
      const document = await parseStudioDocument(input);
      if (document.kind !== 'template-set') throw new Error('Expected set');
      expect(document.projectSet.templates.map((item) => item.name)).toEqual(['News', 'Sports']);
      expect(document.projectSet.activeTemplateId).toBe(set.activeTemplateId);
      expect(document.projectSet.controls[0]!.value).toBe('Shared bulletin');
      expect(document.projectSet.controls[0]!.bindings).toHaveLength(2);
      expect(document.projectSet.assetSlots[0]!.bindings).toHaveLength(2);
      expect(document.projectSet.assets[0]!.dataUri).toBe(set.assets[0]!.dataUri);
      await expect(singleTemplateFromStudioDocument(document)).rejects.toThrow(
        'multiple templates',
      );
    }
  });

  it('uses the existing archive integrity checks instead of accepting altered shared payloads', async () => {
    const { set } = sharedFixture();
    const archive = await createProjectSetArchive(set);
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    zip.file(manifest.assets[0].path, new Uint8Array([9, 9, 9]));
    await expect(
      parseStudioDocument(await zip.generateAsync({ type: 'uint8array' })),
    ).rejects.toThrow('integrity');
  });
});
