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

Chart layers use [Chart.js](https://github.com/chartjs/Chart.js), licensed under MIT. Exports
containing a chart include its upstream license at `licenses/chartjs-LICENSE.txt`.

## Exported graphic runtime

Every exported package embeds the OGraf Studio graphic runtime (`AGPL-3.0-only` with the
[OGraf Studio Runtime Exception](../packages/ograf-runtime/RUNTIME-EXCEPTION.md)) in `main.js`.
The file starts with a license banner, and the package includes the notice at
`licenses/ograf-runtime-NOTICE.txt` with the license and the source code location.
