// Data Grid - single Image pass, Shadertoy compatible.
//
// A technical grid with cross markers, a scanning band that sweeps down the frame and cells
// that blink on at random. For elections, data walls, tech and finance segments, or as a
// subtle texture behind numbers. Turn on transparentBackground to lay the grid over video.
//
// Technique: grid lines and markers come from the pixel distance to the nearest cell edge, so
// they stay crisp at any zoom. Blinking cells re-roll on a fixed clock per cell, so a given
// frame always looks the same on seek. Sizes are in pixels at Resolution scale 1.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.010, 0.025, 0.060);
#pragma ograf gridColor color
const vec3 gridColor = vec3(0.100, 0.350, 0.600);
#pragma ograf highlightColor color
const vec3 highlightColor = vec3(0.300, 0.850, 1.000);
#pragma ograf cellSize slider min(8) max(200) step(1)
const float cellSize = 48.0;
#pragma ograf lineWidth slider min(0.5) max(4) step(0.1)
const float lineWidth = 1.0;
#pragma ograf gridOpacity slider min(0) max(1) step(0.01)
const float gridOpacity = 0.35;
#pragma ograf scanSeconds slider min(0.5) max(20) step(0.1)
const float scanSeconds = 6.0;
#pragma ograf scanWidth slider min(0.01) max(0.6) step(0.01)
const float scanWidth = 0.15;
#pragma ograf blinkAmount slider min(0) max(1) step(0.01)
const float blinkAmount = 0.35;
#pragma ograf blinkRate slider min(0) max(4) step(0.05)
const float blinkRate = 0.6;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  vec2 grid = coord / cellSize;
  vec2 cell = floor(grid);
  vec2 toEdge = min(fract(grid), 1.0 - fract(grid)) * cellSize;

  float line = 1.0 - smoothstep(0.5 * lineWidth, 0.5 * lineWidth + 1.0, min(toEdge.x, toEdge.y));
  float marker = 1.0 - smoothstep(lineWidth + 1.5, lineWidth + 3.0, length(toEdge));

  // The band enters above the frame and leaves below it, so the loop has no visible jump.
  float scanY = mix(1.02, -3.0 * scanWidth, fract(iTime / scanSeconds));
  float dy = uv.y - scanY;
  float scan = dy >= 0.0 ? exp(-dy / scanWidth * 1.8) : exp(dy / (scanWidth * 0.08));

  float clock = iTime * blinkRate + hash12(cell) * 10.0;
  float roll = hash12(cell + floor(clock) * vec2(13.1, 7.7));
  float blink = step(1.0 - 0.25 * blinkAmount, roll) * (1.0 - fract(clock));

  float strokes = max(line, marker);
  float alpha = clamp(strokes * (gridOpacity + scan) + 0.12 * scan + blink * 0.35 * (0.5 + scan), 0.0, 1.0);
  vec3 color = mix(gridColor, highlightColor, clamp(scan + 2.0 * blink, 0.0, 1.0));

  if (transparentBackground) {
    fragColor = vec4(color, alpha);
  } else {
    fragColor = vec4(mix(backgroundColor, color, alpha), 1.0);
  }
}
