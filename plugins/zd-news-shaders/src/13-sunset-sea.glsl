// Sunset Sea - single Image pass, Shadertoy compatible.
//
// An open sea under a low sun: glittering sun path, rolling swell and a hazy horizon. For travel,
// weather and holiday segments, closing titles and calm "good evening" openers. Move the sun with
// sunPosition and recolour the sky for dawn, noon or dusk.
//
// Inspired by the look of TDM's classic "Seascape" on Shadertoy; this is a new, far lighter
// approach written from scratch. Instead of raymarching, each pixel below the horizon intersects a
// flat sea plane once; five analytic waves give the surface normal for a Fresnel reflection of
// the sky and a sun glint. Waves fade with distance so the horizon stays clean.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas, so the same source runs there with these as defaults.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf zenithColor color
const vec3 zenithColor = vec3(0.100, 0.170, 0.400);
#pragma ograf horizonColor color
const vec3 horizonColor = vec3(1.000, 0.550, 0.300);
#pragma ograf waterColor color
const vec3 waterColor = vec3(0.020, 0.065, 0.110);
#pragma ograf sunColor color
const vec3 sunColor = vec3(1.000, 0.850, 0.600);
#pragma ograf sunPosition vector2 min(0) max(1)
const vec2 sunPosition = vec2(0.5, 0.5);
#pragma ograf sunSize slider min(0.005) max(0.2) step(0.001)
const float sunSize = 0.035;
#pragma ograf horizon slider min(0.1) max(0.9) step(0.01)
const float horizon = 0.42;
#pragma ograf waveHeight slider min(0) max(2) step(0.01)
const float waveHeight = 1.0;
#pragma ograf waveSpeed slider min(0) max(3) step(0.01)
const float waveSpeed = 1.0;
#pragma ograf glitter slider min(0) max(3) step(0.01)
const float glitter = 1.2;
#pragma ograf haze slider min(0) max(1) step(0.01)
const float haze = 0.5;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

vec3 skyColor(vec3 dir, vec3 sunDir) {
  float height = clamp(dir.y * 3.0, 0.0, 1.0);
  vec3 color = mix(horizonColor, zenithColor, pow(height, 0.6));
  float facing = max(dot(dir, sunDir), 0.0);
  return color + sunColor * (0.25 * pow(facing, 8.0) + 0.6 * pow(facing, 64.0));
}

// Gradient of the sea height at world position p; high waves fade with distance.
vec2 seaSlope(vec2 p, float t, float hitDistance) {
  vec2 slope = vec2(0.0);
  vec2 dirs[5] = vec2[5](vec2(1.0, 0.3), vec2(-0.4, 1.0), vec2(0.7, -0.8), vec2(0.2, 1.0), vec2(-1.0, 0.2));
  float freqs[5] = float[5](0.6, 1.1, 2.3, 4.1, 7.3);
  float amps[5] = float[5](0.08, 0.05, 0.025, 0.012, 0.006);
  for (int i = 0; i < 5; i++) {
    vec2 d = normalize(dirs[i]);
    float f = freqs[i];
    float phase = dot(d, p) * f + t * sqrt(f) * 1.6;
    slope += d * amps[i] * f * cos(phase) / (1.0 + hitDistance * f * 0.05);
  }
  return slope * waveHeight;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec3 dir = normalize(vec3((uv.x - 0.5) * aspect, uv.y - horizon, 1.2));
  vec3 sunDir = normalize(vec3((sunPosition.x - 0.5) * aspect, sunPosition.y - horizon, 1.2));

  if (dir.y >= 0.0) {
    float angle = acos(clamp(dot(dir, sunDir), -1.0, 1.0));
    vec3 color = skyColor(dir, sunDir) + sunColor * 2.0 * smoothstep(sunSize, sunSize * 0.8, angle);
    fragColor = vec4(color, 1.0);
    return;
  }

  float hitDistance = 1.0 / -dir.y;
  vec2 world = dir.xz * hitDistance;
  vec2 slope = seaSlope(world, iTime * waveSpeed, hitDistance);
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 reflected = reflect(dir, normal);
  reflected.y = abs(reflected.y);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-dir, normal), 0.0), 5.0);
  vec3 color = mix(waterColor, skyColor(reflected, sunDir), fresnel);
  color += sunColor * glitter * (2.5 * pow(max(dot(reflected, sunDir), 0.0), 400.0) + 0.15 * pow(max(dot(reflected, sunDir), 0.0), 30.0));

  float fog = 1.0 - exp(-hitDistance * 0.015 * (0.3 + haze));
  color = mix(color, skyColor(normalize(vec3(dir.x, 0.002, dir.z)), sunDir), fog);
  fragColor = vec4(color, 1.0);
}
