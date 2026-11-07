// Water Caustics - single Image pass, Shadertoy compatible.
//
// The dancing light network on the floor of a sunlit pool. For swimming and diving coverage,
// summer and holiday segments, or a cool, watery title. Turn on transparentBackground to project
// only the light over another layer, such as a photo of a pool or a lane graphic.
//
// Inspired by the beloved tileable water caustic shaders on Shadertoy; this is a new formulation
// written from scratch. Two Voronoi layers with orbiting feature points give the cell walls
// (second-nearest minus nearest distance); a gentle sine warp curves them, and where the two
// layers cross the light focuses brighter, as real caustics do.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf shallowColor color
const vec3 shallowColor = vec3(0.000, 0.330, 0.460);
#pragma ograf deepColor color
const vec3 deepColor = vec3(0.000, 0.120, 0.250);
#pragma ograf lightColor color
const vec3 lightColor = vec3(0.750, 1.000, 1.000);
#pragma ograf cellScale slider min(1) max(20) step(0.1)
const float cellScale = 5.0;
#pragma ograf sharpness slider min(1) max(12) step(0.1)
const float sharpness = 5.0;
#pragma ograf flowSpeed slider min(0) max(2) step(0.01)
const float flowSpeed = 0.4;
#pragma ograf ripple slider min(0) max(1) step(0.01)
const float ripple = 0.5;
#pragma ograf intensity slider min(0) max(2) step(0.01)
const float intensity = 0.9;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

vec2 hash22(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

// Distance between the nearest and second-nearest moving feature points: zero on cell walls.
float cellWalls(vec2 p, float t) {
  vec2 id = floor(p);
  vec2 f = fract(p);
  float nearest = 8.0;
  float second = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 h = hash22(id + g);
      vec2 point = 0.5 + 0.4 * sin(t + 6.2831853 * h);
      float d = length(g + point - f);
      if (d < nearest) {
        second = nearest;
        nearest = d;
      } else if (d < second) {
        second = d;
      }
    }
  }
  return second - nearest;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  vec2 p = coord / iResolution.y * cellScale;
  float t = iTime * flowSpeed;

  vec2 warp = ripple * 0.3 * vec2(sin(p.y * 1.7 + 1.3 * t), cos(p.x * 1.9 - 1.1 * t));
  float first = exp(-cellWalls(p + warp, t) * sharpness * 2.0);
  float second = exp(-cellWalls(p * 1.6 + 3.7 - warp, 1.3 * t + 2.0) * sharpness * 2.0);
  float caustic = (0.7 * first + 0.5 * second + first * second) * intensity;

  if (transparentBackground) {
    fragColor = vec4(lightColor, clamp(caustic, 0.0, 1.0));
  } else {
    vec3 water = mix(deepColor, shallowColor, clamp(uv.y * 0.8 + 0.2 * first, 0.0, 1.0));
    fragColor = vec4(water + lightColor * caustic * 0.8, 1.0);
  }
}
