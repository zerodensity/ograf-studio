// LED Matrix - single Image pass, Shadertoy compatible. An EFFECT: it rebuilds iChannel0 in LEDs.
//
// Turns any layer into a stadium screen or scoreboard: round (or square) LEDs that each show
// the colour beneath their centre, unlit diodes on the dark backing, optional colour steps and a
// soft bloom. Great on scores, clocks, team names, logos and photos.
//
// In OGraf Studio add it to a layer's Effects as a Shader effect: the effect stack hands the
// layer to the shader as iChannel0. amount blends from the untouched layer (0) to full LEDs (1),
// so it doubles as a transition. In Shadertoy, put an image or video in iChannel0.
//
// Technique: one texture read at each cell centre, an anti-aliased dot mask and a radial halo.
// Sizes are in pixels at Resolution scale 1.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the layer about its centre before the effect; below 1 it shrinks inside the box.
// Studio keeps an effect inside the layer's own pixels (it may recolour them but not add new
// ones), so on text and logos leave zoom at 1; zoom suits full-frame image and video layers.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf amount slider min(0) max(1) step(0.01)
const float amount = 1.0;
#pragma ograf cellSize slider min(3) max(40) step(0.5)
const float cellSize = 10.0;
#pragma ograf dotFill slider min(0.3) max(1) step(0.01)
const float dotFill = 0.75;
#pragma ograf roundness slider min(0) max(1) step(0.01)
const float roundness = 1.0;
#pragma ograf brightness slider min(0) max(3) step(0.01)
const float brightness = 1.3;
#pragma ograf colorSteps slider min(0) max(16) step(1)
const int colorSteps = 0;
#pragma ograf unlitColor color
const vec3 unlitColor = vec3(0.060, 0.060, 0.070);
#pragma ograf unlitOpacity slider min(0) max(1) step(0.01)
const float unlitOpacity = 0.6;
#pragma ograf bloom slider min(0) max(1) step(0.01)
const float bloom = 0.4;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

vec4 layerAt(vec2 uv) {
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture(iChannel0, uv) * inside;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec4 original = layerAt(coord / iResolution.xy);
  if (amount <= 0.0) {
    fragColor = original;
    return;
  }

  vec2 cell = floor(coord / cellSize);
  vec2 centre = (cell + 0.5) * cellSize;
  vec4 source = layerAt(centre / iResolution.xy);
  vec3 lit = source.rgb * brightness;
  if (colorSteps > 0) lit = floor(lit * float(colorSteps) + 0.5) / float(colorSteps);

  vec2 local = (coord - centre) / cellSize;
  float shape = mix(max(abs(local.x), abs(local.y)), length(local), roundness);
  float radius = 0.5 * dotFill;
  float aa = 1.0 / cellSize;
  float diode = 1.0 - smoothstep(radius - aa, radius + aa, shape);
  float halo = exp(-shape * 6.0) * bloom * source.a;

  float inLayer = step(0.0, centre.x) * step(centre.x, iResolution.x) * step(0.0, centre.y) * step(centre.y, iResolution.y);
  vec3 led = mix(unlitColor, lit, source.a);
  float ledAlpha = diode * max(source.a, unlitOpacity * inLayer);
  vec3 premultiplied = led * ledAlpha + lit * halo * (1.0 - ledAlpha);
  float alpha = clamp(ledAlpha + halo * 0.5 * (1.0 - ledAlpha), 0.0, 1.0);
  vec4 effect = vec4(clamp(premultiplied / max(alpha, 1e-4), 0.0, 1.0), alpha);

  fragColor = mix(original, effect, clamp(amount, 0.0, 1.0));
}
