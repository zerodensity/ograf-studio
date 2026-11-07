// Ink Smoke - single Image pass, Shadertoy compatible.
//
// Slow coils of coloured smoke rising through the dark, like ink dropped in water. For
// documentary and investigation openers, drama promos, mood behind a quote or an interview
// title. Turn on transparentBackground to drift the smoke over video or another layer.
//
// Inspired by Shadertoy favourites built on domain-warped noise, such as nimitz's
// "Protean Clouds" and the classic warped-fbm studies; written from scratch. Two rounds of fbm
// warp a third; ridges of the result become thin strands, and a slow mask leaves dark space.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.010, 0.010, 0.020);
#pragma ograf smokeColor color
const vec3 smokeColor = vec3(0.550, 0.700, 1.000);
#pragma ograf accentColor color
const vec3 accentColor = vec3(1.000, 0.350, 0.550);
#pragma ograf accentShare slider min(0) max(1) step(0.01)
const float accentShare = 0.4;
#pragma ograf density slider min(0) max(1) step(0.01)
const float density = 0.55;
#pragma ograf smokeScale slider min(0.5) max(6) step(0.05)
const float smokeScale = 1.2;
#pragma ograf riseSpeed slider min(-1) max(1) step(0.01)
const float riseSpeed = 0.15;
#pragma ograf swirl slider min(0) max(2) step(0.01)
const float swirl = 0.8;
#pragma ograf wispiness slider min(0) max(1) step(0.01)
const float wispiness = 0.6;
#pragma ograf brightness slider min(0) max(2) step(0.01)
const float brightness = 1.0;
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

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    value += amplitude * valueNoise(p);
    p = p * 2.02 + vec2(11.3, 5.7);
    amplitude *= 0.5;
  }
  return value;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = coord / iResolution.y * smokeScale;
  float t = iTime;
  p.y -= t * riseSpeed;

  vec2 first = vec2(fbm(p + vec2(0.0, 0.2 * t)), fbm(p + vec2(5.2, 1.3) - 0.15 * t));
  vec2 second = vec2(fbm(p + 4.0 * swirl * first + vec2(1.7, 9.2) + 0.1 * t),
                     fbm(p + 4.0 * swirl * first + vec2(8.3, 2.8)));
  float field = fbm(p + 3.0 * swirl * second);
  // Ridges where the warped field crosses its midpoint become thin strands; a slow mask decides
  // where smoke is present at all, so the frame keeps dark space around it.
  float ridge = 1.0 - abs(2.0 * field - 1.0);
  float strands = pow(ridge, mix(1.5, 7.0, wispiness));
  float presence = smoothstep(0.62 - 0.35 * density, 0.80 - 0.35 * density, fbm(0.5 * p + vec2(3.1, 0.05 * t)));
  float smoke = strands * presence;

  vec3 color = mix(smokeColor, accentColor, smoothstep(0.35, 0.75, second.x) * accentShare * 1.6);
  float light = smoke * brightness * (0.8 + 0.8 * length(second - 0.5));

  if (transparentBackground) {
    fragColor = vec4(clamp(color, 0.0, 1.0), clamp(light, 0.0, 1.0));
  } else {
    fragColor = vec4(backgroundColor + color * light, 1.0);
  }
}
