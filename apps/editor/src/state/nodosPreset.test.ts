import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createFieldDefinition, createProject } from '@ograf-editor/scene-model';
import {
  addNodosPresetFiles,
  buildNodosPresetDefinition,
  buildNodosRendererPage,
  NODOS_ELECTRONODE_CLASS,
  NODOS_RENDERER_PAGE,
  nodosPresetName,
} from './nodosPreset';

function composition() {
  const project = createProject();
  const main = project.compositions[0]!;
  main.width = 1920;
  main.height = 1080;
  main.frameRate = 29.97;
  return main;
}

describe('Nodos preset', () => {
  it('names the preset from its display name, in the ograf namespace', () => {
    expect(nodosPresetName('Lower Third — Breaking')).toBe('ograf.Lower_Third_Breaking');
    expect(nodosPresetName('Şampiyon')).toBe('ograf.Sampiyon');
    expect(nodosPresetName('   ')).toBe('ograf.graphic');
  });

  it('defines an ElectroNode preset that loads the renderer page at the composition size', () => {
    const definition = buildNodosPresetDefinition(composition(), {
      displayName: 'Lower Third',
      category: 'OGraf|News',
    });
    expect(definition.nodes).toHaveLength(1);
    const preset = definition.nodes[0]!;
    expect(preset.class_name).toBe('ograf.Lower_Third');
    expect(preset.kind).toBe('Preset');
    expect(preset.menu_info).toEqual({ display_name: 'Lower Third', category: 'OGraf|News' });
    expect(preset.node.class_name).toBe(NODOS_ELECTRONODE_CLASS);
    expect(preset.node.display_name).toBe('Lower Third');
    expect(preset.node.pins).toEqual([
      { name: 'URL', type_name: 'string', data: NODOS_RENDERER_PAGE },
      { name: 'Width', type_name: 'uint', data: 1920 },
      { name: 'Height', type_name: 'uint', data: 1080 },
      { name: 'FrameRate', type_name: 'uint', data: 30 },
    ]);
  });

  it('gives every data field a pin holding its default, in the Nodos type it travels as', () => {
    const main = composition();
    main.dataFields = [
      createFieldDefinition('text', {
        key: 'headline',
        label: 'Headline',
        description: 'Main line',
        defaultValue: 'Breaking',
      }),
      createFieldDefinition('number', { key: 'scale', defaultValue: 1.5 }),
      createFieldDefinition('integer', { key: 'count', defaultValue: 3 }),
      createFieldDefinition('boolean', { key: 'live', defaultValue: true }),
      createFieldDefinition('select-multiple', { key: 'tags', defaultValue: ['a', 'b'] }),
    ];
    const pins = buildNodosPresetDefinition(main, {
      displayName: 'News',
      category: 'OGraf',
    }).nodes[0]!.node.pins.slice(4);
    expect(pins).toEqual([
      {
        name: 'headline',
        display_name: 'Headline',
        description: 'Main line',
        type_name: 'string',
        show_as: 'PROPERTY',
        can_show_as: 'INPUT_PIN_OR_PROPERTY',
        data: 'Breaking',
      },
      expect.objectContaining({ name: 'scale', type_name: 'double', data: 1.5 }),
      expect.objectContaining({ name: 'count', type_name: 'int', data: 3 }),
      expect.objectContaining({ name: 'live', type_name: 'bool', data: true }),
      expect.objectContaining({ name: 'tags', type_name: 'string', data: '["a","b"]' }),
    ]);
  });

  it('refuses a data field named like a pin every ElectroNode has', () => {
    const main = composition();
    main.dataFields = [createFieldDefinition('text', { key: 'Width', defaultValue: 'x' })];
    expect(() =>
      buildNodosPresetDefinition(main, { displayName: 'News', category: 'OGraf' }),
    ).toThrow(/Rename the data field "Width"/);
  });

  it('passes changed data pins to the graphic and decodes JSON fields', () => {
    const main = composition();
    main.dataFields = [
      createFieldDefinition('text', { key: 'headline', defaultValue: 'Breaking' }),
      createFieldDefinition('select-multiple', { key: 'tags', defaultValue: [] }),
    ];
    const page = buildNodosRendererPage('News', main);
    expect(page).toContain('window.nodos?.onData(');
    expect(page).toContain('graphic.updateAction({ data })');
    expect(page).toContain('const jsonFields = new Set(["tags"]);');
  });

  it('plays the graphic with its default data and keeps the data from closing the script', () => {
    const main = composition();
    main.dataFields = [
      createFieldDefinition('text', { key: 'headline', defaultValue: '</script><b>' }),
    ];
    const page = buildNodosRendererPage('News', main);
    expect(page).toContain("import Graphic from './main.js';");
    expect(page).toContain('"renderType":"realtime"');
    expect(page).toContain('"resolution":{"width":1920,"height":1080}');
    expect(page).toContain('"headline":"\\u003c/script>\\u003cb>"');
    expect(page).not.toContain('</script><b>');
    expect(page).toContain('graphic.playAction({ delta: 1 })');
  });

  it('adds the renderer page and the node definition file to the package', async () => {
    const zip = new JSZip();
    addNodosPresetFiles(zip, 'News', composition(), {
      displayName: 'Lower Third',
      category: 'OGraf',
    });
    expect(Object.keys(zip.files).sort()).toEqual([
      NODOS_RENDERER_PAGE,
      'ograf.Lower_Third.nosnode',
    ]);
    const definition = JSON.parse(await zip.file('ograf.Lower_Third.nosnode')!.async('string'));
    expect(definition.nodes[0].node.pins[0].data).toBe(NODOS_RENDERER_PAGE);
  });
});
