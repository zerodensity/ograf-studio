# GLSL shader packs

Discover `sections:["plugins","shaders","editor"]`. `shaderPacks` describes reviewed
`kind:"shader-pack"` `.ogsplugin.zip` bundles with `manifest.json`, `shaders.json`, `LICENSE.txt`.
Installation, trust, enable and updates are human actions in
**File → Preferences → OGraf Studio → Plugins**, not MCP mutations. Both ZD News Shader packs
are included offline and enabled on fresh installations, with exact build-pinned identities.
GLSL is GPU code; do not call a pack safe merely because its wrapper is JSON or has a digest.
Parsing/review do not compile it; previews are explicit, selected-only and disposable.

Application copies complete ordinary ShaderPaint source, defaults and attribution into Fill,
text Outline or Effects. Copies remain editable and render after the original pack is disabled,
removed or updated. Applications also save deduplicated editable Resources copies, including
effect-only shaders without an embedded input. An effect-only `iChannel0` resource cannot be used
as a normal Fill/Outline without its own image; do not fabricate one merely to make the import pass.
Effect input is always the preceding layer stack, not a separate image. Resources previews use
a temporary reference image that is never persisted in the effect shader.

Resources → Shaders lists saved library entries and applied Fill/Outline/Effect usages. Editing
an applied entry changes only that usage; library copies remain independent. Properties keeps
shader parameter controls and opens the dedicated editor through Edit shader.

The editor supports dragging Resources or plugin shader templates onto canvas objects, followed
by a Fill/Outline/Effect chooser. Empty canvas space uses the current selection; incompatible
choices are disabled. Effect appends Normal/100% enabled. Saving and applying share one undo step.
Plugin templates also drop directly onto Resources → Shaders without changing objects. Payloads
carry canonical identities only; source, exact pack trust/enabled state and targets are rechecked
when confirmed. These UI conveniences do not install/trust bundles or add MCP operation types.

Read `get_project include:["shaders"]` for the saved library array; inspect layer elements/effects
for applied paints. Reuse existing `update_element.patch.fill`/text `strokePaint` and `add_effect`/`update_effect`
shader contracts. Preserve complete `packProvenance` on copies and edits: it is original attribution,
not an active execution pin or assertion that edited source remains byte-identical. Exports retain
used notices; unused Resources are not a runtime dependency. Never infer that the Studio adapter
license replaces a shader's declared original license.

The first ZD News pack has 19 Fill/Outline entries plus effect-only Signal Glitch; ZD News Shaders 2
has 16 Fill/Outline entries plus LED Matrix, Tile Reveal, Neon Sign and Heat Shimmer effects. All
forty numbered sources declare CC0. Preview effects against representative input; sample different
times, back-seek, and certify the actual browser artifact before claiming OGraf compatibility.
No multipass, feedback, additional channels, mouse/date/frame inputs or arbitrary JavaScript are
added. See `docs/SHADER_PLUGINS.md` for limits and the SDK.
