# Handover — mandatory OGraf save certification

Date: 2026-08-15

## Outcome

No user-visible file save or OGraf export starts until the exact snapshot to be written passes the
editor's OGraf v1 certification gate. The gate mirrors SuperFlyTV `ograf-devtool`'s manifest,
module, and in-depth lifecycle checks and is stricter about lifecycle calls returning error status
codes.

The reported incompatibility was reproduced as a workflow/format collision: the menubar's former
`Save` action wrote editable source as `*.ogeproj.json`. `ograf-devtool` scans generic JSON files in
the selected directory as candidate manifests, so it correctly rejected that editor-only document
as not being an OGraf manifest. New source saves use `*.ogeproj`, the action is labeled `Save
Project`, and the export panel distinguishes source from playout output. Legacy JSON project files
remain openable through the fallback picker/all-files route.

## Implementation

- `apps/editor/src/state/ografCompatibility.ts`
  - owns exact artifact compilation and the only certification implementation;
  - validates project semantics and the vendored canonical EBU v1 schema;
  - checks manifest filename, `main.js`, resources, path safety, and duplicates;
  - imports the generated `main.js` from a Blob URL and verifies its default Custom Element export;
  - verifies the required Graphic methods for advertised modes;
  - runs `load/updateAction/playAction/stopAction/dispose` in realtime and
    `load/setActionsSchedule/goToTime/dispose` in non-realtime with the devtool's 3000 ms limit;
  - validates payload keys/types and rejects status codes >= 400.
- `exportPackage.ts` certifies before constructing or saving the ZIP. The certified artifact object
  is the same object written, avoiding check/write drift.
- `fileIO.ts` snapshots and certifies editable project source before showing a save picker. New
  source names end in `.ogeproj`, so OGraf directory scanners ignore them.
- `PreviewExportPanel.tsx` exposes the five-check report and an explicit test button. Export always
  reruns certification, even when a previous report was green.
- `Menubar.tsx` clearly labels `Save Project`, reports certification progress, and identifies the
  saved file as editor source.

## Independent verification

- Generated a current lower-third manifest and `main.js` as loose files in
  `C:\works\ograf-devtool-fixture\current-editor-output`.
- Ran the live validator from `C:\works\ograf-devtool` against the official schema proxy: zero
  schema errors and zero filename errors.
- Imported that `main.js` independently in a browser, verified the default Custom Element/API, and
  exercised realtime plus non-realtime methods: every call returned status 200.
- Ran the product's new certification function on the lower-third: all five checks passed.
- `npm test`: 94/94 passed.
- `npm run lint`, `npm run typecheck`, and `npm run build`: passed. Build retains the known large
  editor-chunk warning.

## Important operational distinction

`*.ogeproj` is editable authoring source and is never an OGraf manifest. `*.ograf.zip` is a
distribution archive; SuperFlyTV's devtool does not open the ZIP itself. Extract it, then select the
folder containing `*.ograf.json`, `main.js`, and any `assets/` files.

## Follow-up

Add automated real-browser CI around the successful certification path and a renderer compatibility
matrix. Keep the vendored EBU schema synchronized with the versioned official v1 URL and rerun the
external devtool cross-check whenever its verifier changes.
