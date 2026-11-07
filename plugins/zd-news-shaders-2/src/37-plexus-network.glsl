// Plexus Network - single Image pass, Shadertoy compatible.
//
// Drifting nodes joined by lines that fade with distance: the connected-world look of tech,
// telecom, finance and corporate graphics. For business news, cyber and data stories, network
// and "connected" themes, or a calm moving texture behind numbers.
//
// Inspired by the plexus and "universe within" style networks loved on Shadertoy; written from
// scratch. Every cell owns one orbiting node; a pixel connects the nodes of its 3x3
// neighbourhood (centre to all, plus the ring around it), with each line's brightness set by
// its length, so the web keeps forming and breaking as nodes move. Sizes are in pixels.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.010, 0.020, 0.050);
#pragma ograf lineColor color
const vec3 lineColor = vec3(0.300, 0.700, 1.000);
#pragma ograf nodeColor color
const vec3 nodeColor = vec3(0.800, 0.950, 1.000);
#pragma ograf cellSize slider min(40) max(400) step(1)
const float cellSize = 110.0;
#pragma ograf lineWidth slider min(0.5) max(4) step(0.1)
const float lineWidth = 1.2;
#pragma ograf nodeSize slider min(1) max(12) step(0.1)
const float nodeSize = 3.5;
#pragma ograf motionSpeed slider min(0) max(2) step(0.01)
const float motionSpeed = 0.4;
#pragma ograf reach slider min(0.5) max(2.5) step(0.01)
const float reach = 1.6;
#pragma ograf brightness slider min(0) max(2) step(0.01)
const float brightness = 1.0;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

vec2 hash22(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

vec2 nodeOf(vec2 cell) {
  vec2 h = hash22(cell);
  float phase = iTime * motionSpeed * (0.5 + h.x) + h.y * 6.2831853;
  return cell + 0.5 + 0.35 * vec2(sin(phase), cos(phase * 0.9 + 1.3));
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

float link(vec2 p, vec2 a, vec2 b) {
  float d = segmentDistance(p, a, b) * cellSize;
  float fade = smoothstep(reach, reach * 0.5, length(a - b));
  return (1.0 - smoothstep(0.5 * lineWidth - 0.5, 0.5 * lineWidth + 0.75, d)) * fade;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = coord / cellSize;
  vec2 cell = floor(p);

  vec2 nodes[9];
  for (int j = 0; j < 3; j++)
    for (int i = 0; i < 3; i++) nodes[j * 3 + i] = nodeOf(cell + vec2(float(i - 1), float(j - 1)));

  float lines = 0.0;
  for (int k = 0; k < 9; k++)
    if (k != 4) lines = max(lines, link(p, nodes[4], nodes[k]));
  lines = max(lines, link(p, nodes[1], nodes[3]));
  lines = max(lines, link(p, nodes[1], nodes[5]));
  lines = max(lines, link(p, nodes[7], nodes[3]));
  lines = max(lines, link(p, nodes[7], nodes[5]));

  float dots = 0.0;
  for (int k = 0; k < 9; k++) {
    float d = length(p - nodes[k]) * cellSize;
    float pulse = 0.75 + 0.25 * sin(iTime * 2.0 + 6.2831853 * hash22(floor(nodes[k])).x);
    dots = max(dots, (1.0 - smoothstep(nodeSize - 0.75, nodeSize + 0.75, d)) * pulse + 0.25 * exp(-d / (nodeSize * 2.5)));
  }

  float lineAlpha = clamp(lines * 0.9 * brightness, 0.0, 1.0);
  float dotAlpha = clamp(dots * brightness, 0.0, 1.0);
  vec3 premultiplied = transparentBackground ? vec3(0.0) : backgroundColor;
  float alpha = transparentBackground ? 0.0 : 1.0;
  premultiplied = premultiplied * (1.0 - lineAlpha) + lineColor * lineAlpha;
  alpha = alpha * (1.0 - lineAlpha) + lineAlpha;
  premultiplied = premultiplied * (1.0 - dotAlpha) + nodeColor * dotAlpha;
  alpha = alpha * (1.0 - dotAlpha) + dotAlpha;
  fragColor = vec4(clamp(premultiplied / max(alpha, 1e-4), 0.0, 1.0), alpha);
}
