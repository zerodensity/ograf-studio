# OGraf web player

This dependency-free browser module mounts a **trusted**, real-time OGraf graphic from its hosted
manifest. It lets a tutorial page use the actual exported graphic and control it through the OGraf
lifecycle. It is not an editor, OGraf server, ZIP extractor, package validator or security sandbox.

## Host a package

Export and certify the graphic in Studio. Extract its `.ograf.zip` once when publishing and serve
the `.ograf.json` manifest, its `main` JavaScript module, and all other resources under the same
folder structure. Serve `ograf-player.js` alongside the site. Use HTTP(S), appropriate JavaScript
MIME types and relative paths; opening files via `file://` is not supported.

```html
<div id="example"></div>
<script type="module">
  import { mountOGrafGraphic } from './ograf-player.js';

  const player = await mountOGrafGraphic({
    container: document.querySelector('#example'),
    manifestUrl: '/graphics/lower-third/lower-third.ograf.json',
  });

  await player.play(); // Take in / advance to the next Step
  await player.update({ headline: 'Updated headline' });
  await player.stop(); // Take out
  await player.dispose(); // Release resources when leaving the example
</script>
```

Choose actual field names from `player.manifest.schema`. The example `headline` field is only a
placeholder; not every graphic has that field. Exported graphics are snapshots: re-export and
redeploy after changing their Studio source.

## API

`await mountOGrafGraphic(options)` appends a responsive viewport to the supplied `container`,
loads the manifest and module, waits for the graphic's `load()` and returns the player. It accepts:

- `container`: an HTML element in the module's document.
- `manifestUrl`: URL of a hosted `.ograf.json` manifest.
- `data`: optional initial data. If omitted, explicit schema defaults are collected recursively,
  including missing child defaults in a partially populated object default.
- `renderCharacteristics`: optional render characteristics, including `resolution: {width, height}`
  and `frameRate`. Otherwise the player uses the first manifest requirement's exact or ideal values,
  falling back to 1920×1080 and 25 fps constrained by available minimum/maximum values.
- `fit`: defaults to `true` and scales the authored canvas to the container width; `false` uses
  its pixel dimensions.
- `allowCrossOrigin`: defaults to `false`. Set `true` only when you intend to load an HTTP(S)
  manifest or main module from another origin and the server supplies suitable CORS headers.
- `signal`: optional `AbortSignal`. It cancels manifest fetch; an abort while module import or
  graphic `load()` is pending is observed after that operation settles, followed by cleanup. It
  cannot interrupt a graphic's unresolved `load()`.
- `onEvent`: optional callback for `ready`, `play`, `stop`, `update`, `action`, `dispose` and
  `error` events. Error events include `action` and `error`; successful events may include `result`.

The returned player exposes `manifest`, the graphic `element`, the chosen `renderCharacteristics`,
and promise-returning methods:

| Method                           | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `play(params?)`                  | Call `playAction`; default `{delta: 1}` advances one Step.                 |
| `next()`                         | Advance one Step, equivalent to `play({delta: 1})`.                        |
| `stop(params?)`                  | Call `stopAction`, taking the graphic out.                                 |
| `update(data, options?)`         | Call `updateAction` with the supplied data and optional action parameters. |
| `action(id, payload?, options?)` | Call `customAction` using a declared action ID and payload.                |
| `dispose()`                      | Call `dispose`, disconnect resize handling and remove this viewport.       |

Action calls are forwarded immediately and may overlap. Await them in the page when their order
matters. A failed OGraf status or rejected operation rejects its promise; handle errors in the
surrounding page. `dispose()` waits for calls already in progress and rejects new actions. The named
helper `dataFromSchemaDefaults(schema)` is also exported.

A coordinated export is one OGraf graphic. Read its `manifest.schema` and `manifest.customActions`
to build controls for its lanes. Do not instantiate its internal templates as independent graphics
or assume action IDs from another package. The included `demo.html` provides a basic manual host.

## Trust and browser limits

An OGraf package executes JavaScript in the host page. Only mount packages you trust. The default
same-origin checks for the manifest and main URL are not a security boundary: loaded code can use
the page's privileges and make its own requests. For untrusted packages, design a separate-origin
iframe with a narrowly defined message protocol and appropriate browser policy; this module does
not implement that isolation.

Cross-origin modules and dependent assets require CORS; graphic code and redirects can make further
requests. WebGL, fonts, browser autoplay, microphone/camera permissions, live sources and external
data depend on the website and browser environment. Test the actual hosted graphics and their
required permissions in the target browser. Non-real-time seeking and scheduled rendering are not
provided by this host.
