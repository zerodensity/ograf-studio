// Bokeh Lights - single Image pass, Shadertoy compatible.
//
// Soft out-of-focus studio lights drifting over a dark gradient: the classic backdrop for a
// presenter, a title card or a quote. Turn on transparentBackground to float only the lights
// over video or another background.
//
// Technique: each light is a hashed position, size and flicker phase; it drifts on slow
// sinusoidal paths, so the motion is smooth, endless and exactly reproducible on seek. Discs
// carry a slightly brighter rim like real lens bokeh. Circles stay round at any aspect ratio.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundTop color
const vec3 backgroundTop = vec3(0.020, 0.050, 0.130);
#pragma ograf backgroundBottom color
const vec3 backgroundBottom = vec3(0.000, 0.010, 0.040);
#pragma ograf lightColor color
const vec3 lightColor = vec3(0.250, 0.600, 1.000);
#pragma ograf accentColor color
const vec3 accentColor = vec3(1.000, 0.560, 0.250);
#pragma ograf accentShare slider min(0) max(1) step(0.01)
const float accentShare = 0.25;
#pragma ograf lightCount slider min(1) max(48) step(1)
const int lightCount = 24;
#pragma ograf lightSize slider min(0.02) max(0.4) step(0.005)
const float lightSize = 0.10;
#pragma ograf edgeSoftness slider min(0.05) max(1) step(0.01)
const float edgeSoftness = 0.35;
#pragma ograf brightness slider min(0) max(2) step(0.01)
const float brightness = 0.7;
#pragma ograf drift slider min(0) max(0.5) step(0.005)
const float drift = 0.08;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec2 p = (coord - 0.5 * iResolution.xy) / iResolution.y;

  vec3 light = vec3(0.0);
  float coverage = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= lightCount) break;
    float id = float(i);
    float h1 = hash12(vec2(id, 1.31));
    float h2 = hash12(vec2(id, 7.77));
    float h3 = hash12(vec2(id, 3.19));
    float h4 = hash12(vec2(id, 9.43));
    vec2 center = vec2((h1 - 0.5) * aspect * 1.1, (h2 - 0.5) * 1.1);
    center += drift * vec2(sin(iTime * 0.13 * (0.5 + h3) + id), cos(iTime * 0.11 * (0.5 + h4) + 1.7 * id));
    float radius = lightSize * (0.4 + 0.9 * h3);
    float d = length(p - center);
    float disc = smoothstep(radius, radius * (1.0 - edgeSoftness), d);
    disc *= 0.75 + 0.25 * smoothstep(radius * 0.55, radius, d);
    float flicker = 0.65 + 0.35 * sin(iTime * (0.4 + h4) + 3.1 * id);
    float weight = disc * flicker * mix(1.0, 0.45, h3) * (0.35 + 0.65 * h2) * brightness;
    light += mix(lightColor, accentColor, step(1.0 - accentShare, h4)) * weight;
    coverage += weight;
  }

  if (transparentBackground) {
    float alpha = clamp(coverage, 0.0, 1.0);
    fragColor = vec4(clamp(light / max(coverage, 1e-4), 0.0, 1.0), alpha);
  } else {
    fragColor = vec4(mix(backgroundBottom, backgroundTop, uv.y) + light, 1.0);
  }
}
