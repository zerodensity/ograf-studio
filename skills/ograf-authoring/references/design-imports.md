# Editable design imports

Use the visible Studio **Resources** pane for **Import editable SVG**, **Import PSD**, or
**Import Figma JSON**. These UI workflows create ordinary editable layers where the source can be
represented faithfully; inspect the import report, editability and rendered output afterwards.
They are separate from the MCP asset-import operations.

- Editable SVG accepts a bounded, well-formed SVG with a `viewBox` beginning at `0 0` and matching
  viewport dimensions. Supported basic shapes, paths, text and simple linear gradients become
  layers. Text baselines are measured using the browser's installed font and CSS line box;
  minor SVG-versus-HTML rasterization differences can remain. Unavailable fonts or unmeasurable
  text use an explicit image fallback. Unsupported subtrees are preserved as image fallbacks
  when safe; unsupported whole-document structures can require the regular SVG image import.
  Nested SVG/Figma groups share the outer editable group; independent inner group boundaries
  cannot be represented yet and the import report warns about flattening.
  Do not claim fallback pixels are individually editable.
- PSD retains layer stacking and imports supported pixel layers, solid rectangles and simple text
  when its font is available. Unsupported
  masks, effects, adjustments, clipping or compositing use the PSD's merged image; without a
  usable merged image, import fails with a message. Nested groups may be flattened. Review the
  warnings and never promise every Photoshop layer remains editable.
- Figma requires the OGraf Studio Figma export plugin, available from Resources. Install the
  downloaded plugin through Figma Development and export selected nodes as the versioned OGraf
  interchange JSON; arbitrary Figma JSON is not accepted. Supported simple rectangles, ellipses
  and text using an available font become editable; unsupported nodes use embedded PNG fallbacks.
  Nested groups may be flattened. The importer bounds file size, node count, depth and PNG pixels.

`ograf_import_svg_bundle` remains a distinct MCP tool: it embeds one SVG and selected companions
into **one image asset**, registers discovered fonts, and does not decompose the SVG into editable
layers. MCP does not provide an editable PSD/Figma import operation. Do not invent one; use the
visible Studio workflow and report its actual warnings and fallback boundaries.
