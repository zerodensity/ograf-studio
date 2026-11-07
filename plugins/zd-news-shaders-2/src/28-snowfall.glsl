// Snowfall - single Image pass, Shadertoy compatible.
//
// Soft snow drifting down in up to six depths, near flakes larger, faster and out of focus.
// For winter weather, travel disruption, Christmas and holiday segments. Transparent by
// default: lay it over a forecast map, a photo or live video. Use wind for driving snow.
//
// Technique: each depth layer is a scrolling cell grid with at most one flake per cell; the
// flake wobbles inside its cell, so neighbours never need to be checked. Depth controls size,
// speed, brightness and edge softness, which gives a convincing parallax.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; turn transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf flakeColor color
const vec3 flakeColor = vec3(1.000, 1.000, 1.000);
#pragma ograf skyTop color
const vec3 skyTop = vec3(0.050, 0.080, 0.150);
#pragma ograf skyBottom color
const vec3 skyBottom = vec3(0.150, 0.200, 0.300);
#pragma ograf density slider min(0) max(1) step(0.01)
const float density = 0.6;
#pragma ograf flakeSize slider min(0.2) max(3) step(0.01)
const float flakeSize = 1.0;
#pragma ograf fallSpeed slider min(0) max(3) step(0.01)
const float fallSpeed = 1.0;
#pragma ograf wind slider min(-2) max(2) step(0.01)
const float wind = 0.3;
#pragma ograf wobble slider min(0) max(1) step(0.01)
const float wobble = 0.5;
#pragma ograf layers slider min(1) max(6) step(1)
const int layers = 5;
#pragma ograf transparentBackground toggle
const bool transparentBackground = true;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

vec2 hash22(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  vec2 p0 = coord / iResolution.y;
  vec3 premultiplied = transparentBackground ? vec3(0.0) : mix(skyBottom, skyTop, clamp(uv.y, 0.0, 1.0));
  float alpha = transparentBackground ? 0.0 : 1.0;

  for (int l = 0; l < 6; l++) {
    if (l >= layers) break;
    float depth = (float(l) + 1.0) / float(layers);
    float scale = mix(22.0, 5.0, depth);
    vec2 p = p0 * scale;
    p.y += iTime * fallSpeed * mix(0.8, 2.2, depth);
    p.x -= iTime * wind * mix(0.4, 1.4, depth);
    vec2 cell = floor(p);
    vec2 h = hash22(cell + float(l) * 11.3);
    vec2 h2 = hash22(cell + float(l) * 5.7 + 1.9);
    if (h2.x > density) continue;

    vec2 at = 0.5 + (h - 0.5) * 0.5;
    at.x += sin(iTime * (0.8 + h.y) + h.x * 6.2831853) * 0.15 * wobble;
    float radius = (0.06 + 0.08 * h2.y) * flakeSize;
    float softness = mix(0.25, 0.75, depth * depth);
    float d = length(fract(p) - at);
    float flake = 1.0 - smoothstep(radius * (1.0 - softness), radius + 1.5 * scale / iResolution.y, d);
    flake *= mix(0.45, 1.0, depth);

    premultiplied = premultiplied * (1.0 - flake) + flakeColor * flake;
    alpha = alpha * (1.0 - flake) + flake;
  }

  fragColor = vec4(clamp(premultiplied / max(alpha, 1e-4), 0.0, 1.0), alpha);
}
