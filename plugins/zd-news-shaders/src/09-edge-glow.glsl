// Edge Glow - single Image pass, Shadertoy compatible.
//
// Light comets racing around a rounded border with a soft halo, over a faint resting outline.
// Put it on a rectangle the same size as (or slightly larger than) a lower third, video window,
// score box or "LIVE" bug to draw the eye to it. The inside stays transparent by default.
//
// Technique: a rounded-rectangle distance field draws the border and halo; a perimeter
// arc-length coordinate places the comets, so they keep a constant speed round the corners.
// The border is inset by glowSize + borderWidth so the halo never touches the object's edge.
// Sizes are in pixels at Resolution scale 1; match cornerRadius to the panel it surrounds.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; turn transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf glowColor color
const vec3 glowColor = vec3(0.200, 0.780, 1.000);
#pragma ograf tailColor color
const vec3 tailColor = vec3(0.450, 0.200, 1.000);
#pragma ograf borderWidth slider min(0.5) max(16) step(0.1)
const float borderWidth = 2.0;
#pragma ograf glowSize slider min(0) max(80) step(0.5)
const float glowSize = 16.0;
#pragma ograf cornerRadius slider min(0) max(300) step(1)
const float cornerRadius = 16.0;
#pragma ograf lapSeconds slider min(0.5) max(30) step(0.1)
const float lapSeconds = 4.0;
#pragma ograf tailLength slider min(0.02) max(1) step(0.01)
const float tailLength = 0.3;
#pragma ograf cometCount slider min(1) max(6) step(1)
const int cometCount = 2;
#pragma ograf counterClockwise toggle
const bool counterClockwise = false;
#pragma ograf restOpacity slider min(0) max(1) step(0.01)
const float restOpacity = 0.25;
#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.010, 0.020, 0.050);
#pragma ograf transparentBackground toggle
const bool transparentBackground = true;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float roundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

// Clockwise arc length from the top edge's left end, around a rounded rectangle whose straight
// sections span +-inner and whose corners have the given radius.
float perimeterPosition(vec2 p, vec2 inner, float radius) {
  float w = 2.0 * inner.x;
  float h = 2.0 * inner.y;
  float arc = 1.5707963 * radius;
  if (abs(p.x) <= inner.x && abs(p.y) <= inner.y) {
    // Inside the straight sections: project to the nearest side.
    if (inner.x - abs(p.x) < inner.y - abs(p.y)) p.x = (p.x >= 0.0 ? 1.0 : -1.0) * (inner.x + 1e-3);
    else p.y = (p.y >= 0.0 ? 1.0 : -1.0) * (inner.y + 1e-3);
  }
  if (p.y > inner.y && abs(p.x) <= inner.x) return p.x + inner.x;
  if (p.x > inner.x && p.y > inner.y) {
    vec2 d = p - vec2(inner.x, inner.y);
    return w + atan(d.x, d.y) * radius;
  }
  if (p.x > inner.x && abs(p.y) <= inner.y) return w + arc + (inner.y - p.y);
  if (p.x > inner.x && p.y < -inner.y) {
    vec2 d = p - vec2(inner.x, -inner.y);
    return w + arc + h + atan(-d.y, d.x) * radius;
  }
  if (p.y < -inner.y && abs(p.x) <= inner.x) return w + 2.0 * arc + h + (inner.x - p.x);
  if (p.x < -inner.x && p.y < -inner.y) {
    vec2 d = p - vec2(-inner.x, -inner.y);
    return 2.0 * w + 2.0 * arc + h + atan(-d.x, -d.y) * radius;
  }
  if (p.x < -inner.x && abs(p.y) <= inner.y) return 2.0 * w + 3.0 * arc + h + (p.y + inner.y);
  vec2 d = p - vec2(-inner.x, inner.y);
  return 2.0 * w + 3.0 * arc + 2.0 * h + atan(d.y, -d.x) * radius;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p = coord - 0.5 * iResolution.xy;
  vec2 halfSize = max(0.5 * iResolution.xy - (glowSize + borderWidth), vec2(1.0));
  float radius = min(cornerRadius, min(halfSize.x, halfSize.y));
  vec2 inner = halfSize - radius;

  float distanceToLine = abs(roundedBox(p, halfSize, radius));
  float core = 1.0 - smoothstep(0.5 * borderWidth - 0.5, 0.5 * borderWidth + 0.75, distanceToLine);
  float halo = glowSize > 0.0 ? exp(-distanceToLine / (0.35 * glowSize)) : 0.0;

  float perimeter = 2.0 * (2.0 * inner.x + 2.0 * inner.y) + 4.0 * 1.5707963 * radius;
  float s = perimeterPosition(p, inner, radius);
  if (counterClockwise) s = perimeter - s;
  float tail = max(tailLength * perimeter, 1.0);
  float comet = 0.0;
  float nearestBehind = perimeter;
  for (int k = 0; k < 6; k++) {
    if (k >= cometCount) break;
    float head = fract(iTime / lapSeconds + float(k) / float(cometCount)) * perimeter;
    float behind = mod(head - s, perimeter);
    comet = max(comet, exp(-behind / tail * 3.0));
    nearestBehind = min(nearestBehind, behind);
  }

  float intensity = restOpacity * (0.8 * core + 0.3 * halo) + comet * (core + 0.9 * halo);
  vec3 color = mix(tailColor, glowColor, exp(-nearestBehind / tail * 2.0));
  float alpha = clamp(intensity, 0.0, 1.0);
  if (transparentBackground) {
    fragColor = vec4(color, alpha);
  } else {
    fragColor = vec4(backgroundColor + color * intensity, 1.0);
  }
}
