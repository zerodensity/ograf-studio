// Tile Reveal - single Image pass, Shadertoy compatible. An EFFECT: it transitions iChannel0.
//
// Reveals (and hides) a layer as a wave of tiles that grow and fade in along a direction, with
// a little random jitter. A crisp, modern transition for lower thirds, full-frames, photos,
// logos and data cards.
//
// In OGraf Studio add it to a layer's Effects as a Shader effect: the effect stack hands the
// layer to the shader as iChannel0. Turn autoLoop off and keyframe progress from 0 (hidden) to 1
// (fully shown) to animate in, and back to 0 to animate out; at 1 the layer passes through
// untouched. With autoLoop on, it reveals, holds and hides every loopSeconds. In Shadertoy, put
// an image or video in iChannel0.
//
// Technique: each tile's start time comes from its centre's position along the direction,
// mixed with a hash, so the wave stays orderly but alive. Sizes are in pixels.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the layer about its centre before the effect; below 1 it shrinks inside the box.
// Studio keeps an effect inside the layer's own pixels (it may recolour them but not add new
// ones), so on text and logos leave zoom at 1; zoom suits full-frame image and video layers.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf progress slider min(0) max(1) step(0.001)
const float progress = 1.0;
#pragma ograf autoLoop toggle
const bool autoLoop = true;
#pragma ograf loopSeconds slider min(1) max(20) step(0.1)
const float loopSeconds = 4.0;
#pragma ograf tileSize slider min(4) max(200) step(1)
const float tileSize = 48.0;
#pragma ograf direction slider min(0) max(360) step(1)
const float direction = 30.0;
#pragma ograf spread slider min(0) max(0.95) step(0.01)
const float spread = 0.6;
#pragma ograf jitter slider min(0) max(1) step(0.01)
const float jitter = 0.3;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec4 layerAt(vec2 uv) {
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture(iChannel0, uv) * inside;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec4 source = layerAt(coord / iResolution.xy);

  float amount = clamp(progress, 0.0, 1.0);
  if (autoLoop) {
    float cycle = fract(iTime / loopSeconds);
    amount = smoothstep(0.0, 0.4, cycle) - smoothstep(0.6, 1.0, cycle);
  }
  if (amount >= 1.0) {
    fragColor = source;
    return;
  }

  vec2 cell = floor(coord / tileSize);
  vec2 centre = (cell + 0.5) * tileSize;
  float aspect = iResolution.x / iResolution.y;
  vec2 dir = vec2(cos(radians(direction)), sin(radians(direction)));
  vec2 fromMiddle = (centre / iResolution.xy - 0.5) * vec2(aspect, 1.0);
  float order = clamp(0.5 + dot(fromMiddle, dir) / length(vec2(aspect, 1.0)), 0.0, 1.0);
  order = mix(order, hash12(cell), jitter);
  float tileT = clamp((amount - order * spread) / (1.0 - spread), 0.0, 1.0);
  float eased = tileT * tileT * (3.0 - 2.0 * tileT);

  vec2 local = (coord - centre) / tileSize;
  float extent = max(abs(local.x), abs(local.y));
  float aa = 1.0 / tileSize;
  float tile = eased >= 0.999 ? 1.0 : 1.0 - smoothstep(0.5 * eased - aa, 0.5 * eased, extent);
  fragColor = vec4(source.rgb, source.a * tile * mix(1.0, eased, 0.5));
}
