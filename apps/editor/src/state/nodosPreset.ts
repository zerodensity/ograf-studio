import {
  getCompositionOutputRect,
  type Composition,
  type FieldValue,
} from '@ograf-editor/scene-model';
import {
  publicDataForExport,
  publicNodosComposition,
  buildNodosInputDeclarations,
  buildNodosInputContract,
  NODOS_INPUT_RUNTIME,
} from '@ograf-editor/codegen';
export { buildNodosInputDeclarations, NODOS_ELECTRONODE_PINS } from '@ograf-editor/codegen';
import { sha256 } from '@noble/hashes/sha2.js';
import { resolvePreviewDataRecord } from './previewData';

/** The page in a preset's files that plays the graphic. The preset's URL names it relative to the files. */
export const NODOS_RENDERER_PAGE = 'nodos.html';

/** The Nodos node class that renders a web page as a texture. */
export const NODOS_ELECTRONODE_CLASS = 'nos.app.electronode.ElectroNode';

/** A file the preset's page needs, as Studio's server serves it to Nodos. */
export type NodosPackageFile = { path: string; base64: string };

export type NodosPresetOptions = {
  /** The name in the Nodos node menu. */
  displayName: string;
  /** The Nodos node menu category; `|` separates sub-categories. */
  category: string;
};

/** The preset's name in Nodos: its key in the node menu, unique among presets and classes. */
export function nodosPresetName(displayName: string): string {
  const slug = displayName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `ograf.${slug || 'graphic'}`;
}

/** Sync classes use the full stable template ID; their human-readable menu names can change. */
export function nodosTemplatePresetName(templateId: string): string {
  // Nodos limits preset names to 128 characters. A full digest keeps IDs of any length
  // distinct without truncating identity or coupling the class to a display-name slug.
  const identity = [...sha256(new TextEncoder().encode(templateId))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `ograf.template_${identity}`;
}

/** Defaults use the same resource resolution as Studio's preview. */
function publicNodosDefaults(composition: Composition): Record<string, FieldValue> {
  return publicDataForExport(composition, resolvePreviewDataRecord(composition, {})) as Record<
    string,
    FieldValue
  >;
}

/**
 * A Nodos preset definition, as Nodos takes it in a SetNodePresetsRequest: an ElectroNode that loads the renderer page
 * at the composition's output size; its page declares required slots and the ElectroNode renders
 * at the frame rate of the Nodos thread that pulls it. URL is relative to the preset's files; Studio's server, which
 * serves them, makes it absolute before sending the preset, since ElectroNode only loads absolute HTTP, HTTPS and file
 * URLs.
 */
export function buildNodosPresetDefinition(composition: Composition, options: NodosPresetOptions) {
  buildNodosInputDeclarations(composition);
  const output = getCompositionOutputRect(composition);
  const pin = (name: string, typeName: string, data: string | { x: number; y: number }) => ({
    name,
    type_name: typeName,
    data,
  });
  return {
    name: nodosPresetName(options.displayName),
    menu_info: { display_name: options.displayName, category: options.category },
    node: {
      class_name: NODOS_ELECTRONODE_CLASS,
      display_name: options.displayName,
      pins: [
        pin('URL', 'string', NODOS_RENDERER_PAGE),
        pin('Resolution', 'nos.fb.vec2u', {
          x: Math.round(output.width),
          y: Math.round(output.height),
        }),
      ],
    },
  };
}

/** Serializes a value into an inline script without letting its text close the script element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * A page that plays the package's graphic on a transparent background, the way a playout server would: it loads the
 * graphic with its public fields' default data in real time, then plays its first step. In an ElectroNode, the node's data
 * pins arrive through `window.nodos.onData`, and each change reaches the graphic through `updateAction`.
 */
export function buildNodosRendererPage(title: string, composition: Composition): string {
  const contract = buildNodosInputContract(composition);
  if ('error' in contract) throw new Error(contract.error);
  composition = publicNodosComposition(composition);
  const output = getCompositionOutputRect(composition);
  const loadParams = {
    data: publicNodosDefaults(composition),
    renderType: 'realtime',
    renderCharacteristics: {
      resolution: { width: output.width, height: output.height },
      frameRate: composition.frameRate,
      accessToPublicInternet: false,
    },
  };
  const inputs = contract.inputs;
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
    <script id="nodos-inputs" type="application/json">${scriptJson(inputs)}</script>
    <script type="module">
      import Graphic from './main.js';
      ${NODOS_INPUT_RUNTIME}
      const loadParams = ${scriptJson(loadParams)};
      const report = (error) => console.error('Nodos graphic:', error);
      const binding = createNodosInputBinding(${scriptJson(contract)}, loadParams.data, report);
      function checked(result, action) {
        if (result && result.statusCode >= 400)
          throw new Error(action + ': ' + (result.statusMessage || result.statusCode));
      }
      customElements.define('ograf-nodos-graphic', Graphic);
      const graphic = document.createElement('ograf-nodos-graphic');
      document.body.appendChild(graphic);
      const load = async () => checked(await graphic.load(loadParams), 'Nodos graphic load failed');
      const play = async () => checked(await graphic.playAction({ delta: 1 }), 'Nodos graphic play failed');
      if (binding) await binding.start(graphic, load, play);
      else await load().then(play).catch(report);
    </script>
  </body>
</html>
`;
}
