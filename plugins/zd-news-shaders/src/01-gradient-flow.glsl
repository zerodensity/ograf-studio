// Gradient Flow - single Image pass, Shadertoy compatible.
//
// A soft "mesh gradient": large pools of brand colour drifting slowly over a deep base, with an
// optional vignette. Made for full-frame backgrounds, studio walls and the panel behind a
// headline: calm enough never to pull the eye away from the text in front of it.
//
// Technique: three Gaussian colour pools move on slow Lissajous orbits; a gentle value-noise
// warp bends their edges so the shapes stay organic. Everything is driven by iTime only, so
// scrubbing and goToTime() seeks are exact. flowScale sets how wavy the pool edges are.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas, so the same source runs there with these as defaults.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf deepColor color
const vec3 deepColor = vec3(0.016, 0.035, 0.110);
#pragma ograf midColor color
const vec3 midColor = vec3(0.000, 0.250, 0.600);
#pragma ograf highlightColor color
const vec3 highlightColor = vec3(0.000, 0.700, 0.920);
#pragma ograf highlightAmount slider min(0) max(1) step(0.01)
const float highlightAmount = 0.45;
#pragma ograf flowScale slider min(0.5) max(5) step(0.05)
const float flowScale = 1.6;
#pragma ograf flowSpeed slider min(0) max(2) step(0.01)
const float flowSpeed = 0.25;
#pragma ograf vignette slider min(0) max(1) step(0.01)
const float vignette = 0.35;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * valueNoise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    amplitude *= 0.5;
  }
  return value;
}

float pool(vec2 p, vec2 center, float radius) {
  vec2 d = p - center;
  return exp(-dot(d, d) / (radius * radius));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec2 p = (coord - 0.5 * iResolution.xy) / iResolution.y;
  float t = iTime * flowSpeed;

  vec2 warp = vec2(fbm(p * flowScale + vec2(0.0, 0.3 * t)), fbm(p * flowScale + vec2(4.1, 1.7) - vec2(0.3 * t, 0.0)));
  vec2 w = p + 0.35 * (warp - 0.5);

  float a = pool(w, vec2(-0.30 * aspect + 0.20 * sin(0.53 * t), 0.18 + 0.14 * cos(0.71 * t)), 0.55);
  float b = pool(w, vec2(0.28 * aspect + 0.18 * cos(0.47 * t + 1.0), -0.20 + 0.16 * sin(0.61 * t)), 0.45);
  float c = pool(w, vec2(0.05 * aspect + 0.30 * sin(0.37 * t + 2.0), 0.05 + 0.22 * sin(0.43 * t + 0.5)), 0.30);

  vec3 color = mix(deepColor, midColor, clamp(0.85 * a + 0.65 * b, 0.0, 1.0));
  color = mix(color, highlightColor, clamp(c * highlightAmount * 1.4, 0.0, 1.0));
  color += 0.06 * highlightAmount * highlightColor * smoothstep(0.6, 0.9, b);

  float edge = length(uv - 0.5) * 1.4;
  color *= mix(1.0, clamp(1.0 - edge * edge, 0.0, 1.0), vignette);
  fragColor = vec4(color, 1.0);
}
