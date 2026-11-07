import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  createAsset,
  createFieldDefinition,
  createLayerLoopClip,
  createProject,
  createRectangleLayer,
  type Project,
} from '@ograf-editor/scene-model';
import {
  buildCoordinatedExportArtifactsWithRuntime,
  buildExportArtifactsWithRuntime,
} from '@ograf-editor/codegen';
import { createTransitionLogicNewsExample } from '../examples/transitionLogicNews';
import { componentLibraryFromTemplates } from './componentSetLibrary';
import {
  createProjectSetArchive,
  openProjectSetArchive,
  resolveProjectSetTemplate,
  type ProjectSetDocument,
} from './projectSet';
import { parseProjectSource, parseStudioDocument } from './studioDocument';

const runtimeStub = 'class Graphic {}\nexport default Graphic;';
const fontUri = 'data:font/woff2;base64,AQIDBAUGBwg=';
const svgUri =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';

function fixture(): ProjectSetDocument {
  const set = createTransitionLogicNewsExample(0);
  set.name = 'Archive compatibility fixture';
  const font = createAsset({
    id: 'archive-font',
    name: 'Archive Font',
    kind: 'font',
    mimeType: 'font/woff2',
    fontFamily: 'Archive Font',
    dataUri: fontUri,
    byteSize: 8,
    licenseName: 'Fixture license',
    licenseText: 'Kept exactly.',
  });
  const svg = createAsset({
    id: 'archive-logo',
    name: 'Archive Logo',
    kind: 'image',
    mimeType: 'image/svg+xml',
    dataUri: svgUri,
    byteSize: 41,
  });
  set.assets.push(structuredClone(font));
  set.componentAssets![0]!.resources = [structuredClone(font), structuredClone(svg)];
  for (const [index, template] of set.templates.entries()) {
    const composition = template.project.compositions[0]!;
    const canonical = structuredClone(set.componentAssets!);
    // A local source on each side checks that restoring shared sources retains stack order.
    composition.components = [
      {
        id: `local-first-${index}`,
        name: 'Local first',
        scope: 'local',
        layers: [{ ...createRectangleLayer(), id: `local-first-layer-${index}` }],
        dataFields: [],
      },
      ...canonical,
      {
        id: `local-last-${index}`,
        name: 'Local last',
        scope: 'local',
        layers: [{ ...createRectangleLayer(), id: `local-last-layer-${index}` }],
        dataFields: [],
      },
    ];
    composition.assets.push(structuredClone(font), structuredClone(svg));
    const field = createFieldDefinition('number', {
      id: `archive-hold-${index}`,
      key: 'archiveHold',
      defaultValue: 2.5,
    });
    composition.dataFields.push(field);
    const layer = composition.layers.at(-1)!;
    layer.loop = createLayerLoopClip({
      id: `archive-loop-${index}`,
      durationFrames: 50,
      timing: {
        groupId: `archive-group-${index}`,
        holdFieldId: field.id,
        holdRanges: [{ startFrame: 10, endFrame: 35 }],
      },
      tracks: {
        opacity: [
          { id: `archive-loop-a-${index}`, frame: 0, value: 0.7, easing: 'linear' },
          { id: `archive-loop-b-${index}`, frame: 50, value: 1, easing: 'linear' },
        ],
      },
    });
  }
  return set;
}

async function loadedArchive(set = fixture(), archiveMode: 'compact' | 'compatible' = 'compact') {
  const blob = await createProjectSetArchive(set, { archiveMode });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
  return { blob, bytes, zip, manifest };
}

async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function mutateArchive(change: (zip: JSZip, manifest: any) => void | Promise<void>) {
  const { zip, manifest } = await loadedArchive();
  await change(zip, manifest);
  zip.file('manifest.json', JSON.stringify(manifest));
  return zip.generateAsync({ type: 'uint8array' });
}

function coordinatedArtifacts(set: ProjectSetDocument) {
  return buildCoordinatedExportArtifactsWithRuntime(
    {
      id: set.id,
      name: set.name,
      definition: set.transitionLogic!,
      templates: set.templates.map((template) => ({
        id: template.id,
        name: template.name,
        project: resolveProjectSetTemplate(set, template.id),
      })),
      componentAssets: componentLibraryFromTemplates(set),
    },
    runtimeStub,
  );
}

describe('compact template-set compatibility', () => {
  it.each([1, 2, 3, 4, 5])(
    'still opens original v%i archives with ordinary standalone child JSON',
    async (schemaVersion) => {
      const project = createProject({ name: 'Original template' });
      const source = JSON.stringify(project);
      const zip = new JSZip();
      zip.file('templates/original-template.ogs', source);
      zip.file(
        'manifest.json',
        JSON.stringify({
          format: 'ograf-template-set',
          schemaVersion,
          id: 'original-set',
          name: 'Original set',
          templates: [
            {
              id: 'original-template',
              name: project.name,
              projectId: project.id,
              source: 'templates/original-template.ogs',
              sha256: await digest(source),
            },
          ],
          controls: [],
          assetSlots: [],
          assets: [],
        }),
      );
      const opened = await openProjectSetArchive(await zip.generateAsync({ type: 'uint8array' }));
      expect(opened.templates[0]!.project).toEqual(project);
    },
  );

  it('stores exact embedded resources and set component definitions once without mutating the live source', async () => {
    const set = fixture();
    const before = structuredClone(set);
    const { zip, manifest } = await loadedArchive(set);
    expect(set).toEqual(before);
    expect(manifest.schemaVersion).toBe(6);
    const payloads = await Promise.all(
      manifest.resources.map((item: any) => zip.file(item.path)!.async('string')),
    );
    expect(payloads.filter((value) => value === fontUri)).toHaveLength(1);
    expect(payloads.filter((value) => value === svgUri)).toHaveLength(1);
    const library = JSON.parse(await zip.file(manifest.sharedComponents.path)!.async('string'));
    expect(library.map((item: any) => item.id)).toEqual(
      set.componentAssets!.map((item) => item.id),
    );
    for (const template of manifest.templates) {
      const compact = JSON.parse(await zip.file(template.source)!.async('string')) as Project;
      expect(
        compact.compositions
          .flatMap((item) => item.components)
          .every((item) => item.scope !== 'set'),
      ).toBe(true);
      expect(JSON.stringify(compact)).not.toContain(fontUri);
      expect(JSON.stringify(compact)).not.toContain(svgUri);
    }
  });

  it('reopens to the same projects, overrides, bindings, animation, loop fields and graph as the v5 compatibility copy', async () => {
    const set = fixture();
    const compact = await loadedArchive(set);
    const compatible = await loadedArchive(set, 'compatible');
    expect(compatible.manifest.schemaVersion).toBe(5);
    expect(compatible.manifest.sharedComponents).toBeUndefined();
    const expected = await openProjectSetArchive(compatible.bytes);
    const actual = await openProjectSetArchive(compact.bytes);
    expect(actual).toEqual(expected);
    expect(actual.transitionLogic).toEqual(set.transitionLogic);
    for (const template of actual.templates) {
      const project = resolveProjectSetTemplate(actual, template.id);
      expect(project).toEqual(resolveProjectSetTemplate(expected, template.id));
      expect(project.compositions[0]!.layers.at(-1)!.loop!.timing!.holdFieldId).toMatch(
        /^archive-hold-/,
      );
    }
  });

  it('materializes portable standalone JSON and preserves standalone and coordinated export output', async () => {
    const set = fixture();
    const opened = await openProjectSetArchive((await loadedArchive(set)).bytes);
    const expected = await openProjectSetArchive((await loadedArchive(set, 'compatible')).bytes);
    for (const template of opened.templates) {
      const standalone = resolveProjectSetTemplate(opened, template.id);
      const json = JSON.stringify(standalone);
      expect(json).not.toContain('archiveFragment');
      const parsed = parseProjectSource(json);
      expect((await parseStudioDocument(new TextEncoder().encode(json))).kind).toBe('template');
      expect(
        parsed.compositions[0]!.components.filter((item) => item.scope === 'set'),
      ).toHaveLength(set.componentAssets!.length);
      expect(
        parsed.compositions[0]!.assets.find((item) => item.id === 'archive-font')!.dataUri,
      ).toBe(fontUri);
      expect(
        parsed.compositions[0]!.assets.find((item) => item.id === 'archive-logo')!.dataUri,
      ).toBe(svgUri);
      const old = resolveProjectSetTemplate(expected, template.id);
      expect(buildExportArtifactsWithRuntime(parsed, parsed.compositions[0]!, runtimeStub)).toEqual(
        buildExportArtifactsWithRuntime(old, old.compositions[0]!, runtimeStub),
      );
    }
    const artifacts = coordinatedArtifacts(opened);
    expect(artifacts).toEqual(coordinatedArtifacts(expected));
    expect(artifacts.errors).toEqual([]);
  });

  it('explains how to export a standalone template when an internal compact fragment is opened', async () => {
    const { zip, manifest } = await loadedArchive();
    const compactSource = await zip.file(manifest.templates[0].source)!.async('string');
    expect(JSON.parse(compactSource).archiveFragment).toMatchObject({
      format: 'ograf-template-fragment',
      schemaVersion: 1,
      resourceReferenceCount: manifest.templates[0].resourceRefs.length,
      componentReferenceCount: manifest.templates[0].componentRefs.reduce(
        (count: number, reference: any) => count + reference.componentIds.length,
        0,
      ),
    });
    expect(() => parseProjectSource(compactSource)).toThrow(
      /Open the complete template set.*Save Template/,
    );
    await expect(parseStudioDocument(new TextEncoder().encode(compactSource))).rejects.toThrow(
      /standalone template/,
    );
    const compatible = await loadedArchive(fixture(), 'compatible');
    const portableSource = await compatible.zip
      .file(compatible.manifest.templates[0].source)!
      .async('string');
    expect(parseProjectSource(portableSource).compositions).not.toHaveLength(0);
  });

  it('shares equal payloads while preserving resource identity, font metadata and exact URI spelling', async () => {
    const set = fixture();
    const composition = set.templates[0]!.project.compositions[0]!;
    composition.assets.push(
      createAsset({
        id: 'font-alternate',
        kind: 'font',
        name: 'Alternate metadata',
        mimeType: 'font/woff2',
        fontFamily: 'Alternate Font',
        fontWeight: '700',
        dataUri: fontUri,
        licenseText: 'Distinct license.',
      }),
    );
    const expected = resolveProjectSetTemplate(set, set.templates[0]!.id);
    const opened = await openProjectSetArchive((await loadedArchive(set)).bytes);
    expect(resolveProjectSetTemplate(opened, opened.templates[0]!.id)).toEqual(expected);
    const asset = opened.templates[0]!.project.compositions[0]!.assets.find(
      (item) => item.id === 'font-alternate',
    )!;
    expect(asset).toMatchObject({
      fontFamily: 'Alternate Font',
      fontWeight: '700',
      licenseText: 'Distinct license.',
      dataUri: fontUri,
    });
  });

  it('keeps percent-encoded set-level payloads exactly as authored', async () => {
    const set = fixture();
    set.assets.push(
      createAsset({
        id: 'percent-set-resource',
        name: 'Percent resource',
        kind: 'image',
        mimeType: 'image/svg+xml',
        dataUri: svgUri,
      }),
    );
    const opened = await openProjectSetArchive((await loadedArchive(set)).bytes);
    expect(opened.assets.find((asset) => asset.id === 'percent-set-resource')!.dataUri).toBe(
      svgUri,
    );
  });

  it('rejects a local component colliding with a shared ID without replacing its local source', async () => {
    const set = fixture();
    const composition = set.templates[0]!.project.compositions[0]!;
    composition.components[1]!.scope = 'local';
    composition.components[1]!.name = 'Distinct local source';
    const before = structuredClone(set);
    await expect(createProjectSetArchive(set)).rejects.toThrow(
      /local component.*shared component/i,
    );
    expect(set).toEqual(before);
  });

  it('restores unplaced parents missing from a member library with stable local source ordering', async () => {
    const set = fixture();
    const last = set.templates.at(-1)!;
    last.project.compositions[0]!.components = last.project.compositions[0]!.components.filter(
      (component) => component.scope === 'local',
    );
    const compact = await openProjectSetArchive((await loadedArchive(set)).bytes);
    const compatible = await openProjectSetArchive((await loadedArchive(set, 'compatible')).bytes);
    expect(compact).toEqual(compatible);
    expect(
      compact.templates
        .at(-1)!
        .project.compositions[0]!.components.slice(0, 2)
        .map((item) => item.scope),
    ).toEqual(['local', 'local']);
  });

  it('retains unused shared sources and their embedded resources in an empty template set', async () => {
    const set = fixture();
    set.templates = [];
    delete set.activeTemplateId;
    delete set.transitionLogic;
    const compact = await openProjectSetArchive((await loadedArchive(set)).bytes);
    expect(compact.templates).toEqual([]);
    expect(compact.componentAssets).toEqual(set.componentAssets);
    expect(compact.componentAssets![0]!.resources![0]!.dataUri).toBe(fontUri);
  });
});

describe('compact archive integrity', () => {
  it('rejects altered resource bytes', async () => {
    const bytes = await mutateArchive((zip, manifest) => {
      zip.file(manifest.resources[0].path, 'data:font/woff2;base64,ZmFrZQ==');
    });
    await expect(openProjectSetArchive(bytes)).rejects.toThrow(/integrity|size|length/i);
  });

  it('rejects missing resources and an unsafe dictionary path', async () => {
    for (const kind of ['missing', 'unsafe']) {
      const bytes = await mutateArchive((zip, manifest) => {
        if (kind === 'missing') zip.remove(manifest.resources[0].path);
        else manifest.resources[0].path = '../outside.uri';
      });
      await expect(openProjectSetArchive(bytes)).rejects.toThrow(
        /missing|invalid|unsafe|resource/i,
      );
    }
  });

  it('rejects corrupt shared component source before installing it', async () => {
    const bytes = await mutateArchive((zip, manifest) => {
      zip.file(manifest.sharedComponents.path, '[]');
    });
    await expect(openProjectSetArchive(bytes)).rejects.toThrow(/integrity|checksum|component/i);
  });

  it('rejects component references with duplicate insertion positions', async () => {
    const bytes = await mutateArchive((_zip, manifest) => {
      const reference = manifest.templates[0].componentRefs[0];
      reference.indices[1] = reference.indices[0];
    });
    await expect(openProjectSetArchive(bytes)).rejects.toThrow(
      /component|indices|reference|position/i,
    );
  });

  it('rejects duplicate resource references and prototype paths', async () => {
    for (const kind of ['duplicate', 'prototype', 'missing-placeholder']) {
      const bytes = await mutateArchive(async (zip, manifest) => {
        const item = manifest.templates[0];
        const reference = item.resourceRefs[0];
        if (kind === 'duplicate') item.resourceRefs.push(structuredClone(reference));
        else if (kind === 'prototype') reference.path = ['__proto__', 'polluted'];
        else {
          const project = JSON.parse(await zip.file(item.source)!.async('string'));
          let parent = project;
          for (const part of reference.path.slice(0, -1)) parent = parent[part];
          parent[reference.path.at(-1)] = 'occupied';
          const source = JSON.stringify(project);
          zip.file(item.source, source);
          item.sha256 = await digest(source);
        }
      });
      await expect(openProjectSetArchive(bytes)).rejects.toThrow(
        /reference|path|placeholder|resource/i,
      );
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it.each(['unknown-source', 'unknown-composition', 'missing-references', 'invalid-position'])(
    'rejects %s shared component references',
    async (kind) => {
      const bytes = await mutateArchive((_zip, manifest) => {
        const item = manifest.templates[0];
        const reference = item.componentRefs[0];
        if (kind === 'unknown-source') reference.componentIds[0] = 'missing-component';
        else if (kind === 'unknown-composition') reference.compositionId = 'missing-composition';
        else if (kind === 'missing-references') delete item.componentRefs;
        else reference.indices[0] = 100_000;
      });
      await expect(openProjectSetArchive(bytes)).rejects.toThrow(/component|reference|position/i);
    },
  );

  it.each(['duplicate', 'encoding', 'length'])('rejects %s resource metadata', async (kind) => {
    const bytes = await mutateArchive((_zip, manifest) => {
      if (kind === 'duplicate') manifest.resources.push(structuredClone(manifest.resources[0]));
      else if (kind === 'encoding') manifest.resources[0].encoding = 'binary';
      else manifest.resources[0].byteLength++;
    });
    await expect(openProjectSetArchive(bytes)).rejects.toThrow(/resource|integrity/i);
  });

  it('rejects a compact archive relabelled as a pre-compact version', async () => {
    const bytes = await mutateArchive((_zip, manifest) => {
      manifest.schemaVersion = 5;
    });
    await expect(openProjectSetArchive(bytes)).rejects.toThrow(/version 6/i);
  });

  it('detects an omitted inline resource reference using the source fragment count', async () => {
    const set = fixture();
    const composition = set.templates[0]!.project.compositions[0]!;
    composition.dataFields.push(
      createFieldDefinition('image-url', {
        id: 'inline-resource',
        key: 'inlineResource',
        defaultValue: svgUri,
      }),
    );
    const { zip, manifest } = await loadedArchive(set);
    const item = manifest.templates[0];
    const index = item.resourceRefs.findIndex(
      (reference: any) => reference.path.at(-1) === 'defaultValue',
    );
    expect(index).toBeGreaterThanOrEqual(0);
    item.resourceRefs.splice(index, 1);
    zip.file('manifest.json', JSON.stringify(manifest));
    await expect(
      openProjectSetArchive(await zip.generateAsync({ type: 'uint8array' })),
    ).rejects.toThrow(/marker|reference.*count/i);
  });

  it('rejects an entry whose ZIP header advertises oversized decompressed content before inflation', async () => {
    const { bytes } = await loadedArchive();
    const patched = bytes.slice();
    const view = new DataView(patched.buffer);
    let patchedHeader = false;
    for (let offset = 0; offset <= patched.length - 46; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const length = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(patched.subarray(offset + 46, offset + 46 + length));
      if (name !== 'manifest.json') continue;
      view.setUint32(offset + 24, 5 * 1024 * 1024, true);
      patchedHeader = true;
      break;
    }
    expect(patchedHeader).toBe(true);
    await expect(openProjectSetArchive(patched)).rejects.toThrow(/entry exceeds its size limit/i);
  });
});
