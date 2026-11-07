// World Globe - single Image pass, Shadertoy compatible.
//
// A spinning news globe: dot-matrix continents, latitude and longitude lines, twinkling city
// lights and a glowing atmosphere. For world news, international desks, elections abroad and
// "around the world" segments. Position and size it with globeCenter and globeRadius.
//
// Technique: each pixel inside the disc becomes a point on a lit sphere, tilted and spun into
// latitude and longitude. A dot grid in latitude/longitude space lights only cells whose
// centre lands on procedural continents (3D value-noise fbm), so dots stay whole and the
// coastlines read as pixel art. Grid lines take their width from screen-space derivatives.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; keep transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.005, 0.015, 0.040);
#pragma ograf oceanColor color
const vec3 oceanColor = vec3(0.020, 0.080, 0.200);
#pragma ograf landColor color
const vec3 landColor = vec3(0.350, 0.750, 1.000);
#pragma ograf gridColor color
const vec3 gridColor = vec3(0.200, 0.500, 0.900);
#pragma ograf glowColor color
const vec3 glowColor = vec3(0.200, 0.600, 1.000);
#pragma ograf globeCenter vector2 min(-0.5) max(1.5)
const vec2 globeCenter = vec2(0.5, 0.5);
#pragma ograf globeRadius slider min(0.05) max(0.6) step(0.005)
const float globeRadius = 0.38;
#pragma ograf spinSpeed slider min(-60) max(60) step(0.5)
const float spinSpeed = 10.0;
#pragma ograf tilt slider min(-60) max(60) step(0.5)
const float tilt = 18.0;
#pragma ograf dotDensity slider min(40) max(240) step(1)
const float dotDensity = 120.0;
#pragma ograf landAmount slider min(0) max(1) step(0.01)
const float landAmount = 0.45;
#pragma ograf gridOpacity slider min(0) max(1) step(0.01)
const float gridOpacity = 0.35;
#pragma ograf transparentBackground toggle
const bool transparentBackground = false;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash13(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}

float continents(vec3 n) {
  float value = 0.0;
  float amplitude = 0.5;
  vec3 p = n * 2.2;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise3(p);
    p = p * 2.03 + vec3(7.1, 3.3, 5.9);
    amplitude *= 0.5;
  }
  return value;
}

vec3 sphereAt(float lat, float lon) {
  return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
}

// Brightness of the nearest grid line every `spacing` in x, sized to its pixel footprint.
float gridLine(float x, float spacing, float footprint) {
  float d = abs(fract(x / spacing + 0.5) - 0.5) * spacing;
  return 1.0 - smoothstep(0.0, footprint * 1.5, d);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = (coord - globeCenter * iResolution.xy) / iResolution.y / globeRadius;
  float r = length(p);
  float pixel = 1.5 / (globeRadius * iResolution.y);
  float inside = 1.0 - smoothstep(1.0 - pixel, 1.0, r);

  vec3 color = vec3(0.0);
  if (r < 1.0) {
    vec3 view = vec3(p, sqrt(max(1.0 - r * r, 0.0)));
    float c = cos(radians(tilt));
    float s = sin(radians(tilt));
    vec3 n = vec3(view.x, c * view.y - s * view.z, s * view.y + c * view.z);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.x, n.z) + radians(spinSpeed) * iTime;

    float threshold = mix(0.65, 0.38, landAmount);
    vec2 grid = vec2(lon / 6.2831853 * dotDensity, (lat / 3.1415927 + 0.5) * dotDensity * 0.5);
    vec2 cell = floor(grid);
    vec2 centre = (cell + 0.5) / vec2(dotDensity, dotDensity * 0.5);
    float cellLat = (centre.y - 0.5) * 3.1415927;
    float land = step(threshold, continents(sphereAt(cellLat, centre.x * 6.2831853)));
    vec2 local = (fract(grid) - 0.5) * vec2(cos(cellLat), 1.0);
    float dotMask = 1.0 - smoothstep(0.22, 0.34, length(local));
    float city = step(0.97, hash13(vec3(cell, 1.0))) * (0.6 + 0.4 * sin(iTime * 3.0 + 40.0 * hash13(vec3(cell, 2.0))));

    float lonDeg = degrees(lon);
    float lonFootprint = min(fwidth(lonDeg), fwidth(mod(lonDeg + 180.0, 360.0)));
    float lines = max(gridLine(degrees(lat), 15.0, fwidth(degrees(lat))), gridLine(lonDeg, 15.0, lonFootprint));

    float diffuse = 0.4 + 0.6 * clamp(dot(view, normalize(vec3(-0.4, 0.5, 0.8))), 0.0, 1.0);
    float rim = pow(1.0 - view.z, 3.0);
    color = oceanColor * diffuse;
    color += landColor * dotMask * land * (0.55 + 0.45 * diffuse) * (1.0 + 1.5 * city);
    color += gridColor * lines * gridOpacity;
    color += glowColor * rim * 0.8;
  }
  float halo = r > 1.0 ? exp(-(r - 1.0) * 10.0) * 0.8 : 0.0;

  if (transparentBackground) {
    vec3 shown = mix(glowColor, color, inside);
    fragColor = vec4(clamp(shown, 0.0, 1.0), clamp(inside + halo, 0.0, 1.0));
  } else {
    fragColor = vec4(mix(backgroundColor + glowColor * halo, color, inside), 1.0);
  }
}
