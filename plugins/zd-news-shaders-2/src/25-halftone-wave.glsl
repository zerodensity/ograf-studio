// Halftone Wave - single Image pass, Shadertoy compatible.
//
// Pop-art halftone: two screens of ink dots that swell and shrink in rolling waves over paper.
// For entertainment and culture promos, quizzes, comic-style titles and bold sports packaging.
// Turn off twoTone for a single ink, or on transparentBackground to print only the dots.
//
// Technique: the frame is cut into a rotated grid; every dot samples a moving wave field at its
// own cell centre, so dots change size as a whole and stay perfectly round. The second screen
// is offset half a cell, runs a phase behind and prints smaller; inks multiply, like real print,
// so overlaps darken and the paper shows through between waves.
// Sizes are in pixels at Resolution scale 1.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf paperColor color
const vec3 paperColor = vec3(0.980, 0.930, 0.820);
#pragma ograf inkColor color
const vec3 inkColor = vec3(0.950, 0.150, 0.350);
#pragma ograf secondInkColor color
const vec3 secondInkColor = vec3(0.000, 0.650, 0.900);
#pragma ograf twoTone toggle
const bool twoTone = true;
#pragma ograf cellSize slider min(6) max(80) step(0.5)
const float cellSize = 22.0;
#pragma ograf gridAngle slider min(-90) max(90) step(1)
const float gridAngle = 45.0;
#pragma ograf waveScale slider min(0.5) max(6) step(0.05)
const float waveScale = 2.0;
#pragma ograf waveSpeed slider min(0) max(3) step(0.01)
const float waveSpeed = 0.6;
#pragma ograf minDot slider min(0) max(1) step(0.01)
const float minDot = 0.0;
#pragma ograf maxDot slider min(0) max(1.2) step(0.01)
const float maxDot = 0.8;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float field(vec2 uv, float aspect, float phase) {
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  float t = iTime * waveSpeed + phase;
  float wave = 0.5 + 0.25 * sin(q.x * waveScale * 3.0 + 2.0 * t) + 0.25 * sin(length(q) * waveScale * 6.0 - 3.0 * t);
  return smoothstep(0.2, 0.9, wave);
}

// Coverage of one halftone screen; `shift` offsets the grid by a fraction of a cell.
float screen(vec2 coord, vec2 shift, float phase, float scale) {
  float angle = radians(gridAngle);
  mat2 toGrid = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 g = toGrid * coord / cellSize + shift;
  vec2 cell = floor(g) + 0.5;
  vec2 centre = transpose(toGrid) * ((cell - shift) * cellSize);
  float aspect = iResolution.x / iResolution.y;
  float f = field(centre / iResolution.xy, aspect, phase);
  float radius = mix(minDot, maxDot, f) * scale * cellSize * 0.7071;
  float d = length(g - cell) * cellSize;
  return 1.0 - smoothstep(radius - 0.75, radius + 0.75, d);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  float first = screen(coord, vec2(0.0), 0.0, 1.0);
  float second = twoTone ? screen(coord, vec2(0.5), 1.3, 0.7) : 0.0;

  vec3 printed = paperColor * mix(vec3(1.0), inkColor, first) * mix(vec3(1.0), secondInkColor, second);
  if (transparentBackground) {
    float alpha = max(first, second);
    vec3 ink = mix(vec3(1.0), inkColor, first) * mix(vec3(1.0), secondInkColor, second);
    fragColor = vec4(ink, alpha);
  } else {
    fragColor = vec4(printed, 1.0);
  }
}
