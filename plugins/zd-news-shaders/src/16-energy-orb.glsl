// Energy Orb - single Image pass, Shadertoy compatible.
//
// A glowing sphere of swirling energy veins with a bright rim and soft corona. Put a logo, a
// number or a "SPECIAL REPORT" title in front of it, or use it as a pulsing hub in a sci-tech
// graphic. Move it with orbCenter and resize it with orbRadius; animate both for stings.
//
// Inspired by Shadertoy favourites such as nimitz's "Ether" and the many plasma-globe shaders;
// this is a new 2D construction written from scratch. The disc is lensed like a sphere, ridged
// value-noise fbm swirls across it to make thin filaments, and a Fresnel-style rim and an
// exponential corona finish the glow.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.000, 0.010, 0.030);
#pragma ograf coreColor color
const vec3 coreColor = vec3(0.150, 0.350, 1.000);
#pragma ograf rimColor color
const vec3 rimColor = vec3(0.550, 0.900, 1.000);
#pragma ograf veinColor color
const vec3 veinColor = vec3(0.850, 0.950, 1.000);
#pragma ograf orbCenter vector2 min(-0.5) max(1.5)
const vec2 orbCenter = vec2(0.5, 0.5);
#pragma ograf orbRadius slider min(0.05) max(0.6) step(0.005)
const float orbRadius = 0.3;
#pragma ograf swirlSpeed slider min(-2) max(2) step(0.01)
const float swirlSpeed = 0.35;
#pragma ograf veins slider min(0) max(2) step(0.01)
const float veins = 1.0;
#pragma ograf glow slider min(0) max(2) step(0.01)
const float glow = 1.0;
#pragma ograf pulse slider min(0) max(1) step(0.01)
const float pulse = 0.3;
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
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * valueNoise(p);
    p = p * 2.07 + vec2(13.1, 7.3);
    amplitude *= 0.5;
  }
  return value;
}

vec2 rotate(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = (coord - orbCenter * iResolution.xy) / iResolution.y / orbRadius;
  float r = length(p);
  float t = iTime * swirlSpeed;
  float beat = 1.0 + pulse * 0.25 * sin(iTime * 2.2);

  float z = sqrt(max(1.0 - r * r, 0.0));
  vec2 lensed = p / (0.6 + z);
  float n1 = fbm(rotate(lensed, t) * 3.0 + vec2(t, -0.7 * t));
  float n2 = fbm(rotate(lensed, -0.7 * t) * 4.5 + vec2(-t, 0.4 * t) + 5.0);
  float vein1 = pow(1.0 - abs(2.0 * n1 - 1.0), 8.0);
  float vein2 = pow(1.0 - abs(2.0 * n2 - 1.0), 10.0);

  vec3 body = mix(coreColor * 0.35, coreColor, z);
  body += rimColor * pow(1.0 - z, 3.0) * 1.2;
  body += veinColor * (vein1 + 0.7 * vein2) * veins * (0.4 + 0.6 * z);
  body *= beat;

  float pixel = 1.5 / (orbRadius * iResolution.y);
  float inside = 1.0 - smoothstep(1.0 - pixel, 1.0, r);
  float halo = r > 1.0 ? exp(-(r - 1.0) * 5.0 / max(glow, 0.01)) * 0.7 : 0.7;
  float flicker = 0.85 + 0.15 * valueNoise(vec2(atan(p.y, p.x) * 3.0, iTime * 2.0));
  float corona = halo * glow * flicker * beat * (1.0 - inside);

  if (transparentBackground) {
    vec3 color = mix(rimColor, body, inside);
    fragColor = vec4(clamp(color, 0.0, 1.0), clamp(inside + corona, 0.0, 1.0));
  } else {
    vec3 color = backgroundColor + rimColor * corona;
    fragColor = vec4(mix(color, body, inside), 1.0);
  }
}
