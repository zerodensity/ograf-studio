// Topo Lines - single Image pass, Shadertoy compatible.
//
// Animated contour lines of a slowly shifting landscape, with bolder index contours every few
// lines and an elevation colour ramp. For maps and geography, elections and constituencies,
// outdoor and climate stories, or a quiet textured background. Transparent option included.
//
// Technique: the terrain is drifting value-noise fbm; contours are iso-lines of that height.
// Each line's width comes from the screen-space derivative of the height, so lines stay one
// even weight on steep and flat ground alike, with no aliasing.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.020, 0.050, 0.080);
#pragma ograf lowColor color
const vec3 lowColor = vec3(0.150, 0.550, 0.700);
#pragma ograf highColor color
const vec3 highColor = vec3(0.900, 0.950, 0.700);
#pragma ograf lineCount slider min(4) max(60) step(1)
const float lineCount = 22.0;
#pragma ograf majorEvery slider min(0) max(10) step(1)
const int majorEvery = 5;
#pragma ograf terrainScale slider min(0.3) max(6) step(0.05)
const float terrainScale = 1.6;
#pragma ograf driftSpeed slider min(0) max(1) step(0.01)
const float driftSpeed = 0.05;
#pragma ograf lineWidth slider min(0.5) max(5) step(0.1)
const float lineWidth = 1.2;
#pragma ograf fillAmount slider min(0) max(1) step(0.01)
const float fillAmount = 0.25;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
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

float terrain(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * valueNoise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    amplitude *= 0.5;
  }
  return value;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = coord / iResolution.y * terrainScale;
  float t = iTime * driftSpeed;
  float height = terrain(p + vec2(t, 0.4 * t)) * 0.7 + 0.3 * terrain(p * 0.5 - vec2(0.3 * t, t) + 5.0);

  float level = height * lineCount;
  float footprint = max(fwidth(level), 1e-4);
  float d = abs(fract(level + 0.5) - 0.5) / footprint;
  float index = floor(level + 0.5);
  bool major = majorEvery > 0 && mod(index, float(majorEvery)) < 0.5;
  float width = major ? lineWidth * 2.0 : lineWidth;
  float line = (1.0 - smoothstep(0.5 * width - 0.5, 0.5 * width + 0.5, d)) * (major ? 1.0 : 0.65);

  float ramp = smoothstep(0.25, 0.8, height);
  vec3 tint = mix(lowColor, highColor, ramp);
  float band = floor(level) / lineCount;
  float alpha = clamp(line + fillAmount * smoothstep(0.25, 0.8, band) * 0.6, 0.0, 1.0);

  if (transparentBackground) {
    fragColor = vec4(tint, alpha);
  } else {
    fragColor = vec4(mix(backgroundColor, tint, alpha), 1.0);
  }
}
