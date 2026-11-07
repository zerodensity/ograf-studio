// Live Pulse - single Image pass, Shadertoy compatible.
//
// A breathing dot sending out expanding rings: the universal "we are live" and "it happened
// here" signal. Put it in a LIVE bug, next to a reporter's location on a map, on a breaking
// alert or a recording indicator. Transparent by default.
//
// Technique: ringCount ripples share one cycle, evenly offset; each eases out as it grows and
// fades, so the pulse looks continuous. Sizes are in pixels at Resolution scale 1; use
// pulseCenter to place it anywhere in the object.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; turn transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf dotColor color
const vec3 dotColor = vec3(1.000, 0.150, 0.200);
#pragma ograf ringColor color
const vec3 ringColor = vec3(1.000, 0.300, 0.350);
#pragma ograf pulseCenter vector2 min(-0.5) max(1.5)
const vec2 pulseCenter = vec2(0.5, 0.5);
#pragma ograf dotRadius slider min(2) max(100) step(0.5)
const float dotRadius = 18.0;
#pragma ograf ringCount slider min(1) max(5) step(1)
const int ringCount = 3;
#pragma ograf pulseSeconds slider min(0.3) max(6) step(0.05)
const float pulseSeconds = 1.6;
#pragma ograf maxRadius slider min(10) max(600) step(1)
const float maxRadius = 120.0;
#pragma ograf ringWidth slider min(0.5) max(20) step(0.5)
const float ringWidth = 3.0;
#pragma ograf breathing slider min(0) max(1) step(0.01)
const float breathing = 0.2;
#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.020, 0.020, 0.040);
#pragma ograf transparentBackground toggle
const bool transparentBackground = true;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

void over(inout vec3 premultiplied, inout float alpha, vec3 color, float coverage) {
  coverage = clamp(coverage, 0.0, 1.0);
  premultiplied = premultiplied * (1.0 - coverage) + color * coverage;
  alpha = alpha * (1.0 - coverage) + coverage;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  float d = length(coord - pulseCenter * iResolution.xy);
  float beat = sin(iTime * 6.2831853 / pulseSeconds);
  float radius = dotRadius * (1.0 + breathing * 0.15 * beat);

  vec3 premultiplied = transparentBackground ? vec3(0.0) : backgroundColor;
  float alpha = transparentBackground ? 0.0 : 1.0;

  for (int k = 0; k < 5; k++) {
    if (k >= ringCount) break;
    float phase = fract(iTime / pulseSeconds + float(k) / float(ringCount));
    float eased = 1.0 - (1.0 - phase) * (1.0 - phase);
    float ringRadius = mix(radius, maxRadius, eased);
    float strength = pow(1.0 - phase, 1.5);
    float ring = (1.0 - smoothstep(0.5 * ringWidth - 0.5, 0.5 * ringWidth + 0.75, abs(d - ringRadius))) * strength;
    float wash = 0.08 * strength * (1.0 - smoothstep(ringRadius - 1.0, ringRadius, d));
    over(premultiplied, alpha, ringColor, max(ring, wash));
  }

  float glow = exp(-max(d - radius, 0.0) / max(radius, 1.0)) * 0.35;
  over(premultiplied, alpha, dotColor, glow);
  float dotMask = 1.0 - smoothstep(radius - 0.75, radius + 0.75, d);
  vec3 dotShade = dotColor * (1.0 + 0.25 * smoothstep(radius, 0.0, d));
  over(premultiplied, alpha, clamp(dotShade, 0.0, 1.0), dotMask);

  fragColor = vec4(clamp(premultiplied / max(alpha, 1e-4), 0.0, 1.0), alpha);
}
