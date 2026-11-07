# ZD News Shaders 2

An independent CC0 shader pack containing presets 21–40. It installs alongside **ZD News Shaders**;
it does not replace or update the first pack.

Build with `npm run plugin:package:shaders:2`. Install the resulting `.ogsplugin.zip` through
**Plugins → Add plugin…**, review the bundle, then select **Shader → ZD News Shaders 2**.

Sixteen presets support **Fill** and text **Outline**. **LED Matrix**, **Tile Reveal**, **Neon Sign**
and **Heat Shimmer** are **Effect**-only: they process the selected layer through `iChannel0`.
Source comments, descriptions and exposed controls are preserved.

Equalizer Bars is a decorative animation, not an audio analyser. Fireworks and Neon Sign can be
GPU-intensive; reduce shader resolution scale if necessary. The current shader-effect alpha
clipping remains unchanged: for a halo outside neon letters, add Studio's **Glow** after Neon Sign.

See [Shader plugins](../../docs/SHADER_PLUGINS.md) for bundle usage and limitations.
