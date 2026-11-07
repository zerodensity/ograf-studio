// Signal Glitch - single Image pass, Shadertoy compatible. An EFFECT: it distorts iChannel0.
//
// Digital signal break-up: torn horizontal blocks, RGB split, scanlines, snow and tinted bands.
// For "breaking" hits, glitch transitions in and out of a lower third, cyber and tech stories.
//
// In OGraf Studio add it to a layer's Effects as a Shader effect: the effect stack hands the
// layer itself to the shader as iChannel0, so headlines, logos, images and video all glitch.
// Keyframe amount from 0 to 1 and back for a transition; with amount 0 and autoGlitch off the
// layer passes through untouched. autoGlitch fires short random bursts on its own. The layer's
// alpha is kept, so transparent areas stay transparent. In Shadertoy, put any image or video in
// iChannel0. (As a plain Fill it has no layer to read; use it as an effect.)
//
// Inspired by the many VHS and glitch shaders loved on Shadertoy; written from scratch. Burst
// timing and block offsets come from hashes of a 24 fps tick, so every frame is repeatable.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the layer about its centre before glitching; below 1 it shrinks inside the box.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf amount slider min(0) max(1) step(0.01)
const float amount = 0.0;
#pragma ograf autoGlitch toggle
const bool autoGlitch = true;
#pragma ograf burstRate slider min(0) max(4) step(0.01)
const float burstRate = 0.6;
#pragma ograf burstLength slider min(0.04) max(1) step(0.01)
const float burstLength = 0.25;
#pragma ograf blockSize slider min(2) max(120) step(1)
const float blockSize = 24.0;
#pragma ograf tear slider min(0) max(0.3) step(0.001)
const float tear = 0.06;
#pragma ograf rgbSplit slider min(0) max(0.05) step(0.0005)
const float rgbSplit = 0.012;
#pragma ograf scanlines slider min(0) max(1) step(0.01)
const float scanlines = 0.25;
#pragma ograf snow slider min(0) max(1) step(0.01)
const float snow = 0.3;
#pragma ograf bandColor color
const vec3 bandColor = vec3(0.200, 1.000, 0.800);
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash11(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec4 layerAt(vec2 uv) {
  vec4 color = texture(iChannel0, uv);
  // Outside the layer (zoomed out, or torn past the edge) is transparent.
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return color * inside;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;

  float strength = amount;
  if (autoGlitch && burstRate > 0.0) {
    float slot = floor(iTime * burstRate);
    float secondsIn = fract(iTime * burstRate) / burstRate;
    float bursting = step(secondsIn, burstLength) * step(0.35, hash11(slot + 0.5));
    strength = max(strength, bursting * (0.4 + 0.6 * hash11(slot + 7.0)));
  }
  if (strength <= 0.0) {
    fragColor = layerAt(uv);
    return;
  }

  float tick = floor(iTime * 24.0);
  float row = floor(coord.y / blockSize);
  float torn = step(1.0 - 0.6 * strength, hash12(vec2(row * 1.7, tick + 3.0)));
  float offset = (hash12(vec2(row, tick)) - 0.5) * 2.0 * tear * strength * torn;
  vec2 shifted = uv + vec2(offset, 0.0);
  float split = rgbSplit * strength * (0.5 + hash11(tick));

  vec4 red = layerAt(shifted + vec2(split, 0.0));
  vec4 green = layerAt(shifted);
  vec4 blue = layerAt(shifted - vec2(split, 0.0));
  vec3 color = vec3(red.r, green.g, blue.b);
  float alpha = max(green.a, max(red.a, blue.a));

  color *= 1.0 - scanlines * strength * 0.5 * (0.5 + 0.5 * sin(coord.y * 3.1415927));
  float grain = hash12(coord + tick * 13.1);
  color = mix(color, vec3(grain), snow * strength * 0.35 * torn);
  float band = step(1.0 - 0.15 * strength, hash12(vec2(row, tick + 11.0)));
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(color, bandColor * (0.4 + luma), band * 0.7);

  fragColor = vec4(clamp(color, 0.0, 1.0), alpha);
}
