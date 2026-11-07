// Glass Panel - single Image pass, Shadertoy compatible.
//
// A translucent frosted-glass fill with a lit top edge, a fine frost grain and a soft sheen
// that drifts across every few seconds. Made for lower thirds, name straps, score boxes and
// info cards that sit over video: the picture shows through, the text on top stays readable.
//
// Technique: a rounded-rectangle distance field gives the edge highlight and the corner cut,
// so set cornerRadius to match the rectangle's own corners (pixels at Resolution scale 1). The
// output alpha is the glass opacity, so it composites over whatever is behind it.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha, so it shows the glass over black there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf tintColor color
const vec3 tintColor = vec3(0.050, 0.120, 0.250);
#pragma ograf tintOpacity slider min(0) max(1) step(0.01)
const float tintOpacity = 0.6;
#pragma ograf highlightColor color
const vec3 highlightColor = vec3(0.700, 0.900, 1.000);
#pragma ograf sheenAmount slider min(0) max(1) step(0.01)
const float sheenAmount = 0.25;
#pragma ograf sheenSeconds slider min(1) max(20) step(0.1)
const float sheenSeconds = 7.0;
#pragma ograf edgeWidth slider min(0) max(12) step(0.1)
const float edgeWidth = 1.5;
#pragma ograf edgeOpacity slider min(0) max(1) step(0.01)
const float edgeOpacity = 0.6;
#pragma ograf cornerRadius slider min(0) max(200) step(1)
const float cornerRadius = 0.0;
#pragma ograf frost slider min(0) max(1) step(0.01)
const float frost = 0.15;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float roundedBox(vec2 p, vec2 halfSize, float radius) {
  float r = min(radius, min(halfSize.x, halfSize.y));
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;

  float distanceToEdge = roundedBox(coord - 0.5 * iResolution.xy, 0.5 * iResolution.xy, cornerRadius);
  float inside = 1.0 - smoothstep(-0.5, 0.5, distanceToEdge);

  vec3 color = tintColor * (0.85 + 0.3 * uv.y);
  float alpha = tintOpacity * (0.9 + 0.1 * uv.y);

  float across = uv.x - uv.y * 0.35 / aspect;
  float sheenCenter = fract(iTime / sheenSeconds) * 1.8 - 0.4;
  float sheen = exp(-pow((across - sheenCenter) / 0.18, 2.0)) * sheenAmount;
  float topGloss = smoothstep(0.55, 1.0, uv.y) * 0.25 * sheenAmount;
  color += highlightColor * (sheen + topGloss);
  alpha += 0.3 * (sheen + topGloss);

  color += (hash12(floor(fragCoord)) - 0.5) * frost * 0.12;

  float rim = (1.0 - smoothstep(edgeWidth, edgeWidth + 1.0, -distanceToEdge)) * mix(0.5, 1.0, uv.y) * step(0.01, edgeWidth);
  color = mix(color, highlightColor, rim * edgeOpacity);
  alpha = max(alpha, rim * edgeOpacity);

  fragColor = vec4(clamp(color, 0.0, 1.0), clamp(alpha, 0.0, 1.0) * inside);
}
