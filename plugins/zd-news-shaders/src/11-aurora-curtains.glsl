// Aurora Curtains - single Image pass, Shadertoy compatible.
//
// Curtains of northern light rippling over a starry night sky. For election nights, weather and
// late-night shows, or any title that needs a calm, premium backdrop. Turn on
// transparentBackground to lay only the aurora over another background.
//
// Inspired by the idea behind nimitz's much-loved "Auroras" on Shadertoy; this is a new and much
// cheaper 2D take written from scratch. Each curtain is a wandering lower hem from 1D value noise,
// a glow that decays upwards, and fine vertical rays that drift along it.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf skyTop color
const vec3 skyTop = vec3(0.004, 0.008, 0.035);
#pragma ograf skyBottom color
const vec3 skyBottom = vec3(0.020, 0.055, 0.110);
#pragma ograf lowColor color
const vec3 lowColor = vec3(0.100, 1.000, 0.550);
#pragma ograf highColor color
const vec3 highColor = vec3(0.550, 0.250, 1.000);
#pragma ograf curtainCount slider min(1) max(5) step(1)
const int curtainCount = 3;
#pragma ograf intensity slider min(0) max(3) step(0.01)
const float intensity = 1.2;
#pragma ograf curtainHeight slider min(0.05) max(0.8) step(0.01)
const float curtainHeight = 0.3;
#pragma ograf waviness slider min(0) max(0.3) step(0.005)
const float waviness = 0.16;
#pragma ograf flowSpeed slider min(0) max(1) step(0.01)
const float flowSpeed = 0.12;
#pragma ograf rayDetail slider min(0) max(1) step(0.01)
const float rayDetail = 0.6;
#pragma ograf starAmount slider min(0) max(1) step(0.01)
const float starAmount = 0.5;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
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

float hem(float x, float t) {
  return 0.6 * noise1(x + t) + 0.3 * noise1(x * 2.3 - 1.3 * t + 7.0) + 0.1 * noise1(x * 5.1 + 0.7 * t + 3.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float x = uv.x * iResolution.x / iResolution.y;
  float t = iTime * flowSpeed;

  vec3 light = vec3(0.0);
  float coverage = 0.0;
  for (int k = 0; k < 5; k++) {
    if (k >= curtainCount) break;
    float layer = float(k);
    float depth = 1.0 - 0.18 * layer;
    float base = 0.36 + 0.09 * layer + 2.0 * waviness * (hem(2.0 * x + 4.0 * layer, t * (1.0 + 0.3 * layer)) - 0.5);
    float d = uv.y - base;
    float rays = mix(1.0, 0.35 + 0.65 * noise1(x * 60.0 / depth + 13.0 * layer + 3.0 * t), rayDetail);
    rays *= mix(1.0, 0.6 + 0.4 * noise1(x * 7.0 - 2.0 * t + layer), rayDetail);
    float body = smoothstep(-0.004, 0.02, d) * exp(-max(d, 0.0) / (curtainHeight * depth));
    // Curtains come and go along their length instead of spanning the whole sky.
    float patches = 0.05 + 0.95 * smoothstep(0.25, 0.8, noise1(1.1 * x + 3.7 * layer - 0.6 * t));
    float glow = (body + 0.5 * exp(-abs(d) * 60.0)) * rays * depth * patches * intensity * 0.6;
    light += mix(lowColor, highColor, smoothstep(0.0, curtainHeight * depth, d)) * glow;
    coverage += glow;
  }

  if (transparentBackground) {
    fragColor = vec4(clamp(light / max(coverage, 1e-4), 0.0, 1.0), clamp(coverage, 0.0, 1.0));
    return;
  }
  vec3 sky = mix(skyBottom, skyTop, clamp(uv.y, 0.0, 1.0));
  vec2 cell = floor(coord / 6.0);
  float pick = hash12(cell);
  vec2 starAt = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) * 6.0;
  float star = step(1.0 - 0.02 * starAmount, pick) * smoothstep(1.3, 0.0, length(mod(coord, 6.0) - starAt));
  star *= 0.6 + 0.4 * sin(iTime * (1.0 + 3.0 * pick) + 40.0 * pick);
  fragColor = vec4(sky + vec3(star) * smoothstep(0.2, 0.8, uv.y) + light, 1.0);
}
