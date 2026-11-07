// Heat Shimmer - single Image pass, Shadertoy compatible. An EFFECT: it distorts iChannel0.
//
// Rising heat haze that wobbles the layer like air over hot tarmac, strongest near the bottom,
// with an optional touch of colour fringing. For heatwave and drought weather, desert and
// summer stories, mirage-style reveals, and a dreamy wobble on titles.
//
// In OGraf Studio add it to a layer's Effects as a Shader effect: the effect stack hands the
// layer to the shader as iChannel0. strength 0 passes the layer through untouched, so keyframe
// it to fade the shimmer in and out. In Shadertoy, put an image or video in iChannel0.
//
// Technique: two layers of value noise scroll upwards and offset the texture lookup; the
// offset fades towards the top (verticalBias). Red and blue are read at slightly different
// offsets for the chromatic fringe.
//
// In OGraf Studio the "#pragma ograf" lines expose the constants below as animatable controls.
// zoom scales the layer about its centre before the effect; below 1 it shrinks inside the box.
// Studio keeps an effect inside the layer's own pixels (it may recolour them but not add new
// ones), so on text and logos leave zoom at 1; zoom suits full-frame image and video layers.
//
// Original work for the ZD News Package, dedicated to the public domain under CC0-1.0.

#pragma ograf strength slider min(0) max(1) step(0.01)
const float strength = 0.5;
#pragma ograf rippleScale slider min(1) max(40) step(0.1)
const float rippleScale = 10.0;
#pragma ograf riseSpeed slider min(0) max(3) step(0.01)
const float riseSpeed = 1.0;
#pragma ograf verticalBias slider min(0) max(1) step(0.01)
const float verticalBias = 0.7;
#pragma ograf chromatic slider min(0) max(1) step(0.01)
const float chromatic = 0.2;
#pragma ograf zoom slider min(0.25) max(4) step(0.01)
const float zoom = 1.0;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec4 layerAt(vec2 uv) {
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture(iChannel0, uv) * inside;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 coord = (fragCoord - 0.5 * iResolution.xy) / zoom + 0.5 * iResolution.xy;
  vec2 uv = coord / iResolution.xy;
  if (strength <= 0.0) {
    fragColor = layerAt(uv);
    return;
  }

  vec2 p = coord / iResolution.y * rippleScale;
  float t = iTime * riseSpeed;
  vec2 wobble = vec2(valueNoise(p + vec2(0.0, -t * 2.0)), valueNoise(p * 1.3 + vec2(5.2, -t * 2.4))) - 0.5;
  wobble += 0.5 * (vec2(valueNoise(p * 2.7 + vec2(1.7, -t * 3.5)), valueNoise(p * 2.9 + vec2(8.3, -t * 3.1))) - 0.5);
  float weight = mix(1.0, clamp((1.0 - uv.y) * 1.6, 0.0, 1.0), verticalBias);
  vec2 offset = wobble * strength * 0.02 * weight;
  vec2 fringe = vec2(offset.x * chromatic * 0.5, 0.0);

  vec4 green = layerAt(uv + offset);
  vec4 red = layerAt(uv + offset + fringe);
  vec4 blue = layerAt(uv + offset - fringe);
  fragColor = vec4(red.r, green.g, blue.b, max(green.a, max(red.a, blue.a)));
}
