// Kaleidoscope - single Image pass, Shadertoy compatible.
//
// A slowly turning mandala of mirrored, flowing colour. For music and entertainment shows,
// festival and arts coverage, quiz breaks, kids' programming and countdown backdrops. Set the
// three colours to your brand palette and segments to 6, 8 or 12 for classic symmetry.
//
// Inspired by the kaleidoscope shaders that are perennial Shadertoy favourites; written from
// scratch. The angle is folded into one mirrored wedge, so the pattern stays seamless; inside
// the wedge, a few rounds of fold-and-rotate geometry make crisp, jewel-like facets and fine
// linework that breathe over time.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas, so the same source runs there with these as defaults.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf colorA color
const vec3 colorA = vec3(0.050, 0.100, 0.350);
#pragma ograf colorB color
const vec3 colorB = vec3(0.900, 0.200, 0.600);
#pragma ograf colorC color
const vec3 colorC = vec3(1.000, 0.800, 0.300);
#pragma ograf segments slider min(3) max(24) step(1)
const int segments = 8;
#pragma ograf rotationSpeed slider min(-60) max(60) step(0.5)
const float rotationSpeed = 8.0;
#pragma ograf patternScale slider min(0.5) max(6) step(0.05)
const float patternScale = 2.2;
#pragma ograf flowSpeed slider min(0) max(2) step(0.01)
const float flowSpeed = 0.4;
#pragma ograf contrast slider min(0.5) max(3) step(0.01)
const float contrast = 1.6;
#pragma ograf centerGlow slider min(0) max(1) step(0.01)
const float centerGlow = 0.5;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = (coord - 0.5 * iResolution.xy) / iResolution.y;
  float r = length(p);
  float wedge = 6.2831853 / float(segments);
  float angle = atan(p.y, p.x) + radians(rotationSpeed) * iTime;
  angle = mod(angle, wedge);
  angle = abs(angle - 0.5 * wedge);
  vec2 z = r * vec2(cos(angle), sin(angle)) * patternScale;

  float t = iTime * flowSpeed;
  float lines = 0.0;
  float trap = 10.0;
  for (int i = 0; i < 5; i++) {
    float step_ = float(i);
    z = abs(z) - vec2(0.6, 0.4) - 0.15 * sin(0.7 * t + 1.3 * step_);
    float turn = 0.55 + 0.15 * sin(0.3 * t);
    z = mat2(cos(turn), sin(turn), -sin(turn), cos(turn)) * z;
    lines += exp(-abs(z.y) * 14.0) * (0.6 + 0.1 * step_);
    trap = min(trap, length(z));
  }
  float v = pow(1.0 - smoothstep(0.02, 0.5, trap), contrast);

  vec3 color = v < 0.5 ? mix(colorA, colorB, v * 2.0) : mix(colorB, colorC, (v - 0.5) * 2.0);
  color += colorC * clamp(lines, 0.0, 1.5) * 0.25;
  color += colorC * exp(-r * 6.0) * centerGlow;
  color *= smoothstep(1.4, 0.3, r) * 0.35 + 0.65;
  fragColor = vec4(color, 1.0);
}
