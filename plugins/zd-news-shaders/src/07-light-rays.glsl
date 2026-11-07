// Light Rays - single Image pass, Shadertoy compatible.
//
// Slowly turning volumetric rays fanning out from a point, by default just above the top edge
// like a stage light. Behind a logo reveal, an award or a "special report" opener. Move the
// origin anywhere, including off-canvas. Turn on transparentBackground to add only the rays.
//
// Technique: two layers of angular sine bands raised to a power make crisp, uneven rays; an
// exponential falloff and a gentle breathing pulse make them read as light rather than stripes.
// rayCount is an integer so the pattern wraps cleanly all the way around the origin.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.020, 0.040, 0.100);
#pragma ograf rayColor color
const vec3 rayColor = vec3(0.550, 0.800, 1.000);
#pragma ograf origin vector2 min(-1) max(2)
const vec2 origin = vec2(0.5, 1.15);
#pragma ograf rayCount slider min(2) max(40) step(1)
const int rayCount = 12;
#pragma ograf raySharpness slider min(1) max(16) step(0.1)
const float raySharpness = 4.0;
#pragma ograf rotationSpeed slider min(-30) max(30) step(0.1)
const float rotationSpeed = 3.0;
#pragma ograf intensity slider min(0) max(2) step(0.01)
const float intensity = 0.9;
#pragma ograf reach slider min(0.1) max(3) step(0.01)
const float reach = 1.2;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  vec2 p = coord / iResolution.y;
  vec2 d = p - origin * vec2(aspect, 1.0);
  float angle = atan(d.y, d.x);
  float spin = radians(rotationSpeed) * iTime;
  float count = float(rayCount);

  float rays = pow(0.5 + 0.5 * sin(count * (angle - spin)), raySharpness);
  rays += 0.6 * pow(0.5 + 0.5 * sin((2.0 * count + 1.0) * (angle + 0.6 * spin) + 1.3), raySharpness * 1.5);
  float breathing = 0.85 + 0.15 * sin(iTime * 0.7);
  float light = rays * exp(-length(d) / reach) * intensity * breathing;

  if (transparentBackground) {
    fragColor = vec4(rayColor, clamp(light, 0.0, 1.0));
  } else {
    fragColor = vec4(backgroundColor + rayColor * light, 1.0);
  }
}
