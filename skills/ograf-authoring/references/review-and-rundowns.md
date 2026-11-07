# Review and test rundowns

Review comments, named versions, approvals and test rundowns are local authoring data saved in the
editable project. They are excluded from OGraf manifests, runtime packages and operator controls.
They do not provide multi-user sync or a cryptographic approval signature.

Read `ograf_get_project` with `include:["review","testRundowns"]` for comment and version metadata
and the active composition's named rows. Version summaries omit full snapshots; omit `include` to
read the full project if a snapshot is needed. Use revision-checked `ograf_apply_operations`:

- `add_review_comment` takes `compositionId`, optional `layerId`, `frame`, `x`, `y`, `author` and
  `text`; the returned result includes its ID. An optional ID supports references within the batch.
- `set_review_comment_resolved` takes `commentId` and `resolved:true` or `false`.
- `save_review_version` takes `name`; it captures the current project without recursive review data.
- `set_review_approval` takes the actual approver's `author`, or `null` to clear. Only record an
  approval when the named human has explicitly approved; never invent or imply their endorsement.
- `set_test_rundowns` takes `compositionId` and `rundowns:[{id,name,rows:[{id,values}]}]`; `values`
  maps stable field IDs to test values. The Data → Test data pane imports CSV/TSV/JSON and checks
  overflow; Preview & Export runs rows through the authored Take, Update and Out transitions.

Review operations participate in normal atomic project revisions and undo. Reload the review
metadata after a revision conflict. Approval fingerprints indicate whether the content has changed;
they are not cryptographic signatures. Archived or copied versions remain local snapshots.
