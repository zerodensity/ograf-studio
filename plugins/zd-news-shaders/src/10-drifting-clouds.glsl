// Drifting Clouds - single Image pass, Shadertoy compatible.
//
// Soft, self-shaded clouds drifting across a sky gradient. Made for weather graphics: behind a
// forecast, over a map (turn on transparentBackground to keep only the clouds), or darkened
// with grey colours and higher coverage for a storm warning.
//
// Technique: two fbm layers moving at different rates make the clouds slowly reshape as they
// drift. A second sample offset towards the light gives cheap self-shadowing, so the clouds
// read as volumes rather than flat noise. coverage moves the cloud threshold.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf skyTop color
const vec3 skyTop = vec3(0.180, 0.420, 0.780);
#pragma ograf skyBottom color
const vec3 skyBottom = vec3(0.550, 0.750, 0.950);
#pragma ograf cloudColor color
const vec3 cloudColor = vec3(1.000, 1.000, 1.000);
#pragma ograf shadowColor color
const vec3 shadowColor = vec3(0.550, 0.620, 0.750);
#pragma ograf coverage slider min(0) max(1) step(0.01)
const float coverage = 0.5;
#pragma ograf softness slider min(0.02) max(0.5) step(0.01)
const float softness = 0.18;
#pragma ograf cloudScale slider min(0.5) max(8) step(0.05)
const float cloudScale = 2.5;
#pragma ograf wind vector2 min(-0.5) max(0.5)
const vec2 wind = vec2(0.05, 0.008);
#pragma ograf cloudOpacity slider min(0) max(1) step(0.01)
const float cloudOpacity = 1.0;
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

float cloudField(vec2 p) {
  vec2 drift = wind * iTime * cloudScale;
  return 0.65 * fbm(p - drift) + 0.35 * fbm(p * 1.9 - 0.5 * drift + 3.1);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  vec2 p = coord / iResolution.y * cloudScale;

  float field = cloudField(p);
  float threshold = 1.0 - coverage;
  float density = smoothstep(threshold - softness, threshold + softness, field);
  float towardsLight = cloudField(p + vec2(-0.06, 0.09));
  float lit = clamp(0.65 + (field - towardsLight) * 3.5, 0.0, 1.0);
  vec3 cloud = mix(shadowColor, cloudColor, lit);
  float alpha = density * cloudOpacity;

  if (transparentBackground) {
    fragColor = vec4(cloud, alpha);
  } else {
    vec3 sky = mix(skyBottom, skyTop, clamp(uv.y, 0.0, 1.0));
    fragColor = vec4(mix(sky, cloud, alpha), 1.0);
  }
}
