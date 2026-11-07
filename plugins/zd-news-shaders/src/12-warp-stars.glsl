// Warp Stars - single Image pass, Shadertoy compatible.
//
// Flying through a field of stars, from a gentle drift to a full hyperspace streak. For science
// and space segments, sports and gaming intros, or a "coming up" bumper. Move vanishingPoint to
// steer, and animate streak for a jump to warp. Turn on transparentBackground to overlay it.
//
// Inspired by Shadertoy favourites such as "Star Nest" and the many warp-speed starfields; this is
// a new polar formulation written from scratch. Each of eight depth layers places one star per
// angular slice; stars accelerate outwards with perspective and stretch along their ray, so long
// streaks never get cut at cell borders.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf spaceColor color
const vec3 spaceColor = vec3(0.000, 0.006, 0.025);
#pragma ograf starColor color
const vec3 starColor = vec3(0.880, 0.930, 1.000);
#pragma ograf tintColor color
const vec3 tintColor = vec3(0.400, 0.620, 1.000);
#pragma ograf tintShare slider min(0) max(1) step(0.01)
const float tintShare = 0.35;
#pragma ograf density slider min(30) max(400) step(1)
const float density = 140.0;
#pragma ograf speed slider min(-2) max(4) step(0.01)
const float speed = 0.5;
#pragma ograf streak slider min(0) max(1) step(0.01)
const float streak = 0.35;
#pragma ograf brightness slider min(0) max(3) step(0.01)
const float brightness = 1.0;
#pragma ograf vanishingPoint vector2 min(-0.5) max(1.5)
const vec2 vanishingPoint = vec2(0.5, 0.5);
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = (coord - vanishingPoint * iResolution.xy) / iResolution.y;
  float r = length(p);
  float turn = atan(p.y, p.x) / 6.2831853 + 0.5;
  float slices = floor(density);
  float slice = floor(turn * slices);

  vec3 light = vec3(0.0);
  float coverage = 0.0;
  for (int l = 0; l < 8; l++) {
    float layer = float(l);
    vec2 id = vec2(slice, layer);
    float present = step(0.3, hash12(id + 0.17));
    float z = fract(layer / 8.0 + hash12(id) + iTime * speed * 0.1);
    float head = 0.015 + 1.6 * z * z * z;
    float tail = head * (1.0 - 0.75 * streak * smoothstep(0.0, 0.6, z));
    float starTurn = (slice + 0.2 + 0.6 * hash12(id + 5.3)) / slices;
    float across = abs(turn - starTurn) * 6.2831853 * r;
    float along = r > head ? r - head : (r < tail ? tail - r : 0.0);
    float width = 0.0006 + 0.0035 * z;
    float shape = exp(-(across * across + along * along) / (width * width));
    float headBias = mix(0.35, 1.0, clamp((r - tail) / max(head - tail, 1e-4), 0.0, 1.0));
    float b = shape * headBias * present * smoothstep(0.0, 0.15, z) * brightness;
    light += mix(starColor, tintColor, step(1.0 - tintShare, hash12(id + 9.1))) * b;
    coverage += b;
  }

  if (transparentBackground) {
    fragColor = vec4(clamp(light / max(coverage, 1e-4), 0.0, 1.0), clamp(coverage, 0.0, 1.0));
  } else {
    fragColor = vec4(spaceColor + light, 1.0);
  }
}
