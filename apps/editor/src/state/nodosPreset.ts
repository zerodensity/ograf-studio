import type JSZip from 'jszip';
import type { Composition } from '@ograf-editor/scene-model';
import { resolvePreviewDataRecord } from './previewData';

/** The page in a Nodos preset package that plays the graphic. The preset's URL names it relative to the package. */
export const NODOS_RENDERER_PAGE = 'nodos.html';

/** The Nodos node class that renders a web page as a texture. */
export const NODOS_ELECTRONODE_CLASS = 'nos.app.electronode.ElectroNode';

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

/**
 * A Nodos node definition file holding one preset: an ElectroNode that loads the package's renderer page at the
 * composition's size and frame rate. URL is relative to the package; whoever serves the package (RealityHub) makes it
 * absolute before sending the preset to Nodos, since ElectroNode only loads absolute HTTP, HTTPS and file URLs.
 */
export function buildNodosPresetDefinition(composition: Composition, options: NodosPresetOptions) {
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
 * graphic with its fields' default data in real time, then plays its first step.
 */
export function buildNodosRendererPage(title: string, composition: Composition): string {
  const loadParams = {
    data: resolvePreviewDataRecord(composition, {}),
    renderType: 'realtime',
    renderCharacteristics: {
      resolution: { width: composition.width, height: composition.height },
      frameRate: composition.frameRate,
      accessToPublicInternet: false,
    },
  };
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
      customElements.define('ograf-nodos-graphic', Graphic);
      const graphic = document.createElement('ograf-nodos-graphic');
      document.body.appendChild(graphic);
      await graphic.load(${scriptJson(loadParams)});
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
