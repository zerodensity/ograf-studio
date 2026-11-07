// Neon Sign - single Image pass, Shadertoy compatible. An EFFECT: it lights iChannel0 as neon.
//
// Turns text or a logo into a neon sign: glass tubes tracing the artwork's outlines with a
// white-hot core, a wide soft glow and an occasional flicker. Turn off tubeOutline to light the
// whole shape instead, for thin text and line art. For entertainment and nightlife, music,
// gaming and esports, "open late" promos and retro titles.
//
// In OGraf Studio add it to the text or logo layer's Effects as a Shader effect: the effect
// stack hands the layer to the shader as iChannel0. Studio keeps an effect inside the layer's own
// pixels, so the tubes and the glow between them render inside the letters; for the halo around
// them, add Studio's built-in Glow effect after this one (neon colour, radius 20-30, high
// intensity). Leave zoom at 1 on text. amount 0 passes the layer through untouched. Turn on
// useLayerColor to keep the artwork's own colours. In Shadertoy, put an image with alpha in
// iChannel0; there the glow also spreads outside the letters.
//
// Technique: alpha is averaged on rings of taps around each pixel. A ring at tubeWidth tells
// the edge band (the tube) from the shape's interior, a small ring finds the middle of strokes
// for the hot core, and two wide rings make the glow. 49 texture reads per pixel, all in one
// pass. Sizes are in pixels.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf amount slider min(0) max(1) step(0.01)
const float amount = 1.0;
#pragma ograf neonColor color
const vec3 neonColor = vec3(1.000, 0.200, 0.600);
#pragma ograf coreColor color
const vec3 coreColor = vec3(1.000, 0.880, 0.950);
#pragma ograf useLayerColor toggle
const bool useLayerColor = false;
#pragma ograf tubeOutline toggle
const bool tubeOutline = true;
#pragma ograf tubeWidth slider min(1) max(30) step(0.5)
const float tubeWidth = 7.0;
#pragma ograf glowRadius slider min(2) max(60) step(0.5)
const float glowRadius = 30.0;
#pragma ograf glowStrength slider min(0) max(3) step(0.01)
const float glowStrength = 1.4;
#pragma ograf tubeBrightness slider min(0) max(2) step(0.01)
const float tubeBrightness = 1.0;
#pragma ograf flicker slider min(0) max(1) step(0.01)
const float flicker = 0.3;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

vec4 layerAt(vec2 uv) {
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture(iChannel0, uv) * inside;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  vec4 source = layerAt(uv);
  if (amount <= 0.0) {
    fragColor = source;
    return;
  }

  vec2 texel = 1.0 / iResolution.xy;
  float near = 0.0;
  float inner = 0.0;
  float glow = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) / 12.0 * 6.2831853;
    vec2 dir = vec2(cos(a), sin(a));
    near += layerAt(uv + dir * glowRadius * 0.12 * texel).a;
    inner += layerAt(uv + dir * tubeWidth * texel).a;
    glow += layerAt(uv + dir * glowRadius * 0.45 * texel).a * 0.5;
    glow += layerAt(uv + dir * glowRadius * texel).a * 0.35;
  }
  near /= 12.0;
  inner /= 12.0;
  glow /= 12.0;

  float frame = floor(iTime * 12.0);
  float dip = step(0.88, hash11(frame)) * 0.7 + 0.1 * (hash11(frame + 0.5) - 0.5);
  float lit = 1.0 - flicker * dip;

  vec3 tube = useLayerColor ? source.rgb : neonColor;
  float shape = source.a;
  float core = smoothstep(0.6, 1.0, near) * source.a;
  if (tubeOutline) {
    // Only the band within tubeWidth of the edge is tube; its middle is the hot core.
    shape = source.a * (1.0 - smoothstep(0.82, 0.97, inner));
    core = shape * exp(-pow((inner - 0.72) / 0.12, 2.0));
  }
  vec3 tubeColor = mix(tube * 1.3, coreColor, core) * tubeBrightness * lit;
  float halo = clamp(glow * glowStrength * lit, 0.0, 1.0) * (1.0 - shape);

  vec3 premultiplied = tubeColor * shape + tube * halo;
  float alpha = clamp(shape + halo, 0.0, 1.0);
  vec4 neon = vec4(clamp(premultiplied / max(alpha, 1e-4), 0.0, 1.0), alpha);
  fragColor = mix(source, neon, clamp(amount, 0.0, 1.0));
}
