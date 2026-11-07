// Progress Ring - single Image pass, Shadertoy compatible.
//
// A clean circular gauge with a gradient arc, rounded ends, a glowing head and tick marks.
// For shot clocks and countdowns, poll and turnout percentages, fundraising totals, loading
// and "starting soon" screens. Transparent by default so it sits on any panel.
//
// Drive it three ways: leave autoCountdown on for a repeating countdown of countdownSeconds;
// turn it off and keyframe progress (0..1); or bind progress to a data field so playout sets
// the value, for example a percentage divided by 100.
//
// Technique: polar coordinates measured clockwise from 12 o'clock; round caps are circles at
// both ends of the arc, which also hide the hard angular cut. Sizes are in pixels.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; turn transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf progress slider min(0) max(1) step(0.001)
const float progress = 0.65;
#pragma ograf autoCountdown toggle
const bool autoCountdown = true;
#pragma ograf countdownSeconds slider min(1) max(120) step(0.5)
const float countdownSeconds = 10.0;
#pragma ograf trackColor color
const vec3 trackColor = vec3(0.200, 0.220, 0.280);
#pragma ograf startColor color
const vec3 startColor = vec3(0.100, 0.800, 1.000);
#pragma ograf endColor color
const vec3 endColor = vec3(0.550, 0.300, 1.000);
#pragma ograf ringCenter vector2 min(-0.5) max(1.5)
const vec2 ringCenter = vec2(0.5, 0.5);
#pragma ograf ringRadius slider min(0.05) max(0.6) step(0.005)
const float ringRadius = 0.35;
#pragma ograf thickness slider min(2) max(80) step(0.5)
const float thickness = 24.0;
#pragma ograf tickCount slider min(0) max(120) step(1)
const int tickCount = 60;
#pragma ograf tickOpacity slider min(0) max(1) step(0.01)
const float tickOpacity = 0.5;
#pragma ograf headGlow slider min(0) max(2) step(0.01)
const float headGlow = 1.0;
#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.020, 0.030, 0.060);
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
  vec2 p = coord - ringCenter * iResolution.xy;
  float radius = ringRadius * iResolution.y;
  float r = length(p);
  float turn = fract(atan(p.x, p.y) / 6.2831853);
  float amount = autoCountdown ? 1.0 - fract(iTime / countdownSeconds) : clamp(progress, 0.0, 1.0);
  float halfWidth = 0.5 * thickness;

  vec3 premultiplied = transparentBackground ? vec3(0.0) : backgroundColor;
  float alpha = transparentBackground ? 0.0 : 1.0;

  float band = 1.0 - smoothstep(halfWidth - 0.75, halfWidth + 0.75, abs(r - radius));
  over(premultiplied, alpha, trackColor, band);

  if (tickCount > 0) {
    float ticks = float(tickCount);
    float slot = turn * ticks;
    float majorTick = mod(floor(slot + 0.5), 5.0) < 0.5 ? 1.0 : 0.0;
    float across = abs(fract(slot + 0.5) - 0.5) / ticks * 6.2831853 * r;
    float inner = radius + halfWidth + 6.0;
    float length_ = thickness * (majorTick > 0.0 ? 0.8 : 0.45);
    float radial = step(inner, r) * step(r, inner + length_);
    float tick = (1.0 - smoothstep(0.75, 1.75, across)) * radial;
    over(premultiplied, alpha, trackColor * 2.2, tick * tickOpacity);
  }

  if (amount > 0.0) {
    float angle = amount * 6.2831853;
    vec2 startAt = vec2(0.0, radius);
    vec2 endAt = radius * vec2(sin(angle), cos(angle));
    float arc = step(turn, amount) * band;
    float caps = max(1.0 - smoothstep(halfWidth - 0.75, halfWidth + 0.75, length(p - startAt)),
                     1.0 - smoothstep(halfWidth - 0.75, halfWidth + 0.75, length(p - endAt)));
    float fill = max(arc, caps);
    float along = clamp(turn / max(amount, 1e-4), 0.0, 1.0);
    if (length(p - startAt) < halfWidth + 1.0 && turn > amount) along = 0.0;
    vec3 color = mix(startColor, endColor, along);
    over(premultiplied, alpha, color, fill);
    float glow = exp(-length(p - endAt) / max(thickness * 0.8, 1.0)) * headGlow * 0.6;
    over(premultiplied, alpha, endColor * 1.3, glow * (1.0 - fill));
  }

  fragColor = vec4(clamp(premultiplied / max(alpha, 1e-4), 0.0, 1.0), alpha);
}
