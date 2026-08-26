# ADR-007: Declarative conditional visibility instead of a scripting escape hatch

- Status: **Accepted by the user — not yet implemented**
- Date: 2026-08-24
- Scope: W14 of the AI-first quality programme
- Target: EBU OGraf v1 packages rendered by Zero Density Lino and controlled through Reality Hub

## Context

OGraf Studio cannot data-drive whether a layer appears. `BINDABLE_PROPERTIES`
(`apps/editor/src/state/dataBinding.ts:18`) exposes element paint and content only:

```
text: content, color | image: src | rectangle/ellipse/path: fill
image-sequence: (none) | lottie: (none)
```

Ordinary broadcast requirements are therefore inexpressible in a single template: a red-card icon
shown only when a player has one, a subheadline hidden when the field is empty, a stat panel whose
rows differ per sport. The only current workaround is authoring a separate template per variant,
which multiplies the maintenance surface and defeats the point of data-driven graphics.

Loopic — the product this one is measured against — solves this with its **Actions API**, documented
as the path for "conditional looping, fetch data" when the visual tool is insufficient. That is an
arbitrary-JavaScript escape hatch.

Copying it would forfeit this project's central guarantee. Arbitrary script in a template makes
`goToTime()` determinism unprovable, so `supportsNonRealTime` becomes an unverifiable claim and the
exact-artifact certification gate loses its meaning. The same reasoning already governs the OGraf
importer, which deliberately refuses to execute third-party JavaScript.

The "fetch data" half of that escape hatch is also redundant here: under
[ADR-006](./ADR-006-in-app-byok-agent.md) and the deployment context, external data acquisition and
business logic belong to Reality Hub modules, not to the template.

## Decision

- **Do not add a scripting escape hatch.** No arbitrary JavaScript, no expression language capable
  of side effects, no data fetching from inside a template.
- **Add `visible` as a layer-level data-binding target**, driven by an optional declarative condition
  on the binding row.
- Restrict conditions to a small deterministic set: `is-empty`, `is-not-empty`, `equals`,
  `not-equals`, `greater-than`, `less-than`. No expressions, no chaining, no arithmetic.
- Evaluate conditions at data-set time and resolve to an ordinary boolean. The compiled descriptor
  carries a declarative binding, never executable logic.
- Where a straight value mapping suffices, reuse the existing `LayerBinding.valueMap`
  (`packages/scene-model/src/types.ts:133`) rather than introducing a second mechanism.

The positioning is deliberate and should be stated plainly in product material: _Loopic offers an
escape hatch that costs determinism; OGraf Studio offers conditionals that keep it._

## Implementation notes

**The main architectural wrinkle:** `isVisible` is a property of `Layer`
(`packages/scene-model/src/types.ts:343`), not of `Element`. The existing binding path resolves
element properties only — `resolveEffectiveElement` (`apps/editor/src/state/dataBinding.ts:34`)
returns a modified element and leaves the layer untouched. A layer-level binding target therefore
needs a parallel resolution path; `BINDABLE_PROPERTIES` is keyed by `ElementType` and cannot express
it. Design that seam before writing the feature, or it will be retrofitted badly.

Changes must flow through every surface that renders or inspects a layer: editor Stage, OGraf
Preview, compiled descriptor (`packages/codegen/src/compileDescriptor.ts`), runtime
(`packages/ograf-runtime/src/`), browser PNG capture, and SVG diagnostics. A layer that is visible in
the editor and hidden at playout, or the reverse, is worse than the missing feature.

**Runtime collections.** A conditional inside a collection prototype must resolve against the current
item, reusing the `sourcePath` semantics introduced for collection-prototype bindings in ADR-005.
Per-item conditionals are the primary use case — a lineup where only some players carry a card.

**Document version.** Bumps `PROJECT_DOCUMENT_VERSION` with a migration defaulting existing bindings
to no condition. One bump for this item alone.

**Design QA.** Add a rule warning when a layer is bound-invisible at every Step under its declared
defaults — a layer that can never appear is almost always an authoring mistake.

## Consequences

- The majority of real conditional broadcast graphics become expressible in one template, without
  weakening determinism, certification, or the non-real-time claim.
- Deliberately **not** covered, and to be refused rather than bolted on later: conditional looping,
  computed or derived values, arithmetic, string manipulation, and data fetching. Requests for these
  belong in a Reality Hub module, which is where the data and business logic already live.
- Variant proliferation drops. Templates that previously needed one copy per case collapse into one
  parameterised template, which also reduces the size of the W4 golden-template corpus.
- Compiled output remains ordinary portable OGraf. The condition is authoring-declared and resolves
  to a plain boolean before it reaches the runtime.

## Acceptance

- A layer bound to `visible` with an `is-not-empty` condition hides when the field is empty and
  appears when populated — identically in Stage, OGraf Preview, PNG capture, SVG diagnostics, and the
  certified runtime.
- Certification passes, `supportsNonRealTime` remains true, and visibility is stable across forward
  and backward `goToTime()` seeks including repeated replay after a data update.
- Inside a runtime collection, per-item conditions resolve against their own item.
- `designQa` warns on a layer that is invisible at every Step.
- A migration test covers projects authored before this version.
- No executable logic appears anywhere in the compiled descriptor — asserted by a compiler test.

## Sequencing

Recommended position: **immediately next**, ahead of W6 and W4.

It is the largest genuine capability gap against the benchmark product, and it changes what the
golden-template corpus should contain — building W4 first would produce templates that then need
rewriting once conditionals exist.

W8 (text stroke) remains small and can land at any point. W11 remains gated.
