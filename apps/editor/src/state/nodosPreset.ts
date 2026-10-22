import type JSZip from 'jszip';
import type {
  Composition,
  FieldDefinition,
  FieldType,
  FieldValue,
} from '@ograf-editor/scene-model';
import { resolvePreviewDataRecord } from './previewData';

/** The page in a Nodos preset package that plays the graphic. The preset's URL names it relative to the package. */
export const NODOS_RENDERER_PAGE = 'nodos.html';

/** The Nodos node class that renders a web page as a texture. */
export const NODOS_ELECTRONODE_CLASS = 'nos.app.electronode.ElectroNode';

/** Pins every ElectroNode has; a data field cannot take their names. */
export const NODOS_ELECTRONODE_PINS = [
  'URL',
  'Width',
  'Height',
  'FrameRate',
  'ShowPreview',
  'Output',
];

export type NodosPresetOptions = {
  /** The name in the Nodos node menu. */
  displayName: string;
  /** The Nodos node menu category; `|` separates sub-categories. */
  category: string;
};

/** How a data field travels as a Nodos pin: the pin's type, and whether its value is JSON text. */
type NodosPinType = { typeName: 'string' | 'double' | 'int' | 'bool'; json: boolean };

function nodosPinType(type: FieldType): NodosPinType {
  switch (type) {
    case 'text':
    case 'textarea':
    case 'color':
    case 'image-url':
    case 'file-path':
    case 'select':
      return { typeName: 'string', json: false };
    case 'number':
    case 'percentage':
      return { typeName: 'double', json: false };
    case 'integer':
    case 'duration-ms':
      return { typeName: 'int', json: false };
    case 'boolean':
      return { typeName: 'bool', json: false };
    case 'gradient':
    case 'object':
    case 'array':
    case 'select-multiple':
      return { typeName: 'string', json: true };
  }
}

/** The preset's name in Nodos: its key in the node menu, unique among presets and classes. */
export function nodosPresetName(displayName: string): string {
  const slug = displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `ograf.${slug || 'graphic'}`;
}

/** Throws when a data field takes the name of a pin every ElectroNode has. */
function checkFieldKeys(composition: Composition): void {
  const taken = composition.dataFields.filter((field) =>
    NODOS_ELECTRONODE_PINS.includes(field.key),
  );
  if (taken.length)
    throw new Error(
      `Rename the data field${taken.length > 1 ? 's' : ''} ${taken.map((field) => `"${field.key}"`).join(', ')}: ` +
        `Nodos ElectroNodes already have pins named ${NODOS_ELECTRONODE_PINS.join(', ')}.`,
    );
}

function fieldPin(field: FieldDefinition, value: FieldValue) {
  const { typeName, json } = nodosPinType(field.type);
  return {
    name: field.key,
    display_name: field.label,
    ...(field.description.trim() ? { description: field.description.trim() } : {}),
    type_name: typeName,
    // JSON fields are mostly fed by a node, such as Pin2Json turning any Nodos type into JSON.
    show_as: json ? 'INPUT_PIN' : 'PROPERTY',
    can_show_as: 'INPUT_PIN_OR_PROPERTY',
    ...(value === null ? {} : { data: json ? JSON.stringify(value) : value }),
  };
}

/**
 * A Nodos node definition file holding one preset: an ElectroNode that loads the package's renderer page at the
 * composition's size and frame rate, with one pin per data field holding its default. URL is relative to the package;
 * whoever serves the package (RealityHub) makes it absolute before sending the preset to Nodos, since ElectroNode
 * only loads absolute HTTP, HTTPS and file URLs.
 */
export function buildNodosPresetDefinition(composition: Composition, options: NodosPresetOptions) {
  checkFieldKeys(composition);
  const defaults = resolvePreviewDataRecord(composition, {});
  const pin = (name: string, typeName: string, data: string | number) => ({
    name,
    type_name: typeName,
    data,
  });
  return {
    nodes: [
      {
        class_name: nodosPresetName(options.displayName),
        kind: 'Preset',
        menu_info: { display_name: options.displayName, category: options.category },
        node: {
          class_name: NODOS_ELECTRONODE_CLASS,
          display_name: options.displayName,
          pins: [
            pin('URL', 'string', NODOS_RENDERER_PAGE),
            pin('Width', 'uint', Math.round(composition.width)),
            pin('Height', 'uint', Math.round(composition.height)),
            pin('FrameRate', 'uint', Math.round(composition.frameRate)),
            ...composition.dataFields.map((field) => fieldPin(field, defaults[field.key] ?? null)),
          ],
        },
      },
    ],
  };
}

/** Serializes a value into an inline script without letting its text close the script element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * A page that plays the package's graphic on a transparent background, the way a playout server would: it loads the
 * graphic with its fields' default data in real time, then plays its first step. In an ElectroNode, the node's data
 * pins arrive through `window.nodos.onData`, and each change reaches the graphic through `updateAction`.
 */
export function buildNodosRendererPage(title: string, composition: Composition): string {
  checkFieldKeys(composition);
  const loadParams = {
    data: resolvePreviewDataRecord(composition, {}),
    renderType: 'realtime',
    renderCharacteristics: {
      resolution: { width: composition.width, height: composition.height },
      frameRate: composition.frameRate,
      accessToPublicInternet: false,
    },
  };
  const jsonFields = composition.dataFields
    .filter((field) => nodosPinType(field.type).json)
    .map((field) => field.key);
  const pageTitle = title.replace(/[<&]/g, '');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${pageTitle}</title>
    <style>
      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <script type="module">
      import Graphic from './main.js';
      const loadParams = ${scriptJson(loadParams)};
      const jsonFields = new Set(${scriptJson(jsonFields)});
      const applied = structuredClone(loadParams.data);
      // The fields whose pin values differ from what the graphic shows, decoded from their pins.
      function changedData(values) {
        const data = {};
        for (const [key, pinValue] of Object.entries(values)) {
          if (!(key in applied)) continue;
          let value = pinValue;
          if (jsonFields.has(key)) {
            try { value = JSON.parse(pinValue); } catch { continue; }
          }
          if (JSON.stringify(value) === JSON.stringify(applied[key])) continue;
          data[key] = value;
          applied[key] = value;
        }
        return data;
      }
      customElements.define('ograf-nodos-graphic', Graphic);
      const graphic = document.createElement('ograf-nodos-graphic');
      document.body.appendChild(graphic);
      let loaded = false;
      let pending = {};
      window.nodos?.onData((values) => {
        const data = changedData(values);
        if (!Object.keys(data).length) return;
        if (loaded) void graphic.updateAction({ data });
        else Object.assign(pending, data);
      });
      await graphic.load(loadParams);
      loaded = true;
      if (Object.keys(pending).length) await graphic.updateAction({ data: pending });
      await graphic.playAction({ delta: 1 });
    </script>
  </body>
</html>
`;
}

/** Adds the renderer page and the Nodos preset definition beside an OGraf package's files in `zip`. */
export function addNodosPresetFiles(
  zip: JSZip,
  title: string,
  composition: Composition,
  options: NodosPresetOptions,
): void {
  zip.file(NODOS_RENDERER_PAGE, buildNodosRendererPage(title, composition));
  zip.file(
    `${nodosPresetName(options.displayName)}.nosnode`,
    JSON.stringify(buildNodosPresetDefinition(composition, options), null, 2),
  );
}
