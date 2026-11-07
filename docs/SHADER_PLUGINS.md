# Shader pack plugins

`shader-pack` plugins distribute reusable GLSL presets, not another rendering engine. Studio uses
its existing WebGL 2 single-Image-pass renderer and ordinary editable shader paints/effects.

## Install and apply

Both ZD News Shader packs are included offline and enabled on fresh installations. To add another:

1. Open **File → Preferences → OGraf Studio → Plugins → Add plugin…** and choose an `.ogsplugin.zip`.
2. Review its publisher, version, declared license, targets and GPU warning, then **Trust & Install**.
3. Select objects, open **Plugins**, choose **Shader** and select the pack's card and version.
4. Choose a compatible shader and destination: **Fill**, text **Outline**, or **Effect**.
5. Clicking a template card automatically shows it in **Shader Preview** on the right, then use **Apply**. Cards use illustrative SVG icons, not separate live shader canvases.

Drag a shader template onto a canvas object to choose **Fill**, **Outline**, or **Effect**. Empty
canvas space uses the current selection. Unavailable choices explain the shader/target restriction;
Outline requires text. Effect appends an enabled shader pass with **Normal** blending at **100%**.
Every application also saves an independent copy in **Resources → Shaders**, reusing identical
existing copies. Applying and saving are one undo step; cancelling the chooser changes no project data.

To save without applying, drag a template directly onto **Resources → Shaders**, including its
collapsed header, or click **Add to Resources**. Effect-only shaders are saved without an embedded
image: their input still comes from the layer's Effects Stack. Their Resources previews use a
temporary reference image, never stored with the shader. Resource entries can also be dragged
onto the canvas for the same destination chooser.

Resources lists saved library entries and applied Fill, Outline and shader Effect usages.
Editing an applied entry changes only its object slot or effect; library copies remain independent.
Properties retains shader parameter controls and opens the dedicated editor through **Edit shader**.

Use the gear inside the plugin card for installation settings; right-click **Manage plugin…** opens the same controls.

Each application makes independent editable copies in one undo step. Exposed `#pragma ograf`
controls remain normal Properties controls and retain existing field/animation behavior. Pack
updates install alongside old versions; they never replace source already used by templates.
Removal/disable only removes local chooser availability. Copied shaders continue to render.

Transparent generative shaders used as Normal effects on pictures blend over the incoming image;
Light Leaks no longer removes the picture at 100%. Input-reading post-processes such as Tile Reveal
retain their own output transparency. This does not change shader Fill/Outline behaviour, which
still paints the object's silhouette rather than preserving its original colours.

Parsing and review do not compile shaders. Opening a trusted, enabled pack previews
the selected shader automatically, not every shader in the name list. Only one shared preview is alive; switching selection replaces
it. Opening plugin management, switching dock tabs, or closing the pane disposes it.
GLSL is GPU code. Structural validation and a digest do not guarantee safety, performance, compiler
success or authorship. Reduce render scale and object count when necessary.

## Bundle format

Exactly three files are allowed at the ZIP root, or in one enclosing directory:

```text
manifest.json
shaders.json
LICENSE.txt
```

Example manifest:

```json
{
  "schemaVersion": 1,
  "apiVersion": 1,
  "kind": "shader-pack",
  "id": "example.shaders",
  "version": "1.0.0",
  "name": "Example shaders",
  "author": "Example publisher",
  "license": "MIT"
}
```

`shaders.json` is an array of presets containing a complete shader paint:

```json
[
  {
    "id": "blue-waves",
    "name": "Blue waves",
    "targets": ["fill", "outline"],
    "paint": {
      "type": "shader",
      "fragmentSource": "void mainImage(out vec4 c, in vec2 p) { vec2 uv=p/iResolution.xy; float v=0.5+0.5*sin(uv.x*12.0-iTime); c=vec4(vec3(0.1,0.4,0.9)*v,1.0); }",
      "speed": 1,
      "resolutionScale": 1,
      "parameters": {}
    }
  }
]
```

Optional preset `description`, `license` and `author` describe individual entries. Parameter defaults
must match declared pragmas; numeric/vector values must be finite and within their supported ranges.
Presets cannot include JavaScript, callbacks, unrecognized fields or arbitrary module imports.

Fill/Outline source referencing `iChannel0` needs its own embedded PNG/JPEG `inputImage`. Pack inputs
cannot use external URLs or template-local asset IDs. Effect source instead receives the flattened
incoming layer image as `iChannel0` and cannot attach `inputImage`. Declare `targets:["effect"]`
for effect-only programs. An effect preview uses a reference image; actual application uses the
selected layer's pixels. No additional channels, buffers, feedback, multipass, audio or video
shader-input features are introduced by this plugin type.

Limits include 64 entries, 128 KiB GLSL per entry, 2 MiB total shader definitions (including images)
and 128 KiB notices, with the existing bounded ZIP/path rules. Optional plugin icon metadata uses embedded
PNG/WebP images, not SVG or remote content.

## Portability and notices

Copied paints carry `packProvenance`: original `{id,version,sha256}`, preset ID, pack name, declared
license and notices. This is last-copied attribution, not an execution dependency or proof that later
edits still match the original source. Normal source/control edits retain it. Used shader notices
are included under `licenses/shader-packs/` in OGraf exports and deduplicated by exact origin;
unused Resources and guide-only shaders do not add runtime dependencies.

Keep applicable notices in `LICENSE.txt`. Manifest license labels do not establish redistribution
permission. **ZD News Shaders** includes presets 01–20; the separate **ZD News Shaders 2** includes
presets 21–40. Their source declares CC0-1.0; comments and credits are retained. Both packs can be
installed together. The separate older flag shader is not included.

## Build a pack

For the included source example:

```sh
npm run plugin:package:shaders
```

Build the second pack with `npm run plugin:package:shaders:2`. It has sixteen Fill/Outline presets
and four Effect-only presets: LED Matrix, Tile Reveal, Neon Sign and Heat Shimmer. Equalizer Bars
is decorative, not audio-reactive. The existing effect-alpha clipping is unchanged; use Studio's
built-in Glow after Neon Sign for a halo outside letters.

For another directory containing `manifest.json`, `shaders.json` and `LICENSE.txt`:

```sh
bun run scripts/buildShaderPackPlugin.mjs path/to/pack
```

The builder validates and creates a versioned `.ogsplugin.zip` under `release/plugins`. The examples
keep numbered GLSL source files in each pack's `src` directory. For this source-only format, the
builder checks the shader contract: standalone programs get Fill/Outline targets, while programs
requiring the incoming `iChannel0` get Effect only. For other target combinations or embedded image
inputs, declare presets explicitly in `shaders.json`.

Verify Fill/Outline silhouettes, effect input and alpha, editing, grouped apply/undo, notices,
pack removal and real-time/non-real-time seeking. For MCP, discover `sections:["plugins","shaders"]`,
read saved library paints with `get_project include:["shaders"]` and inspect layer elements/effects
for applied paints, then use normal `update_element` or shader-effect operations.
MCP does not install or trust packs.
