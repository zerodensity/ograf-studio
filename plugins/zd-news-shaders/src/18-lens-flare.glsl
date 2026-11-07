// Lens Flare - single Image pass, Shadertoy compatible.
//
// A cinematic flare: hot core, anamorphic horizontal streak, starburst rays, a chromatic halo
// and a trail of ghosts mirrored through the frame centre. Layer it over a logo sting, a title
// reveal or a transition. Keyframe lightPosition to move it, or turn on autoSweep to let it
// cross the frame on its own. Transparent by default so it sits over anything.
//
// Inspired by the many lens-flare shaders that are perennial Shadertoy favourites; written from
// scratch. Every element is an analytic falloff around the light or around a ghost position on
// the line from the light through the centre, so it is cheap at any resolution.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; turn transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf lightColor color
const vec3 lightColor = vec3(1.000, 0.850, 0.650);
#pragma ograf streakColor color
const vec3 streakColor = vec3(0.350, 0.600, 1.000);
#pragma ograf lightPosition vector2 min(-0.5) max(1.5)
const vec2 lightPosition = vec2(0.3, 0.7);
#pragma ograf intensity slider min(0) max(3) step(0.01)
const float intensity = 1.0;
#pragma ograf streakLength slider min(0) max(2) step(0.01)
const float streakLength = 1.0;
#pragma ograf rays slider min(0) max(1) step(0.01)
const float rays = 0.5;
#pragma ograf ghosts slider min(0) max(1) step(0.01)
const float ghosts = 0.6;
#pragma ograf flicker slider min(0) max(1) step(0.01)
const float flicker = 0.15;
#pragma ograf autoSweep toggle
const bool autoSweep = false;
#pragma ograf sweepSeconds slider min(1) max(30) step(0.1)
const float sweepSeconds = 6.0;
#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.000, 0.000, 0.000);
#pragma ograf transparentBackground toggle
const bool transparentBackground = true;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

vec3 ghost(vec2 p, vec2 at, float radius, vec3 tint) {
  float d = length(p - at);
  float disc = smoothstep(radius, radius * 0.6, d);
  float ring = exp(-pow((d - radius) / (radius * 0.12), 2.0));
  return tint * (0.05 * disc + 0.06 * ring);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec2 p = (coord - 0.5 * iResolution.xy) / iResolution.y;
  vec2 light = (lightPosition - 0.5) * vec2(aspect, 1.0);
  if (autoSweep) light.x = mix(-0.7, 0.7, fract(iTime / sweepSeconds)) * aspect;

  vec2 d = p - light;
  float r = length(d);
  float angle = atan(d.y, d.x);

  float core = exp(-r * 12.0) + 0.5 * exp(-r * 40.0);
  float burst = pow(0.5 + 0.5 * sin(angle * 12.0 + 0.6 * sin(angle * 5.0)), 8.0)
              + 0.6 * pow(0.5 + 0.5 * sin(angle * 7.0 + 1.3), 12.0);
  float rayLight = burst * exp(-r * 5.0) * rays;
  float streak = exp(-abs(d.y) * 220.0) * exp(-abs(d.x) / (0.6 * streakLength + 1e-3))
               + 0.3 * exp(-abs(d.y) * 60.0) * exp(-abs(d.x) / (0.3 * streakLength + 1e-3));

  vec3 color = lightColor * (core + rayLight) + streakColor * streak;
  color += ghosts * vec3(exp(-pow((r - 0.35) * 25.0, 2.0)), exp(-pow((r - 0.34) * 25.0, 2.0)), exp(-pow((r - 0.33) * 25.0, 2.0))) * 0.15;
  color += ghosts * ghost(p, light * -0.4, 0.05, vec3(0.3, 1.0, 0.6));
  color += ghosts * ghost(p, light * -0.8, 0.10, vec3(0.4, 0.6, 1.0));
  color += ghosts * ghost(p, light * -1.3, 0.16, vec3(1.0, 0.5, 0.3));
  color += ghosts * ghost(p, light * 0.5, 0.03, vec3(0.8, 0.4, 1.0));
  color *= intensity * (1.0 + flicker * (noise1(iTime * 8.0) - 0.5));

  if (transparentBackground) {
    float alpha = clamp(max(max(color.r, color.g), color.b), 0.0, 1.0);
    fragColor = vec4(clamp(color / max(alpha, 1e-4), 0.0, 1.0), alpha);
  } else {
    fragColor = vec4(backgroundColor + color, 1.0);
  }
}
