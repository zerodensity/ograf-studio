# Renderer plugins

## Manage plugins in Studio

Open **Window → Plugins** and choose **Charts** in the dockable pane beside Timeline.
Select a provider's plugin card, its exact version and a chart template below the card to
create a chart pinned to that provider, not to a different global default.
The gear inside a plugin card and **Manage plugin…** open
**File → Preferences → OGraf Studio → Plugins**. Disabled versions remain manageable but cannot
create or preview charts; existing charts keep their pins. Chart drawing uses an exact plugin
provider. Studio includes Chart.js as the initial new-chart default, while each created chart
retains its chosen version and digest. A missing pin never silently substitutes another renderer.

### Included with Studio

Every distribution includes ZD News Shaders 1 and 2, Broadcast Motion and the Chart.js renderer.
They are available offline, enabled initially and labeled **Included with Studio**. Included
versions can be disabled but cannot be uninstalled. Explicit enable/disable and chart-default
choices persist; older installed versions and existing template pins are preserved across updates.
Trust applies only to the exact bundle identities compiled into the application. Additional or
modified bundles still require review, even if their names or versions match an included pack.

**Template Set → Plugins** and **Template → Plugins** in Settings & Preferences list saved exact
requirements and usage. Installation and trust remain Studio settings. Object-specific shader,
animation and chart options remain in Properties and are saved with their template.

The source build generates the four bundles with `npm run plugins:bundle`; editor development and
production builds do this automatically. `npm run plugins:check` checks generated metadata and
archive hashes. Standalone packaging validates the distribution before embedding all four archives.

Open **File → Preferences → OGraf Studio → Plugins** to install another renderer:

1. Click **Add plugin…** and choose an `.ogsplugin.zip` file.
2. Review its identity, versions, SHA-256 digest, and component licenses.
3. Click **Trust & Install** only if you trust its code and origin.
4. Choose **Charts**, select its plugin card and version, then choose a chart template. For an existing chart, select a renderer in **Properties**.

The selected plugin's management view shows its installed versions and component declarations, distinguishing
the underlying library from Studio integration code, with separate declared versions, publishers
and licenses. Older manifests without a library license display it as undeclared unless their
explicitly named bundled notice identifies MIT; that result is labeled as coming from the notice.
Studio does not verify ownership, license compatibility, or redistribution permission.

The same preferences page also manages data-only **animation preset** plugins. Their packs
use `presets.json` rather than `renderer.js` and do not install a rendering engine; see
[Animation plugins](ANIMATION_PLUGINS.md). Chart defaults and JavaScript trust remain separate
from animation-preset application.

It also manages **shader packs** containing GLSL GPU presets, with explicit trust and selected-only
preview. They use `shaders.json` and independent copied paints rather than a new engine; see
[Shader plugins](SHADER_PLUGINS.md). Neither shader nor animation packs can become chart defaults.

Choose **Update…** on a card to select a compatible new `.ogsplugin.zip`. Review shows which
component declarations changed, including downgrade, same-version/different-hash, renamed-library,
and removed-chart-type warnings. Identical bytes and a different adapter ID are rejected. Approval
installs the new exact version alongside the old, not an upgrade of existing templates. Select an installed version for Details, Enable,
or removal. Removal confirmation explains its effect on the current template and saved projects.

API v1 packages combine adapter and library into one self-contained `renderer.js`; full license
notices stay in the package's `LICENSE.txt`. Separate-library installation, raw vendor JavaScript
updates, and commercial BYOL are not implemented; commercial permissions remain the user's
responsibility. Do not assume source/template exports omit third-party code.

Enable and disable installed versions independently; additional versions can also be removed.
Installation and default changes
do not upgrade existing charts: each chart pins an exact version and digest. Select another
renderer explicitly to change it. Local installation settings are separate from the template.
Chart creation from the selected plugin does not require a global default.
Older charts without a provider remain editable, but require a selection before rendering/export.
Changing a chart's provider preserves its other controls and removes its former snapshot only
when no layer or saved component still references it.

An `.ogs` source carries the selected renderer's source and license. Opening a template never
grants unfamiliar code execution permission. In **Plugins → Charts**, select the provider and exact version,
open its **settings gear**, choose **Review saved bundle**, then **Trust & Install** only after
reviewing and approving that exact code. New code always requires user approval; a new installed
version never upgrades existing chart pins automatically. Disabled, missing, or untrusted renderers show a blocked chart and
prevent certification/export instead of silently substituting a different renderer.

Exported OGraf graphics include their pinned code and do not need Studio's installed catalog or
a CDN. Disabling a plugin in Studio does not change graphics already exported. Import OGraf
recovers compatible pinned renderers but still requires local trust before execution.

External providers require browser ES modules, Blob module loading, and WebAssembly for module
inspection. A host's Content Security Policy must permit these features. Test the actual playout
renderer; Studio certification does not establish compatibility with every browser or host policy.

Plugins are trusted page-level JavaScript, **not sandboxed**. They can access browser APIs and
Studio data; a synchronous infinite loop cannot be stopped by a timeout. A digest identifies
content, not its author or safety. Removing a plugin disposes its chart instances, but evaluated
module side effects cannot be undone; reload Studio after removing code you no longer trust.

## Bundle format, API version 1

The first plugin API supports **chart renderers** using Studio's existing chart data, options,
and nine gallery presets. It does not add arbitrary element types, property schemas, or text
animation providers. Text segmentation and animation remain built into Studio.

An archive contains exactly three files, at its root or inside one enclosing directory:

```text
manifest.json
renderer.js
LICENSE.txt
```

Example manifest:

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "kind": "chart",
  "id": "example.chart-renderer",
  "version": "1.0.0",
  "name": "Example chart renderer",
  "presets": ["bar", "line"],
  "description": "A local chart renderer",
  "author": "Example contributors",
  "library": {
    "name": "Example Charts",
    "version": "2.0.0",
    "license": "MIT",
    "author": "Example Charts contributors",
    "homepage": "https://example.com/charts"
  },
  "license": "MIT"
}
```

Use an exact semantic version. Available presets are `bar`, `horizontal-bar`, `line`, `area`,
`stacked-bar`, `pie`, `doughnut`, `radar`, and `polar-area`. Unsupported presets are not offered for
that provider. Include all applicable license notices in `LICENSE.txt`.
Optional library `license` (up to 128 characters), `author` (up to 200), and `homepage` (HTTPS,
no credentials, up to 2048) describe the upstream component separately from the adapter's
top-level license and author. They are declarations and participate in the content digest.

Optional `icon` metadata stores an embedded PNG or WebP plugin icon, for example
`"icon": "data:image/png;base64,..."`. The decoded image file is limited to 32 KiB and must have
the matching image signature. Remote URLs, SVG, GIF, and malformed base64 are rejected.
Icon bytes participate in the plugin's content hash; no fourth archive file is needed.
The icon field cannot contain executable UI code.

`renderer.js` is a self-contained browser ES module with a default export:

```js
export default {
  apiVersion: 1,
  create(canvas, initialElement, host) {
    const context = canvas.getContext('2d');
    let element = initialElement;
    return {
      renderAtFrame(frame) {
        // Draw entirely from element, frame, and host.frameRate.
        context.clearRect(0, 0, canvas.width, canvas.height);
        const color = element.data.datasets[0]?.backgroundColor;
        context.fillStyle = (Array.isArray(color) ? color[0] : color) ?? '#36a2eb';
        context.fillRect(0, 0, canvas.width, canvas.height);
      },
      update(nextElement) {
        element = nextElement;
      },
      dispose() {
        context.clearRect(0, 0, canvas.width, canvas.height);
      },
    };
  },
};
```

The example demonstrates the lifecycle only; a production provider must implement its declared
presets and Studio's chart options. See the typed contract in
[chartProviderTypes.ts](../packages/ograf-runtime/src/chartProviderTypes.ts) and the working
[Chart.js plugin adapter](../plugins/chartjs/src/provider.ts).

`create()` may return a promise for initialization. After initialization, `renderAtFrame()`,
`update()`, and `dispose()` must be synchronous. The host supplies `apiVersion`, `frameRate`,
`chartAnimationProgress`, `normalizeChartAnimation`, and `chartAnimationEndFrame`. Initialization
has a bounded wait; late-created instances are disposed after cancellation.

Size chart output in the host's **untransformed local CSS pixels**. Editor zoom and fitted previews
apply ancestor transforms; `getBoundingClientRect()` includes those transforms and must not be used
as the chart's authored size. Keep the base chart, coverage mask and foreground in the same
coordinate space. Chart.js adapter 1.3.1 uses explicit local sizing rather than the library's
responsive measurement. It retries after an initially hidden host becomes measurable, without
shrinking backing canvases when only the ancestor zoom changes.

Derive animation from the requested frame, not `Date.now()`, timers, or uncontrolled library
animations. Backward and repeated seeks must produce the same output. Update chart data through
`update()`; retain Studio's existing binding and update-animation semantics. Certification checks
the actual exported renderer, including non-real-time seeks when requested.

### Optional chart feature contracts

The optional manifest `chartFeatures` array advertises supported extensions:
`presentation-v1`, `canonical-data-v1`, `morph-update-v1`, `mark-paint-v1`, and `mark-animation-v1`. Saved charts that
use an extension require that exact provider feature; an older pin is not replaced automatically.

`mark-paint-v1` supports the standard optional `ChartElement.fill` paint. When it is defined,
`renderAtFrame()` draws the chart's base axes/grid without chart marks. The renderer must also
implement this synchronous method, using the same sampled geometry:

```ts
renderMarkLayers(mask: HTMLCanvasElement, foreground: HTMLCanvasElement): void;
```

Clear/resize both supplied canvases to the rendered output dimensions on each sample. Draw only
mark-fill coverage into the mask's alpha; exclude axes, grid, text and borders. Draw outlines,
point details and value labels into the foreground with mark interiors transparent. Studio
composites the native solid/gradient/shader/media paint between the base and foreground. Without
`fill`, retain ordinary dataset colors and legacy gradients. Unsupported features or a missing
`renderMarkLayers()` implementation fail rendering rather than treating the whole canvas as a
paint mask.

Publish native chart paint only after the base, mark coverage and foreground represent the same
complete sampled frame. Keep these passes in the same dimensions and coordinate space through
animation and data updates; a coherent still alone does not establish coherent live output.

Native shader output must match the WebGL canvas's alpha association. For premultiplied output,
multiply final RGB by final alpha after mark coverage and straight-alpha effect blending. Zero
coverage must produce `RGBA(0,0,0,0)`. Keep authored shader colors and effect intermediates in their
existing straight-alpha form; associate RGB once at the final output boundary.

`mark-animation-v1` adds mark-local animation (Chart.js adapter 1.3.0+). Source
`ChartElement.markAnimations` holds independent In/Out pack references and duration/delay/stagger
settings. Studio compiles them to numeric curves in `CompiledLayer.chartMarkAnimations` and the
host exposes `sampleChartMarkAnimation(markIndex)`. The ordinal is dataset-major:
`datasetIndex * labels.length + index`. The sampled pose contains x/y offsets, rotation in degrees,
uniform scale, opacity, normalized clip insets and blur in pixels. Apply it around the mark's
current bounding-box center; restore Canvas state after every mark. In and Out use the layer's
lifecycle clock, not chart data-update replay time. Extra operator-supplied marks reuse the last
authored stagger slot so Out still completes within the saved window.

Chart.js supports bars, horizontal/stacked bars, pie/doughnut and polar-area sectors. Its native
element draw methods are used for normal colors and both paint passes, preserving mark outlines.
Value labels use the same transform/opacity but no mark clip or paint; axes/grid/legend stay still.
A mark In preset replaces the built-in chart entrance, while data-update morphs remain available.
Missing compiled phases, incompatible chart types and older providers fail explicitly. No
animation pack or executable animation runtime is required on the playout machine.

Shader paints use the normal composition clock and WebGL requirements. Media paints retain their
existing muted playback, live-source readiness and real-time-only restrictions. Test transparent
paints as well as opaque ones: a transparent fill must not reveal a duplicate original mark below
it. Backward/repeated frame samples and data morphs must produce matching coverage and labels.
Publish new provider bytes as a new reviewed snapshot; keep existing trusted pins unchanged.

For moving shader-filled marks, check live playback and replay as well as deterministic stills.
Compare the raw mark mask, shader coverage and final output across raster tile boundaries. Run
the same checks in Studio, standalone exports and coordinated exports, including backward and
repeated non-real-time seeks and data updates. Preserve mark animations, shader fill, authored
geometry and provider pins while diagnosing artifacts so those changes cannot conceal a failure.
Media fills remain supported with their existing playback restrictions.

Check gaps between marks and the area outside them on transparent, light and dark mattes. The
shader must not tint the plot rectangle or darken marks through a duplicate fill; partially
covered edges must preserve their intended opacity. Inspect raw shader RGBA as well as composited
output: alpha zero with nonzero RGB violates premultiplied output even when a still appears clear.

Bundle dependencies into `renderer.js`: imports, re-exports from other modules, dynamic imports,
and `import.meta` are rejected. Network dependencies are not part of the supported portable
contract. Limits are 2 MiB of source, 128 KiB of license text, and 64 KiB of manifest text; an
archive is limited to 8 MiB. A composition supports up to 16 snapshots totaling 8 MiB.

## Package the standalone Chart.js provider

From a source checkout with dependencies installed:

```sh
npm run plugin:package:chartjs
```

The result is `release/plugins/ograf-chartjs-1.0.2.ogsplugin.zip`. Its source and Chart.js dependency
live in the separate `plugins/chartjs` workspace, not in the editor/graphic runtime. Set
`OGRAF_CHART_PLUGIN_VERSION` to choose another provider version. The engine version is read from
the installed Chart.js package; the plugin version and engine version are separate identities.
Build updated provider code into a new bundle and install it without rebuilding the Studio
executable, as long as it still implements API version 1.
The adapter declares AGPL-3.0-only while the upstream Chart.js library remains MIT. The package
includes the adapter, Chart.js, and its bundled `@kurkle/color` dependency notices.

Studio computes a SHA-256 digest over canonical JSON containing the manifest, source, and
license. Project references store `{id, version, sha256}`; composition snapshots retain those
exact inputs. Exports additionally include readable copies under
`plugins/<id>/<version>/<sha256>/`. Mismatched source or licenses fail validation.

MCP exposes the contract through `get_capabilities` with `sections: ["plugins"]` and project
metadata through `get_project` with `include: ["plugins"]`. Plugin installation and trust remain
human Plugins pane actions; MCP does not silently install or approve code.
For explicitly requested source cleanup, `remove_renderer_plugin` removes one exact unused
composition snapshot. It refuses references still used by layers, guides, prototypes, or saved
components, and never changes installed plugins or trust.
