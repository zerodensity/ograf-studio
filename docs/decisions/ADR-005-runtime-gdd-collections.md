# ADR-005: Deterministic GDD objects and runtime collections

- Status: **Accepted by the user — implemented and verified**
- Date: 2026-08-24
- Scope: W12b of the AI-first quality programme
- Target: EBU OGraf v1 packages rendered by Zero Density Lino and controlled through Reality Hub

## Context

W12a now emits enriched scalar GDD fields, but an OGraf schema can also contain nested `object`
properties and `array.items`. Reality Hub modules therefore cannot yet send a variable-length table,
leaderboard, lineup, or results list to one OGraf Studio template.

Objects are a schema and binding problem. Arrays are also a rendering problem: one authored item
prototype must produce a deterministic number of runtime instances without turning Hub data arrival
into animation state. The existing `create_repeater` recipe is not this feature; it permanently
materializes a fixed number of ordinary authoring layers and fields.

The vendored official GDD schemas remain authoritative. They require one schema node for
`array.items` and a keyed schema-node map for `object.properties`.

## Decision

### 1. Recursive data nodes, stable property identities

Extend the field model with `object` and `array` and represent every nested schema entry as a typed,
recursive node. Object properties retain stable authoring IDs and unique keys. Bindings compile to
key paths, not IDs, so the package contains normal JSON data only.

Conceptually:

```ts
type DataValue = string | number | boolean | null | DataValue[] | { [key: string]: DataValue };

type FieldSchemaNode =
  | ScalarFieldSchemaNode
  | { type: 'object'; properties: FieldSchemaProperty[] }
  | { type: 'array'; items: FieldSchemaNode; minItems?: number; maxItems?: number };

interface FieldSchemaProperty {
  id: string;
  key: string;
  label: string;
  description: string;
  required: boolean;
  schema: FieldSchemaNode;
}
```

The exact TypeScript factoring may preserve the current scalar field shape to control churn, but the
serialized project contract must have the same recursive semantics. Object and array defaults must
validate against their own schema before authoring, preview, save, or export.

### 2. Path-aware bindings

Add `sourcePath: string[]` to a layer binding. An empty path means the complete scalar field, as it
does today. For an object field, `['team', 'name']` resolves `data[fieldKey].team.name`.

Array fields cannot bind directly to an ordinary layer. A layer in a registered item prototype uses
the same path relative to the current array item. Missing paths leave the authored element value in
place; malformed values are validation/runtime errors reported without executing user code.

Paths are arrays rather than dot strings so keys containing dots are unambiguous and MCP clients do
not need an escaping language.

### 3. One explicit runtime-collection definition

Add `composition.runtimeCollections`. One definition contains:

- stable `id`, `name`, and array `fieldId`;
- an ordered, contiguous set of `prototypeLayerIds` that all belong to one canvas group;
- explicit `offsetPerItem: {x, y}` in composition pixels;
- integer `capacity` from 1 to 100, defaulting to 12;
- authored `overflow: 'truncate'` for the first implementation.

The editor/MCP creation helper may calculate an initial offset from vertical/horizontal direction,
the prototype's first-Step bounds, and a gap. The saved value is explicit, so later seeking and
rendering never depend on DOM measurement.

Only arrays whose `items` node is an object can drive a runtime collection in W12b.1. Scalar arrays
remain valid GDD/schema fields but do not create layers. Nested objects inside an item are supported
through `sourcePath`; nested runtime arrays are schema-valid but not repeatable in this phase.

One array field may drive at most one runtime collection in W12b.1. This keeps its `maxItems`,
overflow, update transition, and operator meaning unambiguous.

### 4. Compile a prototype, not authored duplicates

The compiler removes registered prototype layers from the ordinary compiled layer list and emits one
compiled collection at their paint-order slot. Its prototype contains the same resolved elements,
tracks, loops, clipping relations, effects, blend modes, and item-relative bindings as ordinary
compiled layers.

At runtime, the collection expands item-major in stable array-index order:

```text
content before collection
item 0: prototype layer 0..N
item 1: prototype layer 0..N
...
content after collection
```

Instance IDs are internal and derived from `(collectionId, itemIndex, prototypeLayerId)`. They are
never persisted or exposed as new OGraf fields. Each instance receives the explicit per-index
translation in addition to the prototype's sampled transform. Internal clip-parent IDs are remapped
per item.

Instances mount as normal composition children rather than inside an isolated collection stacking
context. This preserves W13 blend behavior against earlier OGraf layers. The composition root remains
the only blending isolation boundary.

### 5. Capacity and overflow are deliberate

W12b.1 supports only `truncate`:

- the manifest emits `maxItems: capacity` for operator-side validation;
- the runtime renders the first `capacity` entries if an upstream module still sends more;
- validation rejects a default array longer than capacity and reports a shorter-than-`minItems`
  default;
- capture/review reports the received count, rendered count, and truncation state.

Scroll and pagination require their own motion/action contract and are not aliases for accidental
clipping. They remain future overflow modes.

### 6. Data updates are pure snapshots

Collection instances have no arrival-order state and no per-item timers. A render is a pure function
of the compiled descriptor, the complete data snapshot at the requested time, the composition frame,
and the existing absolute loop clock.

- `load` builds the collection from the supplied/default array.
- `updateAction` replaces the array snapshot atomically. With the existing update transition, all
  affected prototype content fades out, the item set is rebuilt at the midpoint, and it fades in.
- Reordering is index-based replacement; W12b.1 does not infer identity or animate moves.
- Every item samples the same authored lifecycle tracks and loop phase. Per-item staggering is not
  inferred from data count.
- `skipAnimation` applies the new item set immediately.

### 7. Non-realtime remains deterministic

`setActionsSchedule` and `goToTime()` already replay the complete scheduled prefix from baseline.
The collection uses the array value in that derived data snapshot. It may therefore change count at a
scheduled update timestamp without losing determinism: layout is a pure index/offset calculation and
no animation duration depends on count or arrival order.

At an update crossfade, the old snapshot is used before the midpoint and the new snapshot after it,
with opacity derived from the absolute timestamp exactly like scalar updates. No mutable DOM history
is consulted. A collection implementation that cannot reproduce this under backward seeks must not
ship with `supportsNonRealTime: true`.

## Authoring and MCP surface

- The Data panel gains a recursive object/array schema tree and JSON default editor with inline
  schema-validation errors.
- A selected canvas group can be registered as an **Item Prototype** and previewed from item zero.
  Optional multi-item preview is editor-only and must use the same compiler/runtime expansion path.
- `add_data_field` and `update_data_field` accept recursive `properties`/`items` payloads while
  retaining the concise W12a scalar form.
- `set_layer_bindings` accepts `sourcePath`.
- Add `create_runtime_collection`, `update_runtime_collection`, and `remove_runtime_collection` as
  atomic revision-checked operations with field-key and group/layer selectors.
- Compact inspection returns collection IDs, names, field keys, prototype roles, capacity, overflow,
  and item-property paths. Full recursive schemas remain opt-in through project/data sections to
  protect model context.
- The authoring skill must distinguish `create_repeater` (finite source materialization) from a
  runtime GDD collection (one prototype driven by an array).

## Validation invariants

- Object property keys are unique among siblings; every path resolves to a leaf schema node.
- Array `items` exists. Runtime collections require object items and a positive bounded capacity.
- A prototype contains at least one visible layer, uses one canvas group, is contiguous in paint
  order, and is owned by only one collection.
- All item-scoped bindings point at the collection's field and a valid item path.
- Prototype clip parents stay inside the same prototype; no instance can clip to another item.
- Defaults satisfy required properties, types, scalar constraints, `minItems`, and `maxItems`.
- Guide layers and unsupported external resources cannot enter a runtime prototype.
- Collection rendering never creates OGraf lifecycle steps or invokes actions.

## Import, certification, and tests

- Official-schema tests cover nested object defaults, array object items, required paths,
  `minItems`, and `maxItems`.
- Editor-generated descriptors round-trip runtime collections. Third-party OGraf import recovers
  recursive GDD fields but does not invent a visual prototype when runtime JavaScript is opaque.
- Runtime tests cover 0, 1, capacity, and over-capacity items; nested paths; reorder/update; clipping;
  blend modes; loops; forward and backward non-realtime seeks; and update-crossfade midpoints.
- Browser proof uses a variable-length leaderboard in realtime and non-realtime modes, followed by
  all five exact-artifact certification gates.
- Final target proof is one exported package driven by a Reality Hub module and rendered in Lino.

## Consequences

This is the one approved proprietary runtime capability in the programme, but it remains packaged
inside every self-contained template and exposes only official GDD/OGraf data to controllers. It
does not move data fetching, filtering, operator UI, rundown, or business logic into OGraf Studio.

The first version deliberately chooses a bounded vertical/horizontal-style collection, synchronized
prototype animation, atomic crossfade updates, index identity, and explicit truncation. Scroll,
pagination, keyed move animation, grids, and nested repeated arrays stay out until production use
proves they are needed.

## Approval choices

The user accepted these W12b.1 choices on 2026-08-24:

1. object-item arrays drive runtime collections; scalar arrays are schema-only;
2. explicit per-item X/Y offset and capacity, default 12 and maximum 100;
3. `truncate` is the only first-version overflow mode and is also emitted as `maxItems`;
4. array updates replace by index and use one deterministic collection crossfade;
5. all instances share the prototype's lifecycle animation and absolute loop phase;
6. scheduled array-count changes are allowed because rendering is snapshot-pure and seekable.
