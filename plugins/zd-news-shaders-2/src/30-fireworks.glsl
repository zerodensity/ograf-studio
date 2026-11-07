// Fireworks - single Image pass, Shadertoy compatible.
//
// Rockets climb, burst into rings of sparks that fall under gravity, streak, twinkle and fade.
// For New Year, national days, results nights, sports wins and celebration stings. Pick the
// three burst colours to match the occasion; turn on transparentBackground for a skyline photo.
//
// Technique: each rocket repeats on its own offset clock, and its launch point, height and
// colour come from hashing the cycle number, so the show never repeats exactly yet every frame
// is reproducible. Sparks are short segments from their position a moment earlier, which
// draws motion streaks without any feedback buffer.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf skyTop color
const vec3 skyTop = vec3(0.000, 0.000, 0.030);
#pragma ograf skyBottom color
const vec3 skyBottom = vec3(0.030, 0.020, 0.080);
#pragma ograf colorA color
const vec3 colorA = vec3(1.000, 0.350, 0.300);
#pragma ograf colorB color
const vec3 colorB = vec3(1.000, 0.850, 0.300);
#pragma ograf colorC color
const vec3 colorC = vec3(0.400, 0.700, 1.000);
#pragma ograf rocketCount slider min(1) max(5) step(1)
const int rocketCount = 4;
#pragma ograf sparkCount slider min(8) max(64) step(1)
const int sparkCount = 40;
#pragma ograf periodSeconds slider min(1) max(8) step(0.1)
const float periodSeconds = 3.0;
#pragma ograf burstSize slider min(0.05) max(0.6) step(0.005)
const float burstSize = 0.25;
#pragma ograf gravity slider min(0) max(1) step(0.01)
const float gravity = 0.25;
#pragma ograf brightness slider min(0) max(3) step(0.01)
const float brightness = 1.6;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

vec2 sparkAt(vec2 centre, float angle, float speed, float t) {
  return centre + vec2(cos(angle), sin(angle)) * speed * (1.0 - exp(-t * 3.0)) - vec2(0.0, 0.5 * gravity * t * t);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float pixel = 1.0 / iResolution.y;

  vec3 light = vec3(0.0);
  float coverage = 0.0;
  for (int k = 0; k < 5; k++) {
    if (k >= rocketCount) break;
    float clock = iTime / periodSeconds + float(k) / float(rocketCount) + 0.37 * float(k);
    float cycle = floor(clock);
    float age = fract(clock) * periodSeconds;
    float seed = cycle * 17.0 + float(k) * 3.0;
    vec2 centre = vec2((0.15 + 0.7 * hash11(seed)) * aspect, 0.5 + 0.35 * hash11(seed + 1.0));
    float pick = hash11(seed + 2.0) * 3.0;
    vec3 tint = pick < 1.0 ? colorA : pick < 2.0 ? colorB : colorC;
    float rise = 0.7;

    if (age < rise) {
      float climb = 1.0 - pow(1.0 - age / rise, 2.0);
      vec2 head = vec2(centre.x, centre.y * climb);
      float d = segmentDistance(p, head, head - vec2(0.0, 0.05));
      float trail = exp(-d / (2.0 * pixel)) * 0.8;
      light += vec3(1.0, 0.8, 0.6) * trail;
      coverage += trail;
      continue;
    }

    float t = age - rise;
    float fade = pow(clamp(1.0 - t / (periodSeconds * 0.85), 0.0, 1.0), 1.5);
    float flash = exp(-t * 7.0) * exp(-length(p - centre) / (burstSize * 0.6)) * 0.8;
    light += mix(tint, vec3(1.0), 0.5) * flash;
    coverage += flash;
    for (int s = 0; s < 64; s++) {
      if (s >= sparkCount) break;
      float id = float(s);
      float angle = (id + hash11(seed + id * 1.37)) / float(sparkCount) * 6.2831853;
      float speed = burstSize * (0.6 + 0.4 * hash11(seed + id * 2.11));
      vec2 now = sparkAt(centre, angle, speed, t);
      vec2 before = sparkAt(centre, angle, speed, max(t - 0.14, 0.0));
      float d = segmentDistance(p, now, before);
      float twinkle = t > 1.0 ? 0.5 + 0.5 * hash11(seed + id + floor(iTime * 20.0)) : 1.0;
      float spark = (exp(-d / (1.8 * pixel)) + 0.3 * exp(-d / (7.0 * pixel))) * fade * twinkle;
      light += mix(tint, vec3(1.0), 0.25 * exp(-t * 3.0)) * spark;
      coverage += spark;
    }
  }
  light *= brightness;
  coverage *= brightness;

  if (transparentBackground) {
    fragColor = vec4(clamp(light / max(coverage, 1e-4), 0.0, 1.0), clamp(coverage, 0.0, 1.0));
  } else {
    fragColor = vec4(mix(skyBottom, skyTop, clamp(uv.y, 0.0, 1.0)) + light, 1.0);
  }
}
