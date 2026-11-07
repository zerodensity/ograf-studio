// Neon Tunnel - single Image pass, Shadertoy compatible.
//
// An endless neon tunnel rushing towards the viewer, round or square. For countdowns, game shows,
// sports and esports openers, "next up" bumpers and transitions. Animate speed for a launch,
// twist for a spiral, and shapeRoundness from 2 (round) towards 12 (square).
//
// Inspired by the classic tunnel shaders that have been Shadertoy favourites since the start;
// written from scratch. Depth is the inverse of a superellipse radius, so rings and lengthwise
// lines are just grid lines in (depth, angle) space. Line widths follow their screen-space
// derivative, which keeps the far end free of moire, and fog fades it into the distance.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.000, 0.000, 0.020);
#pragma ograf ringColor color
const vec3 ringColor = vec3(1.000, 0.200, 0.600);
#pragma ograf lineColor color
const vec3 lineColor = vec3(0.200, 0.800, 1.000);
#pragma ograf tunnelCenter vector2 min(-0.5) max(1.5)
const vec2 tunnelCenter = vec2(0.5, 0.5);
#pragma ograf shapeRoundness slider min(2) max(12) step(0.1)
const float shapeRoundness = 2.0;
#pragma ograf ringSpacing slider min(0.5) max(10) step(0.01)
const float ringSpacing = 3.0;
#pragma ograf segments slider min(3) max(48) step(1)
const int segments = 16;
#pragma ograf speed slider min(-4) max(4) step(0.01)
const float speed = 1.0;
#pragma ograf twist slider min(-2) max(2) step(0.01)
const float twist = 0.3;
#pragma ograf lineWidth slider min(0.005) max(0.2) step(0.001)
const float lineWidth = 0.03;
#pragma ograf glow slider min(0) max(2) step(0.01)
const float glow = 1.0;
#pragma ograf fog slider min(0) max(1) step(0.01)
const float fog = 0.5;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

// Brightness of the grid line nearest to x, widened (and dimmed) to its pixel footprint.
float neonLine(float x, float width, float footprint) {
  float w = max(width, footprint * 1.5);
  float d = abs(fract(x + 0.5) - 0.5);
  return (exp(-d / w) + 0.35 * exp(-d / (w * 2.5)) * glow) * (width / w);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = (coord - tunnelCenter * iResolution.xy) / iResolution.y;
  vec2 a = abs(p) + 1e-5;
  float r = pow(pow(a.x, shapeRoundness) + pow(a.y, shapeRoundness), 1.0 / shapeRoundness);
  float depth = 1.0 / max(r, 1e-3);
  float around = atan(p.y, p.x) / 6.2831853;

  // The angle wraps at +-180 degrees; take the footprint from whichever form is seamless here.
  float aroundFootprint = min(fwidth(around), fwidth(fract(around + 0.5)));
  float rings = neonLine(depth * ringSpacing + iTime * speed * 0.5, lineWidth, fwidth(depth) * ringSpacing);
  float lines = neonLine(around * float(segments) + twist * depth, lineWidth * 0.6,
                         aroundFootprint * float(segments) + abs(twist) * fwidth(depth));
  float distanceFade = exp(-depth * fog * 0.12) * smoothstep(0.0, 0.03, r);

  vec3 light = (ringColor * rings + lineColor * lines * 0.8) * distanceFade;
  float coverage = (rings + lines * 0.8) * distanceFade;

  if (transparentBackground) {
    fragColor = vec4(clamp(light / max(coverage, 1e-4), 0.0, 1.0), clamp(coverage, 0.0, 1.0));
  } else {
    fragColor = vec4(backgroundColor + light, 1.0);
  }
}
