# JavaScript expressions and scripts

[Using Studio](USER_GUIDE.md)

The Scripts tab provides JavaScript syntax highlighting, line numbers, indentation, and bracket
matching. Edits save directly with Studio's Undo/Redo. Expression checkboxes toggle only when
the checkbox itself is activated; clicking the property name does not toggle it.

## Property expressions

Open **Scripts > Layer expressions** for a selected layer. An expression controls `x`, `y`,
`width`, `height`, `rotation`, or `opacity` (0 to 1). Return a finite number, either as a
formula or from a JavaScript statement body:

```js
layer('Background').x + 20;
```

```js
const target = layer('Background');
return Math.max(target.width - thisLayer.width, 0) / 2;
```

Empty or disabled expressions retain the sampled animation value. Errors appear beside the
field and retain that property's sampled value; unrelated properties still evaluate.
Layer dependencies resolve lazily, independently of layer order. Circular dependencies are errors.

`value` is the current property's sampled value before its expression. The equivalent
`thisProperty.value` is accompanied by `thisProperty.name` and `thisProperty.layerId`:

```js
value + data.layout.padding;
```

`thisLayer.id/name` identify the expression's layer. `layer("Title").id/name` and
`layerById(id).id/name` identify a referenced layer without evaluating its transforms.
Metadata is read-only and non-enumerable on layer objects, so spreading a layer still copies
only transform values. Collection references report the evaluated item's runtime ID.

## Composition script and shared files

Open **Scripts > Composition & modules** and select **Composition (each frame)**.
Code edits save directly to the project, like layer expressions. **Composition script enabled**
turns the composition script on or off immediately. Syntax errors appear below the editor and
do not prevent toggling execution. Use the normal project Undo/Redo to undo code edits.
Scripts run after property
expressions, so their assignments win for that frame:

```js
const title = layer('Title');
title.x += 20;
layer('Background').width = title.width + 40;
```

The same six properties are writable. Reads observe earlier script assignments; property
expressions are not rerun after writes. Each evaluation starts from a fresh animation pose,
so assignments do not edit keyframes or accumulate between frames. If the script throws or
writes an invalid value, all of its layer writes are discarded. Errors appear in Scripts.

Use **Import .js files** or **New module** for reusable functions. For example, `helpers.js`:

```js
export function spacing(index, gap) {
  return index * gap;
}
```

Both property expressions and the composition script can call `helpers.spacing(3, 100)`.
Module functions receive frame data and layer references through arguments; they do not inherit
`layer`, `frame`, or `data` from their caller. For example:

```js
// helpers.js
export function move(target, offset) {
  target.x += offset;
}
// Composition script
helpers.move(layer('Title'), data.offset);
```

References passed by property expressions remain read-only. Use pure functions for expressions;
perform layer assignments from the composition script.
Included files can import and re-export each other with explicit relative paths:

```js
import { spacing } from './helpers.js';
export const offset = (index) => spacing(index, 40);
```

The filename's basename is its namespace, also available as `modules.helpers`. Filenames must
use a JavaScript identifier followed by `.js` or `.mjs`, and cannot conflict with API names or
the fixed reserved list of standard JavaScript globals and `console`. Host-specific globals
such as `window` and `process` do not affect filename validity; a matching module alias shadows
that host global in expressions and composition scripts. The file list is flat; directory,
npm and network imports, import cycles, and top-level
await are unsupported. `import` statements belong in module files; script bodies use namespaces.
Modules initialize on first use. Playback instances keep their own module state until the next
dispose/reload; SVG snapshots start with fresh modules. Editing scripting settings also resets state.
Prefer pure functions so seeking remains repeatable. Variables declared inside an expression or
composition script are local to that evaluation; share constants and functions through module exports.

Project recovery preserves incomplete or duplicate module filenames so interrupted edits can be
corrected. The Scripts tab reports these errors, and export requires valid, unique module names.

## API

| Value                                               | Meaning                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `value`, `thisProperty.value`                       | Sampled value of the current property before its expression.                     |
| `thisProperty.name`, `thisProperty.layerId`         | Current property name and runtime layer ID; property expressions only.           |
| `thisLayer`                                         | Sampled transform before expressions; property expressions only.                 |
| `x`, `y`, `width`, `height`, `rotation`, `opacity`  | Shorthand for the sampled transform in a property expression.                    |
| `layer("Name")`                                     | Computed transform of a uniquely named layer. Read-only in property expressions. |
| `layerById("id")`                                   | Same lookup by stable layer ID.                                                  |
| `frame`, `time`                                     | Composition playhead in frames and seconds.                                      |
| `comp.width`, `comp.height`                         | Composition dimensions.                                                          |
| `data.key`                                          | Read-only input data, including objects, arrays, booleans and null.              |
| `timeline.startFrame`, `timeline.endFrame`          | Authored start and end boundaries.                                               |
| `timeline.firstStepFrame`, `timeline.lastStepFrame` | First and last Step boundaries, when present.                                    |
| `timeline.exitProgress`                             | Exit progress, including a direct Stop transition.                               |
| `lerp(a, b, t)`, `clamp(value, min, max)`           | Numeric interpolation and bounds.                                                |
| `ease(a, b, t, preset)`                             | Interpolation using an existing Studio easing preset.                            |

Layer names do not become JavaScript globals: use `layer("Title").x`, not `Title.x`.
`Object.keys`, object spread, and JSON serialization work on the supplied objects. Listing a
layer's keys does not evaluate its properties; copying values does create dependencies.

Within collection property expressions, name and prototype-ID lookups prefer siblings in the
same item, then global layers. Composition scripts require unique evaluated names or exact
runtime IDs; duplicated collection names are ambiguous. `data` preserves nested fields and arrays.

Data is a detached, deeply frozen snapshot shared by the frame's expressions and composition
script. Use `data.scoreboard.home.name`, `data.rows[0].score`, or bracket notation for literal
field names such as `data["home.score"]`. Helper functions receive the same read-only data.

Booleans now remain JavaScript `true`/`false`, replacing the earlier draft's numeric flags.
Use `data.visible === true` or `data.visible ? 1 : 0`; use `Number(data.visible)` when a numeric
flag is needed. Expressions must still return a finite number. Existing strict checks against
`1` or `0` should be updated. Array/object fields are available without adding new expression
result types.

The playhead follows OGraf Steps, holds, and Stop transitions; it is not wall-clock elapsed time.
Scripts do not schedule actions. Existing OGraf lifecycle behavior remains unchanged.

## Sampling time and content bounds

Times are composition seconds, including fractional frames, clamped to the authored timeline.
`valueAtTime(seconds)` and `thisProperty.valueAtTime(seconds)` sample the current property's
authored animation before expressions and composition-script writes. This supports a delay
without recursively evaluating the expression:

```js
valueAtTime(time - 0.2);
```

Use `layer("Title").property("x").valueAtTime(time - 0.2)` for another property.
`property(name).value` reads that reference's current value; `valueAtTime` always reads authored
animation. The six supported transform properties are available. Sampling does not seek the
playhead or replay OGraf lifecycle actions, held loops, or previous data updates.

`layer("Title").sourceRectAtTime(seconds = time, includeExtents = false)` returns a read-only
`{ left, top, width, height }` in local layer pixels, before position, rotation, expressions,
masks and effects. In a property expression, `sourceRectAtTime()` and
`thisLayer.sourceRectAtTime()` address the current layer.

```js
layer('Title').sourceRectAtTime(time).width + 40;
```

Text uses the current bound content and browser font/wrapping/fitting code with the authored
box at the requested time. Empty text has zero bounds. Editable paths use their path bounds;
other sources use their authored source box, not a pixel-alpha scan. `includeExtents` includes
stroke expansion; it does not include shadows, filters or masks. These semantics are not a
complete clone of AE's method.

Measurements are cached by text layout and authored box, invalidated when fonts change, and
never alter live layers. The lightweight
SVG overview lacks browser font metrics and uses the authored text box; Studio and exported
browser graphics measure text. Use browser capture for accurate text-dependent output.

## Execution and portability

Expressions and scripts are trusted JavaScript executed synchronously by the host engine,
without a sandbox or timeout. `console.log`, `info`, `warn`, `error`, and `debug` appear in the Scripts tab console and the native console. The Studio log shows the source and frame, groups consecutive repeats, and retains the latest 200 entries. Clear removes the history; Pause logs stops collection without pausing playback. Log history is not saved with the project. Infinite loops can block
the host, and async work is unsupported for frame calculations. Use current frame/data values
rather than persistent counters or external side effects for deterministic playback.

Returned promises are rejected with a synchronous-only diagnostic and their rejections are
consumed. This does not contain detached asynchronous work started by trusted JavaScript.
Failed composition scripts discard their layer writes; module state and external side effects
are not rolled back. Active layer expressions retain compiled code (or syntax errors) until
their source changes, independently of the bounded cache used for standalone evaluations.

Source, enable flags, and modules survive `.ogs` reload and compiled `.ograf` export/import.
The exported descriptor embeds module source; the original files are not needed at playback.
[Sucrase](https://github.com/alangpierce/sucrase) handles module import/export syntax.
The composition's `expressionApiVersion` defaults to v1; unsupported versions report errors
and retain sampled values. This is Studio's API version, not a JavaScript language version.

The shared evaluator is used by Studio, SVG snapshots, and exported graphics. References use
the renderer's sampled layer boxes; scripting does not change text auto-sizing behavior.
Tests cover dependencies, errors, module loading, seeking, lifecycle timing, and export/import.
