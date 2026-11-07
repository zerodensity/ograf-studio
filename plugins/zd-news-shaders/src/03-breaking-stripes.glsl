// Breaking Stripes - single Image pass, Shadertoy compatible.
//
// Scrolling diagonal hazard stripes with a slow pulse and a glossy top edge. Use it as the fill
// of a "BREAKING NEWS" strap, an alert badge or a live bug. The defaults are broadcast red; set
// the two colours to amber for weather warnings or to your brand for promos.
//
// Technique: stripes come from the distance to the nearest band edge in pixels, so they stay
// crisp and anti-aliased at any size. Widths are in pixels at Resolution scale 1.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas, so the same source runs there with these as defaults.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf stripeColor color
const vec3 stripeColor = vec3(0.820, 0.020, 0.050);
#pragma ograf gapColor color
const vec3 gapColor = vec3(0.520, 0.000, 0.030);
#pragma ograf stripeWidth slider min(4) max(160) step(1)
const float stripeWidth = 28.0;
#pragma ograf stripeAngle slider min(-75) max(75) step(1)
const float stripeAngle = 35.0;
#pragma ograf scrollSpeed slider min(-400) max(400) step(1)
const float scrollSpeed = 60.0;
#pragma ograf pulseRate slider min(0) max(4) step(0.05)
const float pulseRate = 1.0;
#pragma ograf pulseAmount slider min(0) max(1) step(0.01)
const float pulseAmount = 0.25;
#pragma ograf gloss slider min(0) max(1) step(0.01)
const float gloss = 0.35;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  float angle = radians(stripeAngle);
  float along = dot(coord, vec2(cos(angle), sin(angle))) - iTime * scrollSpeed;
  float period = 2.0 * stripeWidth;
  // Signed pixel distance from the gap band's edge: positive inside a stripe.
  float edge = abs(fract(along / period) - 0.5) * period - 0.5 * stripeWidth;
  vec3 color = mix(gapColor, stripeColor, smoothstep(-0.75, 0.75, edge));

  float pulse = 0.5 + 0.5 * cos(iTime * pulseRate * 6.2831853);
  color *= 1.0 + pulseAmount * (pulse - 0.5);

  color += gloss * 0.35 * smoothstep(0.55, 1.0, uv.y);
  color *= 1.0 - gloss * 0.35 * (1.0 - smoothstep(0.0, 0.45, uv.y));
  fragColor = vec4(color, 1.0);
}
