import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFieldDefinition,
  createFieldDefinitionFromInput,
  createProject,
  migrateProject,
} from '@ograf-editor/scene-model';
import { buildNodosInputDeclarations } from './nodosPreset';
import {
  fieldStructureForNodosType,
  clearNodosTypes,
  loadNodosTypes,
  setNodosTypes,
  useNodosTypes,
  type NodosObjectType,
  type NodosTypeList,
  type NodosTypesResult,
} from './nodosTypes';
import { createProjectSet, createProjectSetArchive, openProjectSetArchive } from './projectSet';
import { useProjectStore } from './projectStore';
import { validateProject } from '@ograf-editor/validation';

const requestTypes = vi.hoisted(() => vi.fn());

const scalar = (base: string) => ({ base, element: 'None', fixedLength: 0 });
const TYPES: NodosTypeList = {
  objects: [
    {
      name: 'nos.fb.vec4',
      isStruct: true,
      attributes: { builtin: '' },
      fields: ['x', 'y', 'z', 'w'].map((name) => ({
        name,
        type: scalar('Float'),
        deprecated: false,
        dynamic: false,
      })),
    },
    {
      name: 'test.Lineup',
      isStruct: false,
      attributes: {},
      fields: [
        { name: 'title', type: scalar('String'), deprecated: false, dynamic: false },
        {
          name: 'side',
          type: { ...scalar('Byte'), enum: 'test.Side' },
          deprecated: false,
          dynamic: false,
        },
        {
          name: 'tint',
          type: { ...scalar('Obj'), object: 'nos.fb.vec4' },
          deprecated: false,
          dynamic: false,
        },
        {
          name: 'scores',
          type: { base: 'Vector', element: 'Int', fixedLength: 0 },
          deprecated: false,
          dynamic: false,
        },
      ],
    },
    {
      name: 'nos.sys.vulkan.Texture',
      isStruct: false,
      attributes: { resource: '' },
      fields: [{ name: 'handle', type: scalar('ULong'), deprecated: false, dynamic: false }],
    },
    {
      name: 'nos.Dict',
      isStruct: false,
      attributes: {},
      fields: [
        {
          name: 'entries',
          type: { base: 'Vector', element: 'Obj', object: 'nos.DictEntry', fixedLength: 0 },
          deprecated: false,
          dynamic: false,
        },
      ],
    },
  ],
  enums: [
    { name: 'test.Side', isUnion: false, values: ['Left', 'Right'] },
    { name: 'test.Contents', isUnion: true, values: ['NONE', 'A'] },
  ],
};

vi.mock('./agentBridge', () => ({
  requestNodosTypes: requestTypes,
}));

function object(name: string, type: NodosObjectType['fields'][number]['type']): NodosObjectType {
  return {
    name,
    isStruct: false,
    attributes: {},
    fields: [{ name: 'value', type, deprecated: false, dynamic: false }],
  };
}
function deferred() {
  let resolve!: (value: NodosTypesResult) => void;
  const promise = new Promise<NodosTypesResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Nodos types for data fields', () => {
  beforeEach(async () => {
    clearNodosTypes();
    requestTypes.mockReset().mockResolvedValue({ ok: true, ...structuredClone(TYPES) });
    await loadNodosTypes('localhost:50052');
  });

  it('offers the structs, tables and enums a field can hold', () => {
    expect(useNodosTypes.getState().choices).toEqual(['nos.fb.vec4', 'test.Lineup', 'test.Side']);
  });

  it('gives a field the structure of its Nodos type', () => {
    const lineup = fieldStructureForNodosType('test.Lineup', 'lineup');
    expect(lineup.type).toBe('object');
    expect(lineup.nodosType).toBe('test.Lineup');
    expect(lineup.properties.map((property) => [property.key, property.type])).toEqual([
      ['title', 'text'],
      ['side', 'select'],
      ['tint', 'object'],
      ['scores', 'array'],
    ]);
    expect(lineup.properties[1]!.options.map((option) => option.value)).toEqual(['Left', 'Right']);
    expect(
      lineup.properties[2]!.properties.map((property) => [property.key, property.type]),
    ).toEqual([
      ['x', 'number'],
      ['y', 'number'],
      ['z', 'number'],
      ['w', 'number'],
    ]);
    expect(lineup.properties[3]!.items?.type).toBe('integer');
    expect(lineup.defaultValue).toEqual({
      title: '',
      side: 'Left',
      tint: { x: 0, y: 0, z: 0, w: 0 },
      scores: [],
    });
    expect(fieldStructureForNodosType('test.Side', 'side')).toMatchObject({
      type: 'select',
      defaultValue: 'Left',
    });
  });

  it('gives a tagged field a Nodos pin of its type', () => {
    const project = createProject();
    const main = project.compositions[0]!;
    main.dataFields = [
      {
        ...createFieldDefinition('object', { key: 'tint' }),
        ...fieldStructureForNodosType('nos.fb.vec4', 'tint'),
      },
    ];
    main.nodosInputFieldIds = [main.dataFields[0]!.id];
    expect(buildNodosInputDeclarations(main)).toContainEqual({ name: 'tint', type: 'nos.fb.vec4' });
  });

  it('rejects unsupported, recursive, dynamic and excessive reflected structures before constructing fields', () => {
    const bad = [
      object('test.Unknown', scalar('SomethingNew')),
      object('test.MissingObject', { ...scalar('Obj'), object: 'test.Absent' }),
      object('test.Union', { ...scalar('Union'), enum: 'test.Contents' }),
      object('test.UnionEnum', { ...scalar('Int'), enum: 'test.Contents' }),
      object('test.MissingEnum', { ...scalar('Int'), enum: 'test.NoEnum' }),
      object('test.Cycle', { ...scalar('Obj'), object: 'test.Cycle' }),
      object('test.TextureHolder', { ...scalar('Obj'), object: 'nos.sys.vulkan.Texture' }),
      object('test.Vector64', { base: 'Vector64', element: 'Int', fixedLength: 0 }),
      object('test.EmptyFixed', { base: 'Array', element: 'Int', fixedLength: 0 }),
      object('test.LargeFixed', { base: 'Array', element: 'Int', fixedLength: 101 }),
      object('test.InnerArrays', { base: 'Vector', element: 'Array', fixedLength: 4 }),
      object('test.HugeDefaults', {
        base: 'Array',
        element: 'Obj',
        object: 'test.Hundred',
        fixedLength: 100,
      }),
    ];
    const dynamic = object('test.Dynamic', scalar('Int'));
    dynamic.fields[0]!.dynamic = true;
    const reserved = object('test.Reserved', scalar('String'));
    reserved.fields[0]!.name = '__proto__';
    setNodosTypes(
      {
        ...TYPES,
        objects: [
          ...TYPES.objects,
          ...bad,
          dynamic,
          reserved,
          object('test.Hundred', { base: 'Array', element: 'Int', fixedLength: 100 }),
        ],
      },
      'localhost:50052',
    );
    for (const entry of [...bad, dynamic, reserved]) {
      expect(useNodosTypes.getState().choices).not.toContain(entry.name);
      expect(() => fieldStructureForNodosType(entry.name, 'value')).toThrow(
        'unavailable or is not supported',
      );
    }
    expect(useNodosTypes.getState().choices).toContain('test.Hundred');
  });

  it('builds fixed arrays with independent defaults, typed enum/vector children and safe integer bounds', () => {
    const fixed = object('test.Fixed', {
      base: 'Array',
      element: 'Obj',
      object: 'nos.fb.vec4',
      fixedLength: 2,
    });
    const integers: NodosObjectType = {
      ...object('test.Integers', scalar('Long')),
      fields: [
        { name: 'signed', type: scalar('Long'), deprecated: false, dynamic: false },
        { name: 'unsigned', type: scalar('ULong'), deprecated: false, dynamic: false },
      ],
    };
    setNodosTypes({ ...TYPES, objects: [...TYPES.objects, fixed, integers] }, 'localhost:50052');
    const field = fieldStructureForNodosType('test.Fixed', 'fixed');
    const array = field.properties[0]!;
    expect(array.constraints).toMatchObject({ minItems: 2, maxItems: 2 });
    expect(array.items).toMatchObject({ type: 'object', nodosType: 'nos.fb.vec4' });
    const values = array.defaultValue as Array<Record<string, number>>;
    values[0]!.x = 9;
    expect(values[1]!.x).toBe(0);
    const schema = fieldStructureForNodosType('test.Lineup', 'lineup');
    expect(schema.properties[1]!.nodosType).toBe('test.Side');
    expect(schema.properties[2]!.properties[0]!.constraints).toMatchObject({
      minimum: -3.4028234663852886e38,
      maximum: 3.4028234663852886e38,
    });
    const ranges = fieldStructureForNodosType('test.Integers', 'integers').properties;
    expect(ranges[0]!.constraints).toMatchObject({
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(ranges[1]!.constraints).toMatchObject({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
  });

  it('ignores stale engine fetches and pushed catalogs after address changes or disable/disconnect', async () => {
    const old = deferred(),
      next = deferred();
    requestTypes.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const loadingOld = loadNodosTypes('localhost:50053');
    const loadingNext = loadNodosTypes('localhost:50054');
    expect(useNodosTypes.getState().choices).toEqual([]);
    next.resolve({
      ok: true,
      objects: [],
      enums: [{ name: 'new.Side', isUnion: false, values: ['A'] }],
    });
    await loadingNext;
    old.resolve({ ok: true, ...TYPES });
    await loadingOld;
    setNodosTypes(TYPES, 'localhost:50053');
    expect(useNodosTypes.getState().address).toBe('localhost:50054');
    expect(useNodosTypes.getState().choices).toEqual(['new.Side']);
    const disconnected = deferred();
    requestTypes.mockReturnValueOnce(disconnected.promise);
    const loadingDisconnected = loadNodosTypes('localhost:50054');
    clearNodosTypes();
    disconnected.resolve({ ok: true, ...TYPES });
    await loadingDisconnected;
    setNodosTypes(TYPES, 'localhost:50054');
    expect(useNodosTypes.getState().address).toBeNull();
    expect(useNodosTypes.getState().choices).toEqual([]);
  });

  it('keeps a newer engine push instead of replacing it with an older pending request', async () => {
    const pending = deferred();
    requestTypes.mockReturnValueOnce(pending.promise);
    const loading = loadNodosTypes('localhost:50052');
    setNodosTypes(
      { objects: [], enums: [{ name: 'new.Current', isUnion: false, values: ['Now'] }] },
      'localhost:50052',
    );
    pending.resolve({ ok: true, ...TYPES });
    await loading;
    expect(useNodosTypes.getState().choices).toEqual(['new.Current']);
  });

  it('preserves hidden nested controls when assigning a type and persists selected types in single and compact source', async () => {
    const original = createFieldDefinition('object', {
      key: 'lineup',
      label: 'Lineup',
      ...fieldStructureForNodosType('test.Lineup', 'lineup'),
    });
    original.exposeToOgraf = false;
    original.properties[0]!.exposeToOgraf = false;
    original.properties[2]!.properties[0]!.exposeToOgraf = false;
    const titleId = original.properties[0]!.id;
    const project = createProject();
    project.compositions[0]!.dataFields.push(original);
    useProjectStore.getState().loadProject(project);
    useProjectStore
      .getState()
      .updateDataField(original.id, fieldStructureForNodosType('test.Lineup', 'lineup', original));
    const updated = useProjectStore.getState().project;
    const field = updated.compositions[0]!.dataFields[0]!;
    expect(field).toMatchObject({
      id: original.id,
      label: 'Lineup',
      nodosType: 'test.Lineup',
      exposeToOgraf: false,
    });
    expect(field.properties[0]).toMatchObject({ id: titleId, exposeToOgraf: false });
    expect(field.properties[2]!.properties[0]!.exposeToOgraf).toBe(false);
    expect(validateProject(updated).valid).toBe(true);
    const single = migrateProject(JSON.parse(JSON.stringify(updated)));
    const archive = await createProjectSetArchive(createProjectSet('Typed fields', updated));
    const reopened = await openProjectSetArchive(new Uint8Array(await archive.arrayBuffer()));
    for (const saved of [single, reopened.templates[0]!.project])
      expect(saved.compositions[0]!.dataFields[0]).toEqual(field);
    useProjectStore.getState().updateDataField(original.id, {
      type: 'text',
      properties: [],
      items: null,
      defaultValue: 'Native text',
    });
    expect(
      useProjectStore.getState().project.compositions[0]!.dataFields[0]!.nodosType,
    ).toBeUndefined();
  });

  it('retains Nodos metadata from recursive authoring inputs and validates names without an engine connection', () => {
    const field = createFieldDefinitionFromInput({
      fieldType: 'object',
      key: 'lineup',
      nodosType: 'test.Lineup',
      defaultValue: { side: 'Left' },
      properties: [
        {
          fieldType: 'select',
          key: 'side',
          nodosType: 'test.Side',
          options: [{ value: 'Left', label: 'Left' }],
          defaultValue: 'Left',
        },
      ],
    });
    const project = createProject();
    project.compositions[0]!.dataFields.push(field);
    expect(validateProject(project).valid).toBe(true);
    expect(field.properties[0]!.nodosType).toBe('test.Side');
    for (const invalid of ['', 'bad type', 'a'.repeat(257), 'type/../../escape']) {
      field.properties[0]!.nodosType = invalid;
      expect(validateProject(project).errors.some((error) => error.includes('nodosType'))).toBe(
        true,
      );
    }
  });
});
