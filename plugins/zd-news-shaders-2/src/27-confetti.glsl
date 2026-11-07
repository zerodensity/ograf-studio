// Confetti - single Image pass, Shadertoy compatible.
//
// Tumbling, swaying confetti in four colours falling through five depths. For winners and
// results, sports trophies, birthdays and celebrations. Transparent by default, so it falls
// over a photo, a results card or live video; set the colours to the team or party palette.
//
// Technique: each depth layer is a grid of cells whose columns fall at their own speed and phase,
// so no regular pattern survives. A cell may hold one strip, square or dot with its own size,
// sway, spin and a flip that squashes its width as it turns, which reads as 3D tumbling. Pieces
// stay inside their cell, so only one cell is evaluated per layer.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the whole design about the object's centre; below 1 it shrinks inside the box.
// Shadertoy ignores unknown pragmas and alpha; turn transparentBackground off to preview there.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf color1 color
const vec3 color1 = vec3(1.000, 0.250, 0.350);
#pragma ograf color2 color
const vec3 color2 = vec3(1.000, 0.800, 0.200);
#pragma ograf color3 color
const vec3 color3 = vec3(0.200, 0.800, 1.000);
#pragma ograf color4 color
const vec3 color4 = vec3(0.500, 1.000, 0.400);
#pragma ograf density slider min(0) max(1) step(0.01)
const float density = 0.6;
#pragma ograf pieceSize slider min(0.2) max(2) step(0.01)
const float pieceSize = 1.0;
#pragma ograf fallSpeed slider min(0) max(3) step(0.01)
const float fallSpeed = 1.0;
#pragma ograf spin slider min(0) max(3) step(0.01)
const float spin = 1.0;
#pragma ograf sway slider min(0) max(1) step(0.01)
const float sway = 0.5;
#pragma ograf backgroundColor color
const vec3 backgroundColor = vec3(0.020, 0.020, 0.050);
#pragma ograf transparentBackground toggle
const bool transparentBackground = true;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

vec2 hash22(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

float boxDistance(vec2 p, vec2 halfSize) {
  vec2 d = abs(p) - halfSize;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 p0 = coord / iResolution.y;
  vec3 premultiplied = transparentBackground ? vec3(0.0) : backgroundColor;
  float alpha = transparentBackground ? 0.0 : 1.0;

  for (int l = 0; l < 5; l++) {
    float layer = float(l);
    float depth = layer / 4.0;
    float scale = mix(15.3, 6.1, depth);
    vec2 p = p0 * scale + vec2(layer * 3.17, 0.0);
    // Every column falls at its own speed and phase, which breaks up the grid.
    float column = floor(p.x);
    vec2 columnRandom = hash22(vec2(column, layer * 5.3));
    p.y += iTime * fallSpeed * mix(1.0, 2.6, depth) * (0.7 + 0.6 * columnRandom.x) + 10.0 * columnRandom.y;
    vec2 cell = floor(p);
    vec2 h = hash22(cell + layer * 13.7);
    vec2 h2 = hash22(cell + layer * 7.1 + 3.3);
    vec2 h3 = hash22(cell + layer * 2.9 + 8.1);
    if (h2.x > density) continue;

    float swing = sin(iTime * (0.7 + 1.2 * h3.x) + h.y * 6.2831853) * (0.06 + 0.1 * h3.y) * sway;
    vec2 local = fract(p) - (0.5 + (h - 0.5) * 0.36 + vec2(swing, 0.0));
    float angle = iTime * spin * (0.6 + 1.6 * h.x) * (h3.x > 0.5 ? 1.0 : -1.0) + h.y * 6.2831853;
    local = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * local;
    float flip = abs(cos(iTime * spin * (1.5 + 2.5 * h.y) + h.x * 6.2831853));
    local.x /= max(flip, 0.08);

    float size = pieceSize * (0.65 + 0.6 * h3.y);
    float shapePick = fract(h3.x * 7.0 + h2.y * 3.0);
    float d = shapePick < 0.15
      ? length(local) - 0.07 * size
      : boxDistance(local, (shapePick < 0.6 ? vec2(0.12, 0.045) : vec2(0.08, 0.07)) * size);
    float aa = 1.5 * scale / iResolution.y / max(flip, 0.08);
    float piece = 1.0 - smoothstep(0.0, aa, d);
    float pick = h2.y * 4.0;
    vec3 paper = pick < 1.0 ? color1 : pick < 2.0 ? color2 : pick < 3.0 ? color3 : color4;
    paper *= 0.55 + 0.45 * flip;
    paper *= mix(0.7, 1.0, depth);

    premultiplied = premultiplied * (1.0 - piece) + paper * piece;
    alpha = alpha * (1.0 - piece) + piece;
  }

  fragColor = vec4(clamp(premultiplied / max(alpha, 1e-4), 0.0, 1.0), alpha);
}
