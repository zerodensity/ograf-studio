# Third-party assets

## EBU OGraf logo

The editor uses the official white OGraf wordmark from the
[European Broadcasting Union's OGraf repository](https://github.com/ebu/ograf/tree/main/docs/logo).
The README title uses the official colour wordmark in light mode and white wordmark in dark mode.

- Source: `docs/logo/ograf-logo-mono-white.svg`, revision
  `c821671195a077be13bbb96989d4220eea157b99`.
- Copyright © 2026 European Broadcasting Union (EBU).
- The upstream MIT license is included in
  [ebu-ograf-LICENSE.txt](../apps/editor/public/third-party/ebu-ograf-LICENSE.txt) and distributed
  with the editor.

The logo identifies OGraf functionality; it does not indicate EBU endorsement or certification
of OGraf Studio.

The app icon uses the official [OGraf website favicon](https://ograf.ebu.io/website/assets/icons/favicon.svg)
without changes to its artwork or colours. The original SVG and PNG/Windows ICO renditions
are distributed under the same upstream license.

## Chart.js

The optional standalone Chart.js renderer plugin uses
[Chart.js](https://github.com/chartjs/Chart.js), licensed under MIT. Studio's core does not bundle
this engine. Plugin packages include the adapter and upstream notices in `LICENSE.txt`; exported
graphics retain those exact notices under their pinned plugin's directory.
Its bundled [`@kurkle/color`](https://github.com/kurkle/color) dependency is also MIT; new plugin
bundles include its full notice alongside the Chart.js notice. The adapter's AGPL declaration
does not replace the upstream components' MIT declarations.

## Plugin integrity and module inspection

Renderer plugin hashing uses [@noble/hashes](https://github.com/paulmillr/noble-hashes) under MIT.
The upstream notice is included in
[noble-hashes-LICENSE.txt](../apps/editor/public/third-party/noble-hashes-LICENSE.txt).
Module inspection uses [es-module-lexer](https://github.com/guybedford/es-module-lexer), also MIT;
its notice is included in
[es-module-lexer-LICENSE.txt](../apps/editor/public/third-party/es-module-lexer-LICENSE.txt).
Both notices are also included under `licenses/` in exported graphic packages.

## Vector shape operations

Studio uses [Paper.js](https://github.com/paperjs/paper.js) for editor-side shape
boolean operations. Paper.js is licensed under MIT; its notice is included in
[paper-LICENSE.txt](../apps/editor/public/third-party/paper-LICENSE.txt). It is not
required by exported graphics, which contain the resulting editable path geometry.

## Photoshop import

Studio uses [ag-psd](https://github.com/Agamnentzar/ag-psd), copyright © 2016 Agamnentzar,
under the MIT license. Its exact notice is distributed as
[ag-psd-LICENSE.txt](../apps/editor/public/third-party/ag-psd-LICENSE.txt). The importer also
includes [base64-js](https://github.com/beatgammit/base64-js), copyright © 2014 Jameson Little,
under [MIT](../apps/editor/public/third-party/base64-js-LICENSE.txt), and
[pako](https://github.com/nodeca/pako), copyright © 2014–2017 Vitaly Puzrin and Andrei Tuputcyn,
under [MIT](../apps/editor/public/third-party/pako-LICENSE.txt) with
[zlib-licensed code](../apps/editor/public/third-party/pako-zlib-LICENSE.txt) by Jean-loup Gailly,
Mark Adler and the pako contributors. These dependencies are used by the editor and are not
required by exported graphics.

## Bundled font library

The optional Studio font library includes Inter, Lora, Oswald and Nunito from
[Google Fonts](https://github.com/google/fonts/tree/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl).
Each variable font is distributed with its SIL Open Font License 1.1 notice under
`apps/editor/src/assets/font-library/`. Adding a font to a template embeds its original font bytes
and license in the project and exported package. `npm run font-library:check` verifies the pinned
snapshot offline; `npm run font-library:refresh` downloads the same reviewed revision and verifies
its checksums before replacing files.
