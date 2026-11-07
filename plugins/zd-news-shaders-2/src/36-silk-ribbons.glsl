// Silk Ribbons - single Image pass, Shadertoy compatible.
//
// Flowing satin folds catching a soft sheen. A premium, calm backdrop for award ceremonies,
// gala and royal events, luxury and fashion features, and elegant title cards. Deep red by
// default; try navy, emerald, black or champagne gold.
//
// Technique: the cloth is a height field of long folds running along one diagonal, bent slowly
// by sine waves across them, so the fabric drapes rather than bubbles. Its slope gives a surface
// normal, lit with wrapped diffuse light and two broad specular lobes; broad, soft highlights are
// what make it read as satin rather than plastic.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas, so the same source runs there with these as defaults.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf baseColor color
const vec3 baseColor = vec3(0.450, 0.040, 0.110);
#pragma ograf sheenColor color
const vec3 sheenColor = vec3(1.000, 0.750, 0.800);
#pragma ograf shadowColor color
const vec3 shadowColor = vec3(0.070, 0.000, 0.025);
#pragma ograf foldScale slider min(0.5) max(6) step(0.05)
const float foldScale = 1.0;
#pragma ograf foldDepth slider min(0) max(2) step(0.01)
const float foldDepth = 1.0;
#pragma ograf flowSpeed slider min(0) max(2) step(0.01)
const float flowSpeed = 0.3;
#pragma ograf sheen slider min(0) max(2) step(0.01)
const float sheen = 1.0;
#pragma ograf lightAngle slider min(0) max(360) step(1)
const float lightAngle = 120.0;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float cloth(vec2 p, float t) {
  vec2 along = normalize(vec2(1.0, 0.45));
  float u = dot(p, along);
  float v = dot(p, vec2(-along.y, along.x));
  float bend = 0.6 * sin(v * 0.5 + 0.4 * t) + 0.3 * sin(v * 1.1 - 0.3 * t + 1.7);
  return 0.6 * sin(u * 1.3 + 2.0 * bend) + 0.4 * sin(u * 0.7 - bend + 0.2 * t + 0.8);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = coord / iResolution.y * foldScale * 5.0;
  float t = iTime * flowSpeed;
  float e = 0.01;
  float h = cloth(p, t);
  vec2 slope = vec2(cloth(p + vec2(e, 0.0), t) - h, cloth(p + vec2(0.0, e), t) - h) / e;
  vec3 normal = normalize(vec3(-slope * foldDepth * 0.8, 1.0));

  float angle = radians(lightAngle);
  vec3 lightDir = normalize(vec3(cos(angle), sin(angle), 1.2));
  vec3 halfway = normalize(lightDir + vec3(0.0, 0.0, 1.0));
  float diffuse = clamp(dot(normal, lightDir), 0.0, 1.0);
  float facing = max(dot(normal, halfway), 0.0);
  float highlight = (0.7 * pow(facing, 24.0) + 0.12 * pow(facing, 4.0)) * sheen;

  vec3 color = mix(shadowColor, baseColor, pow(diffuse, 1.5));
  color += sheenColor * highlight;
  fragColor = vec4(color, 1.0);
}
