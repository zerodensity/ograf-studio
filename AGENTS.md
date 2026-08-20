# Repository Working Agreement

This file is the source of truth for humans and coding agents working in this repository.

## Before changing code

1. Read `docs/STATUS.md`, `docs/ARCHITECTURE.md`, and the latest file in `docs/handovers/`.
2. Check the working tree and preserve unrelated changes.
3. Link substantial work to an item in `docs/ROADMAP.md` or `docs/KNOWN_ISSUES.md`.

## Architectural invariants

- The canonical OGraf specification and schemas take precedence over local approximations.
- A graphic has explicit start and end states; only `step` states contribute to `stepCount`.
- Editor preview and exported runtime must consume the same compiled timeline representation.
- OGraf lifecycle markers are global control points; animation keys belong to individual layers and
  must never be created or retimed as a side effect of editing another layer.
- Non-realtime support may only be advertised when every animated element is deterministic under `goToTime()`.
- Project files are versioned and migrated at one boundary before entering application state.
- Export is blocked by project, manifest, package, or runtime compliance errors.

## Verification

Run `npm run verify` before handing work over. Record the result and any intentionally skipped check in the handover.

## Handover

- Do not leave the only copy of work in a stash or an unpushed local branch.
- Update `docs/STATUS.md` when project-level truth changes.
- Create a handover from `docs/handovers/HANDOVER_TEMPLATE.md` when ownership changes.
- “Completed” means verified, not merely implemented.
