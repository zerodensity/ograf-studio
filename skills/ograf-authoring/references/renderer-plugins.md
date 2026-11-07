# Versioned chart renderer plugins

Discover `get_capabilities` with `sections:["plugins"]` before using this contract. Supported kinds
are chart providers, data-only layer animation presets and GLSL shader packs; read
[animation-plugins.md](animation-plugins.md) and [shader-plugins.md](shader-plugins.md) for those packs.
New layer kinds, property schemas, runtime animation engines and per-letter text
animation plugins are unsupported. Charts are plugin-only; native text animation remains available.

Plugin installation, review, trust, enable/disable, removal, and new-chart defaults live in
**File → Preferences → OGraf Studio → Plugins**. The dockable **Plugins** pane browses templates;
its gear, **Manage plugin…** and **Add plugin…** open this same preferences page. For a saved chart
bundle, choose **Review saved bundle → Trust & Install** there. Imported code
requires explicit user approval. MCP has no installation or trust mutation. Do not
fabricate plugin snapshots or treat embedded JavaScript as automatically trusted.

Studio includes **ZD News Shaders 1**, **ZD News Shaders 2**, **Broadcast Motion** and **Chart.js**
as offline bundles, installed and enabled on a fresh profile. Only bundle and snapshot hashes
compiled into that Studio build grant included-plugin trust. A matching name, ID or version is
insufficient. Included entries stay installed and can be disabled; explicit enable/default choices
survive reload. Chart.js is the initial new-chart default unless a user already selected another
provider or explicitly chose none. Older installed versions and authored pins remain intact.
**Template Set → Plugins** and **Template → Plugins** show exact document requirements and usage;
they do not grant execution permission or automatically migrate versions. Existing object options
continue to be edited in Properties. A load failure keeps successfully verified packs available;
use **Retry loading plugins** in Studio preferences to recover missing bundles.

On document load, Studio checks runtime chart pins across the entire set and opens a visible
plugin-mismatch dialog for blocked charts; dismissing it leaves a persistent Review plugins bar.
The dialog identifies affected templates and exact builds, can enable an already trusted build,
or explicitly replace a pin with a trusted compatible installed renderer. It never grants trust
to unfamiliar code. A usable older build is not a blocking mismatch. Reopening the same document
checks again; ordinary edits and template navigation do not repeatedly open the popup.

Plugin settings group Applications & adapters by adapter ID and distinguish upstream library
version/publisher/license from the Studio integration code's version/publisher/license. Metadata
is declared, not authenticated or legally verified. Update review rejects a different ID or
identical bytes and reports component/preset changes; approval installs alongside old versions.
Use for new charts is an explicit default change, never a current-template auto-upgrade. Full
source/notices remain in the package, not the settings UI. API v1 cannot independently install/swap raw vendor code or
implement commercial BYOL. Never treat a permissive library label as covering the adapter.

The **Plugins** toolbar opens the dockable pane. Choose **Charts**, a provider and exact version
before creating from its gallery. Creation must preserve that pin. The provider's settings gear
or **Manage plugin…** opens its installation controls, including unavailable versions. Icons are
optional embedded PNG/WebP manifest metadata, not code or external assets.

Read `get_project include:["plugins"]` for composition catalogs: it returns manifest, digest,
and byte counts without module source. Chart `provider` pins `{id,version,sha256}`; absent/null
means unconfigured, not a fallback. Use only a matching snapshot already present in that composition when
editing a chart's provider through `update_element`. Installing or choosing a new default does
not upgrade existing charts. Unavailable/disabled/untrusted versions fail rendering and
certification; ask the operator to review the exact version instead of silently falling back.
When Preview & Export finds a different enabled, trusted compatible chart build, its update notice
shows the exact old/new identities and affected charts. The operator may explicitly update the
template; Studio validates chart types and features, preserves the old saved bundle, and records
one undo step. Shared component instances in other templates are counted and checked; explicit
provider overrides remain unchanged. Review the appearance after upgrading: matching declared
features cannot guarantee identical rendering. Never treat this choice as permission to trust a
different unreviewed plugin or silently replace the existing pin.
For `add_layer.kind:"chart"`, provide `element.provider` explicitly from the composition's catalog.
Never manufacture snapshots to bypass installation/trust. Unconfigured legacy charts are editable
but fail export until repaired. Local bundles use `.ogsplugin.zip`.

Use `remove_renderer_plugin` only for explicitly requested catalog cleanup, with an exact
`reference:{id,version,sha256}`. Dry-run first. It refuses pins used by any layer, guide, collection
prototype, or saved component; retarget those consumers explicitly before removal. It changes
template source only, not machine installation, trust, or previously exported packages.

An `.ogs` carries the exact renderer source/license, and exported OGraf graphics carry that
pinned code without a local catalog or CDN dependency. A receiver opening editable source must
approve unfamiliar code unless its exact bytes already match a verified included or trusted
installed bundle; exported playout executes packaged code under its host's trust policy.

For a provider change, capture a held nonzero frame, seek backward, and certify the actual
compiled package under the requested realtime/non-realtime profile. Provider initialization may
be asynchronous, but subsequent frame sampling is synchronous and must use composition frames,
not wall-clock animation. Media, effect, binding, and lifecycle contracts stay unchanged.

For moving shader-filled chart marks, inspect live playback and replay in addition to
deterministic stills. Compare the raw mark mask, shader coverage and final output across raster
tile boundaries. Base, coverage and foreground must represent one complete sampled frame before
the painted output is published. Check Studio, standalone and coordinated exports, including
backward/repeated non-real-time seeks and data updates. Preserve mark animations, shader fill,
template geometry and provider pins while diagnosing artifacts; removing them can conceal the
failure. Media fills remain supported under their existing real-time restrictions.

Check transparent gaps between marks and outside their geometry on transparent, light and dark
mattes; no shader tint may cover the plot rectangle or duplicate fill darken the marks. Inspect
raw shader RGBA and the composited output. Shader output must match its canvas alpha association:
premultiplied output requires `RGBA(0,0,0,0)` at zero coverage, with RGB associated once using final
alpha after masking and straight-alpha effect math. Preserve partial edge opacity; alpha zero
alone does not prove that transparent pixels contain no RGB.

Chart renderer plugins are trusted page-level JavaScript, not a sandbox. A digest proves identity, not safety
or authorship. Do not install unreviewed downloaded code to complete an authoring task. See
the repository's `docs/RENDERER_PLUGINS.md` for bundle format and provider API.
