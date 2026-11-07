// Equalizer Bars - single Image pass, Shadertoy compatible.
//
// A lively audio spectrum: LED-segment bars graded from green to red, with falling peak caps.
// For music shows, radio simulcasts, podcasts, "now playing" straps and sound-on bumpers.
// It is procedural, not driven by audio: the motion is a believable beat that loops forever.
//
// Technique: each bar's level mixes two value-noise rates with a shared kick and a bass bias
// towards the left. Peak caps take the highest of a few recent levels, so they hang and drop
// without stored state. segments = 0 gives solid bars; mirror reflects them about the middle.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.010, 0.010, 0.030);
#pragma ograf lowColor color
const vec3 lowColor = vec3(0.100, 0.900, 0.500);
#pragma ograf midColor color
const vec3 midColor = vec3(1.000, 0.850, 0.200);
#pragma ograf highColor color
const vec3 highColor = vec3(1.000, 0.250, 0.250);
#pragma ograf barCount slider min(4) max(64) step(1)
const int barCount = 24;
#pragma ograf gap slider min(0) max(0.9) step(0.01)
const float gap = 0.3;
#pragma ograf segments slider min(0) max(40) step(1)
const int segments = 16;
#pragma ograf energy slider min(0) max(1.5) step(0.01)
const float energy = 1.0;
#pragma ograf tempo slider min(0.2) max(4) step(0.01)
const float tempo = 1.2;
#pragma ograf mirror toggle
const bool mirror = false;
#pragma ograf peakCaps toggle
const bool peakCaps = true;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

float level(float bar, float count, float t) {
  float position = bar / count;
  float kick = pow(0.5 + 0.5 * sin(t * tempo * 6.2831853), 4.0);
  float wander = 0.6 * noise1(t * tempo * 2.0 + bar * 3.7) + 0.4 * noise1(t * tempo * 5.0 + bar * 1.3);
  float h = 0.12 + 0.7 * wander * mix(1.0, 0.55, position) + 0.25 * kick * (1.0 - position);
  return clamp(h * energy, 0.02, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float count = float(barCount);
  float bar = floor(uv.x * count);
  float across = fract(uv.x * count);
  float edge = fwidth(uv.x * count);
  float inBar = smoothstep(0.5 * gap, 0.5 * gap + edge, across) * smoothstep(1.0 - 0.5 * gap, 1.0 - 0.5 * gap - edge, across);
  inBar *= step(0.0, uv.x) * step(uv.x, 1.0);

  float y = mirror ? abs(uv.y - 0.5) * 2.0 : uv.y;
  float h = level(bar, count, iTime);
  float lit = 1.0 - smoothstep(h - fwidth(y), h, y);
  float unlit = 0.0;
  if (segments > 0) {
    float segmentsF = float(segments);
    float slot = fract(y * segmentsF);
    float slotEdge = fwidth(y * segmentsF);
    float led = smoothstep(0.18, 0.18 + slotEdge, slot);
    lit = step(floor(y * segmentsF) + 0.5, h * segmentsF) * led;
    unlit = 0.08 * led * step(y, 1.0);
  }
  vec3 color = y < 0.6 ? mix(lowColor, midColor, y / 0.6) : mix(midColor, highColor, (y - 0.6) / 0.4);

  float cap = 0.0;
  if (peakCaps) {
    float peak = max(max(h, level(bar, count, iTime - 0.15) * 0.97),
                     max(level(bar, count, iTime - 0.3) * 0.93, level(bar, count, iTime - 0.45) * 0.88)) + 0.02;
    cap = 1.0 - smoothstep(0.006, 0.006 + fwidth(y), abs(y - peak));
  }

  float alpha = clamp((lit + unlit + cap) * inBar, 0.0, 1.0);
  vec3 shown = mix(color * (lit + unlit * 4.0), highColor * 1.2, cap);
  if (transparentBackground) {
    fragColor = vec4(clamp(shown, 0.0, 1.0), alpha);
  } else {
    fragColor = vec4(mix(backgroundColor, shown, alpha), 1.0);
  }
}
