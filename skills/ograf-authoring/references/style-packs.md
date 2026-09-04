# Pack color routing

Apply a pack through `apply_style_pack`. It updates existing color controls and their root-level
GDD color-field defaults, including gradient stops and shared lights. This avoids an unchanged
runtime field overriding a new authored pack color. It does not rewrite operator data, value maps,
gradient-stop positions/opacities, lighting motion or geometry.

Color channels follow their actual consumers. Accent/light uses take precedence when one field
also colors a container; pattern faces use surface tones, highlights use accents, dark shading
uses background/outline colors, and text follows semantic roles. Existing dark badge labels use
the outline color for contrast. Gradient stop brightness ratios and original alpha are retained.
Literal hex/rgb colors are supported; unresolved CSS expressions stay authored.

`designSystem.stylePackColors` records parent palette sources, existing token/field targets,
authored consumers, tonal factors and alpha. Editing a parent token by its ID propagates through
these links. Existing custom swatches remain usable. Runtime `updateAction` colors still override
authored defaults. Nested/collection fields and explicit value maps retain their normal data logic.
Inspect `get_project` and capture actual output: token presence alone does not prove colors changed.

Removal restores recorded properties, prior token values/bindings, field defaults and update
timing. Restore metadata is authoring-only and persists in `.ogs`. Switching packs derives shades
from the original baseline, so repeated application does not compound darkening. Content/layout
edits and unrelated tokens survive. Older applied packs without a baseline can only detach;
use Undo or an earlier saved source to recover their original styling.

For verification, apply contrasting packs, confirm effective color-field defaults and on-air
pixels change, inspect reflection alpha/motion, then remove and compare with the original source.
