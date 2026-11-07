// Lightning Storm - single Image pass, Shadertoy compatible.
//
// Brooding storm clouds that light up from inside as jagged bolts strike, with a re-strike
// flicker and a branching fork. For severe-weather warnings, storm tracking, "breaking weather"
// and dramatic promos. Set strikeRate to 0 for a calm overcast sky between strikes.
//
// Technique: strikes are scheduled per time slot from hashes, so any frame can be rendered
// directly. A bolt is a vertical path displaced by four octaves of 1D value noise; distance to
// it gives a hot core and a wide glow. Clouds are drifting fbm, lit by the flash around the
// strike position.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas, so the same source runs there with these as defaults.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf skyColor color
const vec3 skyColor = vec3(0.030, 0.040, 0.070);
#pragma ograf cloudColor color
const vec3 cloudColor = vec3(0.180, 0.200, 0.260);
#pragma ograf boltColor color
const vec3 boltColor = vec3(0.750, 0.850, 1.000);
#pragma ograf flashColor color
const vec3 flashColor = vec3(0.550, 0.600, 0.850);
#pragma ograf strikeRate slider min(0) max(3) step(0.01)
const float strikeRate = 0.5;
#pragma ograf boltWidth slider min(0.5) max(8) step(0.1)
const float boltWidth = 2.0;
#pragma ograf flashStrength slider min(0) max(2) step(0.01)
const float flashStrength = 1.0;
#pragma ograf branchAmount slider min(0) max(1) step(0.01)
const float branchAmount = 0.6;
#pragma ograf cloudSpeed slider min(0) max(1) step(0.01)
const float cloudSpeed = 0.05;
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

// Horizontal offset of a jagged bolt at height y; seed picks the bolt.
float jag(float y, float seed) {
  return (noise1(y * 6.0 + seed) - 0.5) * 0.12 + (noise1(y * 14.0 + seed * 1.7) - 0.5) * 0.05
       + (noise1(y * 35.0 + seed * 2.3) - 0.5) * 0.02 + (noise1(y * 80.0 + seed * 3.1) - 0.5) * 0.008;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  float slot = strikeRate > 0.0 ? floor(iTime * strikeRate) : -1.0;
  float age = strikeRate > 0.0 ? fract(iTime * strikeRate) / strikeRate : 1e3;
  float happens = strikeRate > 0.0 ? step(0.3, hash11(slot + 0.7)) : 0.0;
  float flash = happens * exp(-age * 6.0) * (1.0 + 0.8 * step(0.08, age) * step(age, 0.14));
  float boltVisible = happens * exp(-age * 10.0) * (age < 0.3 ? 1.0 : 0.0);

  float x0 = 0.2 + 0.6 * hash11(slot + 1.3);
  float yEnd = 0.05 + 0.3 * hash11(slot + 2.9);
  float seed = slot * 7.31;
  float bolt = 0.0;
  if (uv.y > yEnd) {
    float d = abs(uv.x - (x0 + jag(uv.y, seed))) * iResolution.x;
    bolt = exp(-d / boltWidth) + 0.3 * exp(-d / (boltWidth * 8.0));
  }
  float branchTop = mix(yEnd, 1.0, 0.4 + 0.3 * hash11(slot + 4.1));
  float branchBottom = branchTop - 0.3 * branchAmount;
  if (uv.y < branchTop && uv.y > branchBottom) {
    float side = hash11(slot + 5.9) > 0.5 ? 1.0 : -1.0;
    float bx = x0 + jag(branchTop, seed) + (branchTop - uv.y) * side * 0.5 + 0.6 * jag(uv.y, seed + 9.0);
    float d = abs(uv.x - bx) * iResolution.x;
    float fade = (uv.y - branchBottom) / max(branchTop - branchBottom, 1e-4);
    bolt += (exp(-d / (boltWidth * 0.7)) + 0.2 * exp(-d / (boltWidth * 6.0))) * fade;
  }

  float clouds = fbm(p * 2.0 + vec2(iTime * cloudSpeed, 0.0));
  float density = smoothstep(0.35, 0.75, clouds) * smoothstep(0.1, 0.6, uv.y);
  float nearStrike = flash * exp(-abs(uv.x - x0) * 3.0);

  vec3 color = mix(skyColor, cloudColor, density);
  color += flashColor * flash * 0.35 * (density + 0.3) * flashStrength;
  color += flashColor * nearStrike * density * flashStrength;
  color += boltColor * bolt * boltVisible;
  fragColor = vec4(color, 1.0);
}
