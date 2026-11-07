// Flow Lines - single Image pass, Shadertoy compatible.
//
// A bundle of thin glowing lines that ripple across the frame, colour-graded from one line to
// the next. Elegant behind business, markets and politics graphics, and light enough to sit
// under a lower third. Turn on transparentBackground to overlay just the lines.
//
// Technique: each line is a sum of two sine waves tapered towards the frame edges. The distance
// to the curve is corrected by its slope, so lines keep an even pixel thickness even on steep
// sections. Thickness is in pixels at Resolution scale 1.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.010, 0.030, 0.080);
#pragma ograf firstLineColor color
const vec3 firstLineColor = vec3(0.200, 0.700, 1.000);
#pragma ograf lastLineColor color
const vec3 lastLineColor = vec3(0.650, 0.300, 1.000);
#pragma ograf lineCount slider min(1) max(40) step(1)
const int lineCount = 16;
#pragma ograf spread slider min(0) max(1) step(0.01)
const float spread = 0.55;
#pragma ograf amplitude slider min(0) max(0.5) step(0.005)
const float amplitude = 0.12;
#pragma ograf waveLength slider min(0.1) max(2) step(0.01)
const float waveLength = 0.65;
#pragma ograf waveSpeed slider min(0) max(3) step(0.01)
const float waveSpeed = 0.6;
#pragma ograf thickness slider min(0.5) max(8) step(0.1)
const float thickness = 1.5;
#pragma ograf glow slider min(0) max(1) step(0.01)
const float glow = 0.4;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float lineHeight(float x, float lineT) {
  float k = 6.2831853 / waveLength;
  float phase = iTime * waveSpeed + lineT * 2.4;
  float taper = sin(3.1415927 * clamp(x, 0.0, 1.0));
  float base = 0.5 + (lineT - 0.5) * spread;
  return base + amplitude * taper * (sin(x * k + phase) + 0.4 * sin(x * k * 0.53 - 0.7 * phase + 4.0 * lineT));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float pixelX = 1.0 / iResolution.x;
  float halfWidth = 0.5 * thickness;
  // Lines taper to nothing at the box edges; when zoomed out, nothing is drawn beyond them.
  float inside = step(0.0, uv.x) * step(uv.x, 1.0);

  vec3 light = vec3(0.0);
  float coverage = 0.0;
  for (int i = 0; i < 40; i++) {
    if (i >= lineCount) break;
    float lineT = lineCount > 1 ? float(i) / float(lineCount - 1) : 0.5;
    float y = lineHeight(uv.x, lineT);
    float slope = (lineHeight(uv.x + pixelX, lineT) - lineHeight(uv.x - pixelX, lineT)) * 0.5 * iResolution.y;
    float distancePx = abs(uv.y - y) * iResolution.y / sqrt(1.0 + slope * slope);
    float core = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.75, distancePx);
    float halo = glow * 0.5 * exp(-distancePx / (thickness * 6.0));
    float intensity = (core + halo) * inside;
    light += mix(firstLineColor, lastLineColor, lineT) * intensity;
    coverage += intensity;
  }

  if (transparentBackground) {
    float alpha = clamp(coverage, 0.0, 1.0);
    fragColor = vec4(clamp(light / max(coverage, 1e-4), 0.0, 1.0), alpha);
  } else {
    fragColor = vec4(backgroundColor + light, 1.0);
  }
}
