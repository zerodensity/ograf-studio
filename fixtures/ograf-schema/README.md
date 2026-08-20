# Vendored EBU OGraf JSON Schemas

The **real** OGraf manifest schema and its full `$ref` closure, fetched from
`https://ograf.ebu.io/v1/specification/json-schemas/` and committed here verbatim.

## Why these exist

`packages/validation/src/ografManifestSchema.ts` is a _hand-authored_ approximation of the manifest
schema, kept local so the click-to-export flow never depends on the network. That approximation has
already drifted from the real spec once (Phase 5a: `renderRequirements` fields are constraint
objects — `{exact: 1920}` — not raw numbers; both our emitter _and_ our validator had the same wrong
assumption, so the validator happily passed invalid manifests).

These vendored copies are the independent check. `packages/codegen/src/assembleManifest.test.ts`
validates real assembled manifests against **these** files, not against our hand-authored schema —
so if the two ever disagree again, a test fails instead of a broadcast package silently being wrong.

## Refreshing

```bash
BASE=https://ograf.ebu.io/v1/specification/json-schemas
curl -s -o graphics-schema.json   $BASE/graphics/schema.json
curl -s -o number.json            $BASE/lib/constraints/number.json
curl -s -o boolean.json           $BASE/lib/constraints/boolean.json
curl -s -o action.json            $BASE/lib/action.json
curl -s -o gdd-object.json        $BASE/gdd/object.json
curl -s -o gdd-basic-types.json   $BASE/gdd/basic-types.json
curl -s -o gdd-types.json         $BASE/gdd/gdd-types.json
```

If a refresh makes tests fail, that is the signal to update
`packages/validation/src/ografManifestSchema.ts` (and likely `assembleManifest.ts`) to match — the
spec moved, and our local copy needs to follow.
