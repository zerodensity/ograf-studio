// Shine Sweep - single Image pass, Shadertoy compatible.
//
// A metallic base with a bright glint that sweeps across at a fixed interval. Apply it as the
// Fill (or Outline) of a headline, logo, number or badge: the shader follows the object's own
// silhouette, so text gets a gold or chrome finish with a periodic shine. Turn on shineOnly to
// keep just the moving glint and lay it over another object.
//
// Technique: the sweep coordinate is measured across the object's width with a slant set by
// shineAngle. A soft Gaussian plus a tighter core gives the glint; the sweep crosses once every
// repeatSeconds and takes sweepSeconds to cross, then rests until the next pass.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; turn shineOnly off to preview it there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf baseColor color
const vec3 baseColor = vec3(0.780, 0.585, 0.220);
#pragma ograf shineColor color
const vec3 shineColor = vec3(1.000, 0.970, 0.860);
#pragma ograf metalShading slider min(0) max(1) step(0.01)
const float metalShading = 0.45;
#pragma ograf shineWidth slider min(0.02) max(0.6) step(0.01)
const float shineWidth = 0.12;
#pragma ograf shineAngle slider min(-60) max(60) step(1)
const float shineAngle = 25.0;
#pragma ograf shineStrength slider min(0) max(2) step(0.01)
const float shineStrength = 1.0;
#pragma ograf repeatSeconds slider min(0.5) max(15) step(0.1)
const float repeatSeconds = 3.5;
#pragma ograf sweepSeconds slider min(0.2) max(6) step(0.05)
const float sweepSeconds = 0.9;
#pragma ograf shineOnly toggle
const bool shineOnly = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;

  // Brushed-metal banding: light from above, a darker band just under the middle.
  float shade = 1.0 + metalShading * (0.55 * (uv.y - 0.5) + 0.22 * sin(uv.y * 9.0 + 0.6));
  vec3 base = baseColor * shade;

  float slant = tan(radians(shineAngle)) / aspect;
  float across = uv.x - (uv.y - 0.5) * slant;
  float halfWidth = 0.5 * shineWidth;
  float margin = halfWidth * 2.5 + 0.5 * abs(slant);
  float progress = mod(iTime, repeatSeconds) / sweepSeconds;
  float center = mix(-margin, 1.0 + margin, clamp(progress, 0.0, 1.0));
  float offset = (across - center) / halfWidth;
  float glint = exp(-offset * offset * 2.0) + 0.6 * exp(-offset * offset * 18.0);
  glint *= step(progress, 1.0) * shineStrength;

  if (shineOnly) {
    fragColor = vec4(shineColor, clamp(glint, 0.0, 1.0));
  } else {
    fragColor = vec4(base + shineColor * glint, 1.0);
  }
}
