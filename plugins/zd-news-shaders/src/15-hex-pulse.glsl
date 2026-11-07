// Hex Pulse - single Image pass, Shadertoy compatible.
//
// A honeycomb of glass-like hexagons that light up in rings rolling out from a point, with the
// odd cell flashing on its own. For election and results screens, tech and science segments,
// sports stats, or as a texture behind numbers. Turn on transparentBackground to overlay it.
//
// Inspired by Shadertoy favourites built on hexagonal and Voronoi cell grids; written from
// scratch. Each pixel finds its hexagon from two offset rectangular lattices, the edge distance
// gives crisp outlines and a gap, and every cell takes its light from its centre's distance to
// waveOrigin, so whole cells switch on together. Sizes are in pixels at Resolution scale 1.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.010, 0.020, 0.050);
#pragma ograf lineColor color
const vec3 lineColor = vec3(0.150, 0.450, 0.850);
#pragma ograf glowColor color
const vec3 glowColor = vec3(0.300, 0.900, 1.000);
#pragma ograf hexSize slider min(12) max(240) step(1)
const float hexSize = 70.0;
#pragma ograf lineWidth slider min(0.5) max(6) step(0.1)
const float lineWidth = 1.5;
#pragma ograf gap slider min(0) max(20) step(0.5)
const float gap = 3.0;
#pragma ograf waveOrigin vector2 min(-1) max(2)
const vec2 waveOrigin = vec2(0.5, 0.5);
#pragma ograf ringSpacing slider min(0.5) max(10) step(0.1)
const float ringSpacing = 2.5;
#pragma ograf waveSpeed slider min(-3) max(3) step(0.01)
const float waveSpeed = 0.5;
#pragma ograf waveSharpness slider min(1) max(12) step(0.1)
const float waveSharpness = 4.0;
#pragma ograf sparkle slider min(0) max(1) step(0.01)
const float sparkle = 0.3;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Pointy-topped hexagons of unit width: xy = offset from the cell centre, zw = cell id.
vec4 hexCell(vec2 p) {
  vec2 spacing = vec2(1.0, 1.7320508);
  vec2 a = (floor(p / spacing) + 0.5) * spacing;
  vec2 b = (floor((p - 0.5 * spacing) / spacing) + 1.0) * spacing;
  vec2 toA = p - a;
  vec2 toB = p - b;
  return dot(toA, toA) < dot(toB, toB) ? vec4(toA, a) : vec4(toB, b);
}

// 0.5 on the hexagon's edge, 0 at its centre.
float hexRadius(vec2 offset) {
  offset = abs(offset);
  return max(dot(offset, vec2(0.5, 0.8660254)), offset.x);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec4 cell = hexCell(coord / hexSize);
  float edgePx = (0.5 - hexRadius(cell.xy)) * hexSize;

  float line = 1.0 - smoothstep(0.5 * lineWidth, 0.5 * lineWidth + 1.0, edgePx);
  float inside = smoothstep(gap, gap + 1.0, edgePx);

  vec2 centre = cell.zw * hexSize;
  float reach = length(centre - waveOrigin * iResolution.xy) / iResolution.y;
  float ring = pow(0.5 + 0.5 * cos(6.2831853 * (reach * ringSpacing - iTime * waveSpeed)), waveSharpness);

  float clock = iTime * 0.8 + hash12(cell.zw) * 10.0;
  float flash = step(1.0 - 0.12 * sparkle, hash12(cell.zw + floor(clock))) * (1.0 - fract(clock));

  float fill = inside * (0.75 * ring + flash) * (0.55 + 0.45 * smoothstep(0.0, 0.5, edgePx / hexSize));
  float stroke = line * (0.35 + 0.65 * ring);
  float alpha = clamp(stroke + fill * 0.85, 0.0, 1.0);
  vec3 color = mix(lineColor, glowColor, clamp(fill * 1.5 + ring * 0.4, 0.0, 1.0));

  if (transparentBackground) {
    fragColor = vec4(color, alpha);
  } else {
    fragColor = vec4(mix(backgroundColor, color, alpha), 1.0);
  }
}
