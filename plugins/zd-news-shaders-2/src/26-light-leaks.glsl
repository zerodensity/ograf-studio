// Light Leaks - single Image pass, Shadertoy compatible.
//
// The warm glow of light leaking into a film camera, with grain, dust specks, gate flicker and
// a vignette. A finishing overlay for documentaries, archive and "on this day" segments,
// nostalgic promos and wedding-style features. Transparent by default: lay it over video.
//
// Technique: three soft blobs hug the frame edges on slow orbits, bent by value noise; grain
// and dust re-roll on a 24 fps clock. The layers are composited in order (vignette, leaks,
// grain, dust), so the output alpha is exact for straight-alpha playout.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; turn transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf leakColor color
const vec3 leakColor = vec3(1.000, 0.450, 0.150);
#pragma ograf secondLeakColor color
const vec3 secondLeakColor = vec3(1.000, 0.850, 0.400);
#pragma ograf leakAmount slider min(0) max(2) step(0.01)
const float leakAmount = 1.0;
#pragma ograf leakSpeed slider min(0) max(2) step(0.01)
const float leakSpeed = 0.3;
#pragma ograf grain slider min(0) max(1) step(0.01)
const float grain = 0.35;
#pragma ograf dust slider min(0) max(1) step(0.01)
const float dust = 0.3;
#pragma ograf flicker slider min(0) max(1) step(0.01)
const float flicker = 0.2;
#pragma ograf vignette slider min(0) max(1) step(0.01)
const float vignette = 0.45;
#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.000, 0.000, 0.000);
#pragma ograf transparentBackground toggle
const bool transparentBackground = true;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Premultiplied "over": paints colour with coverage onto the accumulated layer.
void over(inout vec3 premultiplied, inout float alpha, vec3 color, float coverage) {
  coverage = clamp(coverage, 0.0, 1.0);
  premultiplied = premultiplied * (1.0 - coverage) + color * coverage;
  alpha = alpha * (1.0 - coverage) + coverage;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = iTime * leakSpeed;

  vec3 premultiplied = transparentBackground ? vec3(0.0) : backgroundColor;
  float alpha = transparentBackground ? 0.0 : 1.0;

  float edge = length(uv - 0.5) * 1.4;
  over(premultiplied, alpha, vec3(0.0), vignette * smoothstep(0.35, 1.0, edge));

  vec2 bend = 0.25 * (vec2(valueNoise(p * 1.5 + t), valueNoise(p * 1.5 - t + 4.0)) - 0.5);
  vec2 w = p + bend;
  float gate = 1.0 + flicker * (noise1(iTime * 12.0) - 0.5);
  vec2 c1 = vec2(-0.05 + 0.25 * sin(0.7 * t), 0.5 + 0.45 * sin(0.37 * t));
  vec2 c2 = vec2(aspect + 0.05 - 0.25 * sin(0.53 * t + 1.0), 0.5 + 0.45 * cos(0.41 * t));
  vec2 c3 = vec2(aspect * (0.5 + 0.45 * sin(0.29 * t + 2.0)), 1.05);
  float l1 = exp(-dot(w - c1, w - c1) / 0.18);
  float l2 = exp(-dot(w - c2, w - c2) / 0.12);
  float l3 = exp(-dot(w - c3, w - c3) / 0.08);
  float leak = (l1 + l2 + 0.7 * l3) * leakAmount * gate;
  vec3 tint = mix(leakColor, secondLeakColor, clamp(l2 / max(l1 + l2 + l3, 1e-4) + 0.3 * l3, 0.0, 1.0));
  over(premultiplied, alpha, tint, leak * 0.75);

  float frame = floor(iTime * 24.0);
  float speck = hash12(floor(coord) + frame * 17.0) - 0.5;
  over(premultiplied, alpha, vec3(step(0.0, speck)), grain * 0.18 * abs(speck) * 2.0);

  vec2 dustCell = floor(coord / 60.0);
  float dustPick = hash12(dustCell + frame * 3.1);
  vec2 dustAt = (dustCell + vec2(hash12(dustCell + frame), hash12(dustCell - frame))) * 60.0;
  float mote = (1.0 - smoothstep(0.8, 2.0, length(coord - dustAt))) * step(1.0 - 0.01 * dust, dustPick);
  over(premultiplied, alpha, vec3(step(0.5, hash12(dustCell + frame * 7.0))), mote * 0.8);

  fragColor = vec4(clamp(premultiplied / max(alpha, 1e-4), 0.0, 1.0), alpha);
}
