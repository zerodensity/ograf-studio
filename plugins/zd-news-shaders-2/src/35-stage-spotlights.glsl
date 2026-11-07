// Stage Spotlights - single Image pass, Shadertoy compatible.
//
// Moving-head spotlights sweeping through stage haze. For award shows, talent and game shows,
// concert coverage, "and the winner is" moments and big entrances. Beams rise from the floor
// or hang from the rig (fromTop); colours alternate between the two beam colours.
//
// Technique: each beam is a soft cone in the angle around its source, fading with distance,
// with a hot core and a glowing lamp. Each sweeps on its own phase. One drifting fbm field
// modulates all beams as haze, which is what makes them read as light in air.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.010, 0.010, 0.030);
#pragma ograf beamColorA color
const vec3 beamColorA = vec3(0.600, 0.750, 1.000);
#pragma ograf beamColorB color
const vec3 beamColorB = vec3(1.000, 0.700, 0.900);
#pragma ograf beamCount slider min(1) max(8) step(1)
const int beamCount = 4;
#pragma ograf beamWidth slider min(2) max(40) step(0.5)
const float beamWidth = 12.0;
#pragma ograf sweepAngle slider min(0) max(80) step(0.5)
const float sweepAngle = 30.0;
#pragma ograf sweepSpeed slider min(0) max(3) step(0.01)
const float sweepSpeed = 0.6;
#pragma ograf intensity slider min(0) max(3) step(0.01)
const float intensity = 1.0;
#pragma ograf haze slider min(0) max(1) step(0.01)
const float haze = 0.5;
#pragma ograf fromTop toggle
const bool fromTop = false;
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

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float smoke = 0.6 * valueNoise(p * 3.0 + vec2(0.1 * iTime, 0.05 * iTime)) + 0.4 * valueNoise(p * 7.0 - vec2(0.07 * iTime, 0.0));
  float hazeMix = 1.0 - haze + haze * 1.6 * smoke;

  vec3 light = vec3(0.0);
  float coverage = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= beamCount) break;
    float id = float(i);
    vec2 source = vec2((id + 0.5) / float(beamCount) * aspect, fromTop ? 1.05 : -0.05);
    float swing = radians(sweepAngle) * sin(iTime * sweepSpeed * (0.8 + 0.4 * hash11(id)) + id * 1.7);
    vec2 up = fromTop ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
    vec2 dir = vec2(cos(swing) * up.x - sin(swing) * up.y, sin(swing) * up.x + cos(swing) * up.y);
    vec2 v = p - source;
    float along = dot(v, dir);
    float across = dot(v, vec2(-dir.y, dir.x));
    float halfAngle = radians(beamWidth) * 0.5;
    float off = abs(atan(across, max(along, 1e-4)));
    float cone = along > 0.0 ? smoothstep(halfAngle, halfAngle * 0.55, off) : 0.0;
    float core = along > 0.0 ? smoothstep(halfAngle * 0.35, 0.0, off) * 0.5 : 0.0;
    float beam = (cone + core) * exp(-along * 0.6) * hazeMix;
    float lamp = exp(-length(v) * 22.0) * 1.2;
    float amount = (beam * 0.55 + lamp) * intensity;
    light += (mod(id, 2.0) < 0.5 ? beamColorA : beamColorB) * amount;
    coverage += amount;
  }

  if (transparentBackground) {
    fragColor = vec4(clamp(light / max(coverage, 1e-4), 0.0, 1.0), clamp(coverage, 0.0, 1.0));
  } else {
    fragColor = vec4(backgroundColor + light, 1.0);
  }
}
