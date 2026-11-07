// Radar Sweep - single Image pass, Shadertoy compatible.
//
// A classic radar scope: range rings, crosshairs, a rotating beam with a fading trail and blips
// that flare as the beam passes. Transparent by default, so it sits over a weather map, a
// region map or a "tracking" story. Recolour it from phosphor green to your brand.
//
// Technique: everything is polar around radarCenter. The trail is the angle behind the beam;
// each blip remembers how long ago the beam crossed its own angle, so it fades between passes
// without any stored state.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; turn transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf radarColor color
const vec3 radarColor = vec3(0.200, 1.000, 0.500);
#pragma ograf blipColor color
const vec3 blipColor = vec3(0.850, 1.000, 0.650);
#pragma ograf radarCenter vector2 min(-0.5) max(1.5)
const vec2 radarCenter = vec2(0.5, 0.5);
#pragma ograf radarRadius slider min(0.05) max(0.7) step(0.005)
const float radarRadius = 0.42;
#pragma ograf ringCount slider min(1) max(10) step(1)
const int ringCount = 4;
#pragma ograf sweepSeconds slider min(0.5) max(20) step(0.1)
const float sweepSeconds = 4.0;
#pragma ograf trailLength slider min(0.02) max(1) step(0.01)
const float trailLength = 0.25;
#pragma ograf blipCount slider min(0) max(24) step(1)
const int blipCount = 8;
#pragma ograf gridOpacity slider min(0) max(1) step(0.01)
const float gridOpacity = 0.5;
#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.000, 0.030, 0.020);
#pragma ograf transparentBackground toggle
const bool transparentBackground = true;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

// Pixel-wide line: 1 on the line, fading over about a pixel.
float hairline(float distancePx, float widthPx) {
  return 1.0 - smoothstep(0.5 * widthPx, 0.5 * widthPx + 1.0, distancePx);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  float radiusPx = radarRadius * iResolution.y;
  vec2 px = coord - radarCenter * iResolution.xy;
  vec2 p = px / radiusPx;
  float r = length(p);
  float turn = fract(atan(p.x, p.y) / 6.2831853);
  float disc = 1.0 - smoothstep(1.0, 1.0 + 1.5 / radiusPx, r);

  float rings = float(ringCount);
  float ringPx = abs(fract(r * rings + 0.5) - 0.5) / rings * radiusPx;
  float grid = hairline(ringPx, 1.2) * step(r, 1.0 + 1.0 / radiusPx);
  grid = max(grid, hairline(abs(r - 1.0) * radiusPx, 2.5));
  grid = max(grid, 0.6 * min(hairline(abs(px.x), 1.0) + hairline(abs(px.y), 1.0), 1.0) * disc);

  float sweep = fract(iTime / sweepSeconds);
  float behind = fract(sweep - turn);
  float trail = exp(-behind / trailLength * 3.0) * disc;
  float beam = hairline(behind * 6.2831853 * r * radiusPx, 2.0) * disc;

  float blips = 0.0;
  for (int i = 0; i < 24; i++) {
    if (i >= blipCount) break;
    float id = float(i);
    float blipTurn = fract(hash11(id + 1.7) + 0.01 * iTime * (hash11(id + 3.1) - 0.5));
    float blipR = 0.15 + 0.8 * hash11(id + 5.3);
    vec2 at = blipR * vec2(sin(blipTurn * 6.2831853), cos(blipTurn * 6.2831853));
    float age = fract(sweep - blipTurn);
    float d = length(p - at) * radiusPx;
    blips += (1.0 - smoothstep(2.0, 6.0, d)) * exp(-age * 4.0);
  }

  float alpha = clamp(grid * gridOpacity + 0.5 * trail + beam + blips, 0.0, 1.0);
  vec3 color = mix(radarColor, blipColor, clamp(blips + beam * 0.5, 0.0, 1.0));
  if (transparentBackground) {
    fragColor = vec4(color, alpha);
  } else {
    vec3 base = backgroundColor + radarColor * 0.04 * disc;
    fragColor = vec4(mix(base, color, alpha), 1.0);
  }
}
