# Text animators and motion blur

Use `ograf_get_capabilities` with `sections:["elements","modifiers"]` before authoring. Existing
`update_element.patch.textAnimation.animators` adds up to 32 deterministic property animators to
editable text. Each takes a unique `id`; optional `enabled`, `unit` (`character`, `word`, `line`),
`start`/`end` (0–1), `offset` (-1–1), `offsetKeyframes:[{frame,value}]`, `shape` (`square`,
`ramp`, `triangle`, `round`), `easing` (`linear`, `ease-in`, `ease-out`, `ease-in-out`), `order`
(`forward`, `reverse`, `center-out`, `random`), integer `seed`, positive `durationFrames`, and
`properties` (opacity, x, y, scale, rotation, blur, color, tracking). Validate and capture the
first, middle and last frames, then repeat a backward seek with the same seed.

Animator color supports solid fills and gradients whose stop colors are parseable, preserving
gradient stop alpha; shader and media color tint remain unsupported. Other properties work with
gradient, shader and media fills. Per-property animators can be combined with count and rolling text effects; verify dynamic
digit changes and backward seeks for the target graphic.
Shader and media color tint must remain explicitly unsupported until alpha-correct per-glyph GPU compositing is verified in Studio and exported playback. Never replace or cover the original paint, drop its alpha, or introduce per-frame CPU readback. A synthetic premultiplied GPU prototype is not evidence of production parity.
Gradient tint repaints each animated glyph and can be expensive; measure performance on the target
renderer with the intended text length and frame rate.
The transaction rejects invalid options rather than silently substituting defaults. Use ordinary
text presets when per-property control is unnecessary.

Experimental velocity blur is authored via `set_layer_layout.motionBlur` with
`{enabled:true,shutterAngle:180}` (0–360 degrees), or `null` to remove it. It follows authored X/Y
motion (not arbitrary live, rule or modifier movement). It can be expensive with many simultaneously blurred layers; assess output, performance and reproducibility in the target renderer before use.

# Text on a path

Use `set_layer_layout` with `textPath: {sourceLayerId, startOffset, alignment}` on an unlocked
text layer; alignment is `start`, `center`, or `end`. Use `textPath: null` to detach. The source
must be a same-composition, non-guide editable path with one nonzero contour; nine-slice
paths are unsupported. Single and coordinated exports support solid, gradient, shader and Media
fills and the none, fade, typewriter, roll-up, roll-down, count, rise, pop, flip, blur, rotate,
stretch and word-reveal effects. Word Reveal positions each word as one rigid unit. Transform
presets require grapheme splitting. Path text, including rolling and non-rolling Count, supports
opacity, X/Y, scale, rotation and solid-color animators. Color animation requires a solid fill.
Word Reveal with a shader or Media fill cannot be combined with enabled property animators; gradient
Word Reveal can use non-color animators. A narrowly verified Word Reveal subset supports simple
single-script Arabic with explicit RTL or Devanagari with LTR/auto, using solid fill and no enabled
animators, styled runs, digits or punctuation. Check font availability on the target system.
Other RTL/contextual-shaping combinations remain guarded. The current contract also excludes clocks
and crawls, squeeze, shrink-to-fit and fit-to-width, negative tracking, other animator properties, shader strokes,
multiline, capitalize and non-ASCII case transforms, and more than 512 graphemes or 4,096 code units.
Validation reports unsupported combinations before export.

# Color sampling

The system eyedropper is preferred. If unavailable, Studio samples a preserved, origin-clean shader canvas using a one-shot live-stage capture. It cancels pending samples on project, composition, selection or control changes; video/live media, restricted canvases and external images are explicitly rejected. Do not replace those errors with a silently blank or reconstructed frame, and never add a continuous per-frame readback for the picker.
