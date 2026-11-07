import {
  inspectShaderElement,
  resolveShaderParameters,
  type ShaderPaint,
  type EffectBlendMode,
} from '@ograf-editor/scene-model';

export const MAX_SHADER_BACKING_AXIS = 4_096;
export const MAX_SHADER_BACKING_PIXELS = 8_388_608;

type ContextRecord = {
  canvas: HTMLElement;
  lost: boolean;
  restore: () => void;
  gl: WebGL2RenderingContext;
};
const shaderContexts = new Set<ContextRecord>();
const contextListeners = new Set<() => void>();
const physicalContexts = new Map<WebGL2RenderingContext, { count: number; lost: boolean }>();
let lostShaderContexts = 0;
type SharedContext = { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; users: number };
const sharedContexts = new WeakMap<object, SharedContext>();

/** Counts only contexts owned by this runtime; other libraries may use additional contexts. */
export function shaderContextCounts(): { live: number; lost: number } {
  return { live: physicalContexts.size - lostShaderContexts, lost: lostShaderContexts };
}
export function subscribeShaderContexts(listener: () => void): () => void {
  contextListeners.add(listener);
  return () => contextListeners.delete(listener);
}
function notifyShaderContexts(): void {
  for (const listener of contextListeners) listener();
}
function emitShaderContextEvent(canvas: HTMLCanvasElement, state: 'lost' | 'restored'): void {
  const EventClass = canvas.ownerDocument?.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  if (typeof EventClass === 'function')
    canvas.dispatchEvent(
      new EventClass('ograf-shader-context', {
        bubbles: true,
        composed: true,
        detail: { state, ...shaderContextCounts() },
      }),
    );
}
export function shaderContextsLostIn(root: HTMLElement): boolean {
  return [...shaderContexts].some((context) => context.lost && root.contains(context.canvas));
}
export function pausedShaderLayerIds(): string[] {
  return [
    ...new Set(
      [...shaderContexts].flatMap((context) => {
        const id = context.lost
          ? context.canvas.closest?.<HTMLElement>('[data-layer-id]')?.dataset.layerId
          : undefined;
        return id ? [id] : [];
      }),
    ),
  ];
}
export function restoreShaderLayer(layerId: string): void {
  for (const context of shaderContexts) {
    if (
      context.lost &&
      context.canvas.closest?.<HTMLElement>('[data-layer-id]')?.dataset.layerId === layerId
    )
      context.restore();
  }
}
/** Request a browser restore once; the browser may refuse until GPU resources are available. */
export function restoreShaderContextsIn(root: HTMLElement): void {
  for (const context of shaderContexts)
    if (context.lost && root.contains(context.canvas)) context.restore();
}

interface ShaderSizedLayer {
  keyframes: ReadonlyArray<{ transform: { width: number; height: number } }>;
  animationTracks: Partial<Record<'width' | 'height', ReadonlyArray<{ value: number }>>>;
  loop?: { tracks: Partial<Record<'width' | 'height', ReadonlyArray<{ value: number }>>> } | null;
}

/** Use authored pixels, independent of editor zoom and device pixel ratio. */
export function shaderBackingSizeForLayer(layer: ShaderSizedLayer): {
  width: number;
  height: number;
} {
  const maximum = (property: 'width' | 'height') =>
    Math.max(
      1,
      ...[
        ...layer.keyframes.map((keyframe) => keyframe.transform[property]),
        ...(layer.animationTracks[property] ?? []).map((keyframe) => keyframe.value),
        ...(layer.loop?.tracks[property] ?? []).map((keyframe) => keyframe.value),
      ].filter((value) => Number.isFinite(value) && value > 0),
    );
  return { width: Math.ceil(maximum('width')), height: Math.ceil(maximum('height')) };
}

export function shaderBackingSize(
  size: { width: number; height: number },
  resolutionScale: number,
  maxAxis = MAX_SHADER_BACKING_AXIS,
): { width: number; height: number } {
  const quality = Number.isFinite(resolutionScale)
    ? Math.min(1, Math.max(0.25, resolutionScale))
    : 1;
  const width = Math.max(1, Number.isFinite(size.width) ? size.width : 1) * quality;
  const height = Math.max(1, Number.isFinite(size.height) ? size.height : 1) * quality;
  const scale = Math.min(
    1,
    maxAxis / width,
    maxAxis / height,
    Math.sqrt(MAX_SHADER_BACKING_PIXELS / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

export function shaderTimeSeconds(elapsedMs: number, speed: number): number {
  const safeSpeed = Number.isFinite(speed) ? Math.max(0, Math.min(10, speed)) : 1;
  return (Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1000) * safeSpeed;
}

function sameInputImage(
  left: ShaderPaint['inputImage'],
  right: ShaderPaint['inputImage'],
): boolean {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.source === right.source &&
      left.wrap === right.wrap &&
      left.filter === right.filter)
  );
}

const VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

export interface ShaderEffectConfig {
  blendMode: EffectBlendMode;
  blendOpacity: number;
}

const EFFECT_BLEND_INDEX: Record<EffectBlendMode, number> = {
  normal: 0,
  screen: 1,
  add: 2,
  multiply: 3,
  overlay: 4,
  darken: 5,
  lighten: 6,
};

export function shaderFragmentSource(source: string, effect = false, textTint = false): string {
  if (effect && textTint) throw new Error('Text tint is not supported on shader effect passes.');
  return `#version 300 es
precision highp float;
precision highp int;
uniform float iTime;
uniform vec3 iResolution;
uniform sampler2D iChannel0;
uniform vec3 iChannelResolution[4];
${effect ? 'uniform int ografEffectBlendMode;\nuniform float ografEffectOpacity;' : ''}
uniform sampler2D ografCoverageSampler;
${textTint ? 'uniform sampler2D ografTextTintSampler;' : ''}
out vec4 ografFragmentColor;
${
  effect
    ? `vec3 ografBlend(vec3 base, vec3 value, int mode) {
  if (mode == 1) return 1.0 - (1.0 - base) * (1.0 - value);
  if (mode == 2) return min(vec3(1.0), base + value);
  if (mode == 3) return base * value;
  if (mode == 4) return mix(2.0 * base * value, 1.0 - 2.0 * (1.0 - base) * (1.0 - value), step(vec3(0.5), base));
  if (mode == 5) return min(base, value);
  if (mode == 6) return max(base, value);
  return value;
}`
    : ''
}
#line 1
${source}
void main() {
  mainImage(ografFragmentColor, gl_FragCoord.xy);
  ${
    effect
      ? `vec4 ografInput = texture(iChannel0, gl_FragCoord.xy / iResolution.xy);
  vec3 ografMixed = ografBlend(ografInput.rgb, ografFragmentColor.rgb, ografEffectBlendMode);
  vec4 ografEffect = vec4(ografMixed, ografFragmentColor.a);
  ografFragmentColor = mix(ografInput, ografEffect, clamp(ografEffectOpacity, 0.0, 1.0));`
      : textTint
        ? `vec2 ografMaskUv = gl_FragCoord.xy / iResolution.xy;
  float ografCoverage = texture(ografCoverageSampler, ografMaskUv).a;
  vec4 ografTint = texture(ografTextTintSampler, ografMaskUv);
  float ografTintWeight = ografCoverage > 0.0 ? clamp(ografTint.a / ografCoverage, 0.0, 1.0) : 0.0;
  ografFragmentColor.rgb = mix(ografFragmentColor.rgb, ografTint.rgb, ografTintWeight);
  ografFragmentColor.a *= ografCoverage;`
        : 'ografFragmentColor.a *= texture(ografCoverageSampler, gl_FragCoord.xy / iResolution.xy).a;'
  }
  // Keep shader/effect calculations straight-alpha, then associate RGB only for presentation.
  ografFragmentColor = clamp(ografFragmentColor, 0.0, 1.0);
  ografFragmentColor.rgb *= ografFragmentColor.a;
}
`;
}

/** A lost context can recover; the realtime driver should retry instead of latching an error. */
export class ShaderContextLostError extends Error {
  constructor() {
    super('Shader WebGL context was lost; waiting for the browser to restore it.');
    this.name = 'ShaderContextLostError';
  }
}

export interface ShaderRenderer {
  render(elapsedMs: number): void;
  updateParameters(element: ShaderPaint): void;
  setCoverage(source: TexImageSource | null): void;
  /** Experimental: only available when explicitly requested at renderer creation. */
  setTextTint(source: TexImageSource | null): void;
  setInput(source: TexImageSource): void;
  setEffectBlend(config: ShaderEffectConfig): void;
  checkReady(): void;
  ready(): Promise<void>;
  /** Wait for submitted pixels only at deterministic seek/capture boundaries. */
  completeFrame(): Promise<void>;
  dispose(): void;
}

/** Single-pass, stateless Shadertoy Image renderer; every draw depends on an absolute timestamp. */
export function createShaderRenderer(
  canvas: HTMLCanvasElement,
  element: ShaderPaint,
  size: { width: number; height: number },
  reportError: (error: Error | null) => void = () => {},
  requireCoverage = false,
  effectConfig?: ShaderEffectConfig,
  scopeHost?: HTMLElement,
  textTint = false,
): ShaderRenderer {
  if (textTint && effectConfig)
    throw new Error('Text tint is not supported on shader effect passes.');
  const inspection = inspectShaderElement(element, { channel0Provided: !!effectConfig });
  if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
  let parameterValues = resolveShaderParameters(element);
  let currentElement = element;
  const contextOptions: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    depth: false,
    stencil: false,
  };
  const host = scopeHost ?? canvas;
  const root = host.getRootNode?.();
  // Editor stages and individual graphic shadow roots are independent rendering scopes.
  const scope =
    host.closest?.('.canvas-stage-frame') ??
    (root && root.nodeType === 11 && 'host' in root ? root : null);
  let pool = scope ? sharedContexts.get(scope) : undefined;
  if (scope && !pool) {
    const surface = canvas.ownerDocument.createElement('canvas');
    const sharedGl = surface.getContext('webgl2', contextOptions);
    if (sharedGl) {
      pool = { canvas: surface, gl: sharedGl, users: 0 };
      sharedContexts.set(scope, pool);
    }
  }
  const destination = pool ? canvas.getContext('2d') : null;
  // If 2D presentation is unavailable, use the original direct renderer.
  if (pool && !destination) {
    if (pool.users === 0) {
      pool.gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (scope) sharedContexts.delete(scope);
    }
    pool = undefined;
  }
  const gpuCanvas = pool?.canvas ?? canvas;
  const gl = pool?.gl ?? canvas.getContext('webgl2', contextOptions);
  if (!gl)
    throw new Error('Shader backgrounds require WebGL 2, which is unavailable in this renderer.');
  if (pool) pool.users += 1;

  // Keep the extension obtained while the context is live; getExtension can return null during loss.
  const loseContextExtension = gl.getExtension('WEBGL_lose_context');
  const contextRecord: ContextRecord = {
    canvas: scopeHost ?? canvas,
    lost: false,
    gl,
    restore: () => {
      try {
        loseContextExtension?.restoreContext?.();
      } catch {
        /* The browser can decline restoration while resources remain exhausted. */
      }
    },
  };
  shaderContexts.add(contextRecord);
  const group = physicalContexts.get(gl) ?? { count: 0, lost: false };
  group.count += 1;
  physicalContexts.set(gl, group);
  notifyShaderContexts();
  const updatePausedOwner = () => {
    if (!scopeHost) return;
    if ([...shaderContexts].some((record) => record.canvas === scopeHost && record.lost))
      scopeHost.dataset.ografShaderPaused = 'true';
    else delete scopeHost.dataset.ografShaderPaused;
  };

  let program: WebGLProgram | null = null;
  let vertexArray: WebGLVertexArrayObject | null = null;
  let colorTexture: WebGLTexture | null = null;
  let coverageTexture: WebGLTexture | null = null;
  let textTintTexture: WebGLTexture | null = null;
  let inputTexture: WebGLTexture | null = null;
  let coverageSource: TexImageSource | null = null;
  let textTintSource: TexImageSource | null = null;
  let externalInputSource: TexImageSource | null = null;
  let currentEffectConfig = effectConfig;
  let framebuffer: WebGLFramebuffer | null = null;
  let timeUniform: WebGLUniformLocation | null = null;
  let resolutionUniform: WebGLUniformLocation | null = null;
  let channelResolutionUniform: WebGLUniformLocation | null = null;
  let effectBlendUniform: WebGLUniformLocation | null = null;
  let effectOpacityUniform: WebGLUniformLocation | null = null;
  const parameterUniforms = new Map<string, WebGLUniformLocation | null>();
  let error: Error | null = null;
  let disposed = false;
  let elapsedMs = 0;
  let submittedRevision = 0;
  let completedRevision = 0;
  const completions = new Map<number, { promise: Promise<void>; cancel: (error: Error) => void }>();
  const inputImage = element.inputImage ? canvas.ownerDocument.createElement('img') : null;
  let inputReadyResolve: (() => void) | undefined;
  let inputReadySettled = !inputImage;
  const inputReady = inputImage
    ? new Promise<void>((resolve) => {
        inputReadyResolve = resolve;
      })
    : Promise.resolve();

  const settleInputReady = () => {
    if (inputReadySettled) return;
    inputReadySettled = true;
    inputReadyResolve?.();
  };

  const releaseResources = () => {
    if (program) gl.deleteProgram(program);
    if (vertexArray) gl.deleteVertexArray(vertexArray);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (colorTexture) gl.deleteTexture(colorTexture);
    if (coverageTexture) gl.deleteTexture(coverageTexture);
    if (textTintTexture) gl.deleteTexture(textTintTexture);
    if (inputTexture) gl.deleteTexture(inputTexture);
    program = null;
    vertexArray = null;
    framebuffer = null;
    colorTexture = null;
    coverageTexture = null;
    textTintTexture = null;
    inputTexture = null;
  };

  const uploadInputImage = () => {
    if ((!element.inputImage && !currentEffectConfig) || !inputTexture) return;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (externalInputSource)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, externalInputSource);
    else if (inputImage?.complete && inputImage.naturalWidth > 0 && inputImage.naturalHeight > 0)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, inputImage);
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]),
      );
    const filter = element.inputImage?.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    const wrap = element.inputImage?.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  };

  const uploadCoverage = () => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, coverageTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (coverageSource)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, coverageSource);
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([255, 255, 255, requireCoverage ? 0 : 255]),
      );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  const uploadTextTint = () => {
    if (!textTintTexture) return;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textTintTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (textTintSource)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textTintSource);
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]),
      );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };

  const compileShader = (kind: number, source: string): WebGLShader => {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('Unable to allocate a WebGL shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const details = gl.getShaderInfoLog(shader) || 'Unknown GLSL compiler error.';
      gl.deleteShader(shader);
      throw new Error(
        `Shader ${kind === gl.FRAGMENT_SHADER ? 'fragment' : 'vertex'} compilation failed: ${details}`,
      );
    }
    return shader;
  };

  const initialize = () => {
    releaseResources();
    let vertex: WebGLShader | null = null;
    let fragment: WebGLShader | null = null;
    try {
      vertex = compileShader(gl.VERTEX_SHADER, VERTEX_SOURCE);
      fragment = compileShader(
        gl.FRAGMENT_SHADER,
        shaderFragmentSource(inspection.adaptedSource, !!currentEffectConfig, textTint),
      );
      program = gl.createProgram();
      if (!program) throw new Error('Unable to allocate a WebGL shader program.');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(
          `Shader program linking failed: ${gl.getProgramInfoLog(program) || 'Unknown WebGL linker error.'}`,
        );
      }
      vertexArray = gl.createVertexArray();
      if (!vertexArray) throw new Error('Unable to allocate a WebGL vertex array.');
      timeUniform = gl.getUniformLocation(program, 'iTime');
      resolutionUniform = gl.getUniformLocation(program, 'iResolution');
      channelResolutionUniform = gl.getUniformLocation(program, 'iChannelResolution[0]');
      effectBlendUniform = currentEffectConfig
        ? gl.getUniformLocation(program, 'ografEffectBlendMode')
        : null;
      effectOpacityUniform = currentEffectConfig
        ? gl.getUniformLocation(program, 'ografEffectOpacity')
        : null;
      parameterUniforms.clear();
      for (const parameter of inspection.parameters) {
        parameterUniforms.set(parameter.name, gl.getUniformLocation(program, parameter.name));
      }
      const limits = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
      const maxAxis = Math.min(
        MAX_SHADER_BACKING_AXIS,
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
        gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        limits[0]!,
        limits[1]!,
      );
      const backing = shaderBackingSize(size, element.resolutionScale, maxAxis);
      canvas.width = backing.width;
      canvas.height = backing.height;
      // Quantize shader output into one owned RGBA8 target. Browser default framebuffers can
      // change presentation formats after the first composite, producing one-byte differences
      // across otherwise identical seeks. Blitting already-quantized pixels avoids that path.
      colorTexture = gl.createTexture();
      framebuffer = gl.createFramebuffer();
      if (!colorTexture || !framebuffer)
        throw new Error('Unable to allocate a shader frame target.');
      gl.bindTexture(gl.TEXTURE_2D, colorTexture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, canvas.width, canvas.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Shader RGBA8 frame target is incomplete.');
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      coverageTexture = gl.createTexture();
      if (!coverageTexture) throw new Error('Unable to allocate shader fill coverage.');
      uploadCoverage();
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program, 'ografCoverageSampler'), 0);
      if (textTint) {
        textTintTexture = gl.createTexture();
        if (!textTintTexture) throw new Error('Unable to allocate text tint coverage.');
        uploadTextTint();
        gl.uniform1i(gl.getUniformLocation(program, 'ografTextTintSampler'), 2);
      }
      if (element.inputImage || currentEffectConfig) {
        inputTexture = gl.createTexture();
        if (!inputTexture) throw new Error('Unable to allocate shader iChannel0 texture.');
        uploadInputImage();
        gl.uniform1i(gl.getUniformLocation(program, 'iChannel0'), 1);
      }
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DITHER);
      error = null;
      reportError(null);
    } catch (cause) {
      releaseResources();
      throw cause;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  };

  const checkReady = () => {
    if (disposed) throw new Error('Shader playback has been disposed.');
    if (gl.isContextLost()) throw new ShaderContextLostError();
    if (error) throw error;
    if (!program) throw new Error('Shader background has not initialized.');
  };

  const render = (timestampMs: number) => {
    elapsedMs = timestampMs;
    checkReady();
    if (pool && (gpuCanvas.width !== canvas.width || gpuCanvas.height !== canvas.height)) {
      gpuCanvas.width = canvas.width;
      gpuCanvas.height = canvas.height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, coverageTexture);
    if (textTint && textTintTexture) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, textTintTexture);
    }
    gl.uniform1f(timeUniform, shaderTimeSeconds(elapsedMs, currentElement.speed));
    gl.uniform3f(resolutionUniform, canvas.width, canvas.height, 1);
    if ((element.inputImage || currentEffectConfig) && inputTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      gl.uniform3f(
        channelResolutionUniform,
        externalInputSource
          ? Number((externalInputSource as { width?: number }).width) || 1
          : inputImage?.naturalWidth || 1,
        externalInputSource
          ? Number((externalInputSource as { height?: number }).height) || 1
          : inputImage?.naturalHeight || 1,
        1,
      );
    }
    if (currentEffectConfig) {
      gl.uniform1i(effectBlendUniform, EFFECT_BLEND_INDEX[currentEffectConfig.blendMode]);
      gl.uniform1f(effectOpacityUniform, currentEffectConfig.blendOpacity);
    }
    for (const parameter of inspection.parameters) {
      const location = parameterUniforms.get(parameter.name) ?? null;
      const value = parameterValues[parameter.name]!;
      switch (parameter.glslType) {
        case 'float':
          gl.uniform1f(location, value as number);
          break;
        case 'int':
          gl.uniform1i(location, value as number);
          break;
        case 'bool':
          gl.uniform1i(location, value ? 1 : 0);
          break;
        case 'vec2':
          gl.uniform2fv(location, value as number[]);
          break;
        case 'vec3':
          gl.uniform3fv(location, value as number[]);
          break;
        case 'vec4':
          gl.uniform4fv(location, value as number[]);
          break;
      }
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(
      0,
      0,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (destination) {
      destination.clearRect(0, 0, canvas.width, canvas.height);
      destination.drawImage(gpuCanvas, 0, 0);
    }
    submittedRevision += 1;
  };

  const checkFrameError = () => {
    const code = gl.getError();
    if (code !== gl.NO_ERROR) {
      if (gl.isContextLost()) throw new ShaderContextLostError();
      error = new Error(`Shader frame rendering failed (WebGL error ${code}).`);
      reportError(error);
      throw error;
    }
  };

  const completeFrame = (): Promise<void> => {
    try {
      checkReady();
    } catch (cause) {
      return Promise.reject(cause);
    }
    const revision = submittedRevision;
    if (revision <= completedRevision) return Promise.resolve();
    const existing = completions.get(revision);
    if (existing) return existing.promise;
    // Realtime draws stay asynchronous. Fences are inserted only when OGraf requests an exact
    // completed frame (seek, resource preparation, or capture), never for each animation tick.
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return Promise.reject(new Error('Unable to allocate a shader completion fence.'));
    gl.flush();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const settle = (failure?: Error) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      gl.deleteSync(sync);
      completions.delete(revision);
      if (failure) rejectCompletion(failure);
      else {
        completedRevision = Math.max(completedRevision, revision);
        resolveCompletion();
      }
    };
    completions.set(revision, { promise, cancel: settle });
    const deadline = Date.now() + 30_000;
    const poll = () => {
      try {
        checkReady();
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
          checkFrameError();
          settle();
        } else if (status === gl.WAIT_FAILED) {
          checkFrameError();
          throw new Error('Shader GPU completion wait failed.');
        } else if (Date.now() >= deadline) {
          throw new Error('Shader GPU frame did not complete within 30000 ms.');
        } else timer = setTimeout(poll, 0);
      } catch (cause) {
        const failure = cause instanceof Error ? cause : new Error(String(cause));
        if (!disposed && !(failure instanceof ShaderContextLostError) && error !== failure) {
          error = failure;
          reportError(error);
        }
        settle(failure);
      }
    };
    // The browser may have queued commands not yet visible to the GPU. Yield before the first
    // zero-timeout poll, so completion never spins or blocks the main thread awaiting the GPU.
    timer = setTimeout(poll, 0);
    return promise;
  };

  const cancelCompletions = (failure: Error) => {
    for (const completion of [...completions.values()]) completion.cancel(failure);
  };

  const updateParameters = (nextElement: ShaderPaint) => {
    if (
      nextElement.fragmentSource !== element.fragmentSource ||
      nextElement.resolutionScale !== element.resolutionScale ||
      !sameInputImage(nextElement.inputImage, element.inputImage)
    ) {
      throw new Error('Shader source or resolution changes require a new renderer.');
    }
    const nextInspection = inspectShaderElement(nextElement, { channel0Provided: !!effectConfig });
    if (!nextInspection.valid) throw new Error(nextInspection.errors.join('\n'));
    const nextValues = resolveShaderParameters(nextElement);
    // Validate the whole patch before changing live uniforms. A bad data update leaves the last
    // successful frame usable and can be corrected without replacing its WebGL context.
    currentElement = nextElement;
    parameterValues = nextValues;
    render(elapsedMs);
  };

  const lost = (event: Event) => {
    event.preventDefault();
    if (!group.lost) {
      group.lost = true;
      lostShaderContexts += 1;
    }
    contextRecord.lost = true;
    canvas.dataset.ografShaderPaused = 'true';
    updatePausedOwner();
    notifyShaderContexts();
    emitShaderContextEvent(canvas, 'lost');
    cancelCompletions(new ShaderContextLostError());
    // Context loss invalidates every GPU object; restored contexts must use fresh handles.
    program = null;
    vertexArray = null;
    colorTexture = null;
    coverageTexture = null;
    textTintTexture = null;
    inputTexture = null;
    framebuffer = null;
    timeUniform = null;
    resolutionUniform = null;
    channelResolutionUniform = null;
    effectBlendUniform = null;
    effectOpacityUniform = null;
    parameterUniforms.clear();
    error = new ShaderContextLostError();
    reportError(error);
  };
  const restored = () => {
    if (disposed) return;
    try {
      initialize();
      render(elapsedMs);
      if (group.lost) {
        group.lost = false;
        lostShaderContexts -= 1;
      }
      contextRecord.lost = false;
      delete canvas.dataset.ografShaderPaused;
      updatePausedOwner();
      notifyShaderContexts();
      emitShaderContextEvent(canvas, 'restored');
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error(String(cause));
      reportError(error);
    }
  };
  gpuCanvas.addEventListener('webglcontextlost', lost);
  gpuCanvas.addEventListener('webglcontextrestored', restored);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    shaderContexts.delete(contextRecord);
    updatePausedOwner();
    group.count -= 1;
    if (group.count === 0) {
      if (group.lost) lostShaderContexts -= 1;
      physicalContexts.delete(gl);
    }
    delete canvas.dataset.ografShaderPaused;
    delete canvas.dataset.ografShaderBackend;
    notifyShaderContexts();
    cancelCompletions(new Error('Shader playback has been disposed.'));
    gpuCanvas.removeEventListener('webglcontextlost', lost);
    gpuCanvas.removeEventListener('webglcontextrestored', restored);
    if (inputImage) {
      inputImage.onload = null;
      inputImage.onerror = null;
    }
    settleInputReady();
    releaseResources();
    // Browsers cap simultaneous contexts; return this one when a layer is removed/recompiled.
    if (!pool || --pool.users === 0) {
      loseContextExtension?.loseContext();
      if (scope && pool) sharedContexts.delete(scope);
    }
    canvas.width = 1;
    canvas.height = 1;
  };
  try {
    initialize();
    render(0);
    // Validate the initial submission once; normal realtime draws avoid synchronous error reads.
    checkFrameError();
    // Shared GPU scopes present each shader through a Canvas2D copy. Pixel inspection must read
    // that retained image, rather than requesting an incompatible WebGL context on this canvas.
    canvas.dataset.ografShaderBackend = destination ? 'canvas2d' : 'webgl2';
  } catch (cause) {
    dispose();
    throw cause;
  }
  if (inputImage && element.inputImage) {
    inputImage.onload = () => {
      if (disposed) return settleInputReady();
      try {
        uploadInputImage();
        render(elapsedMs);
      } catch (cause) {
        error = cause instanceof Error ? cause : new Error(String(cause));
        reportError(error);
      } finally {
        settleInputReady();
      }
    };
    inputImage.onerror = () => {
      error = new Error('Shader iChannel0 input image could not be decoded.');
      reportError(error);
      settleInputReady();
    };
    inputImage.decoding = 'async';
    inputImage.src = element.inputImage.source;
  }
  const setCoverage = (source: TexImageSource | null) => {
    coverageSource = source;
    checkReady();
    uploadCoverage();
  };
  const setTextTint = (source: TexImageSource | null) => {
    if (!textTint) throw new Error('Experimental text tint was not enabled for this shader.');
    textTintSource = source;
    checkReady();
    uploadTextTint();
  };
  const ready = async () => {
    await inputReady;
    checkReady();
  };
  const setInput = (source: TexImageSource) => {
    if (!currentEffectConfig) throw new Error('Only shader effects accept an incoming image.');
    externalInputSource = source;
    checkReady();
    uploadInputImage();
  };
  const setEffectBlend = (config: ShaderEffectConfig) => {
    if (!currentEffectConfig) throw new Error('This shader is not an effect pass.');
    currentEffectConfig = config;
    render(elapsedMs);
  };
  return {
    render,
    updateParameters,
    setCoverage,
    setTextTint,
    setInput,
    setEffectBlend,
    checkReady,
    ready,
    completeFrame,
    dispose,
  };
}

interface MountedShader {
  element: ShaderPaint;
  size: { width: number; height: number };
  renderer?: ShaderRenderer;
  error?: Error;
}
const mountedShaders = new WeakMap<HTMLElement, MountedShader>();

export function mountShader(
  container: HTMLElement,
  element: ShaderPaint,
  preferredSize?: { width: number; height: number },
  requireCoverage = false,
  textTint = false,
): void {
  const canvas = container.ownerDocument.createElement('canvas');
  canvas.dataset.ografShaderCanvas = 'true';
  canvas.dataset.ografShader = 'true';
  Object.assign(canvas.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  });
  container.appendChild(canvas);
  const size = preferredSize ?? {
    width: container.clientWidth || Number.parseFloat(container.style.width) || 1,
    height: container.clientHeight || Number.parseFloat(container.style.height) || 1,
  };
  const mounted: MountedShader = { element, size };
  mountedShaders.set(container, mounted);
  const displayError = (error: Error | null) => {
    container.querySelector('[data-ograf-shader-error-message]')?.remove();
    if (!error) {
      delete container.dataset.ografShaderError;
      return;
    }
    container.dataset.ografShaderError = error.message;
    const message = container.ownerDocument.createElement('div');
    message.dataset.ografShaderErrorMessage = 'true';
    message.setAttribute('role', 'alert');
    message.textContent = error.message;
    Object.assign(message.style, {
      position: 'absolute',
      inset: '0',
      padding: '12px',
      background: '#321b26',
      color: '#ffbed2',
      font: '12px monospace',
      overflow: 'auto',
      whiteSpace: 'pre-wrap',
    });
    container.appendChild(message);
  };
  try {
    mounted.renderer = createShaderRenderer(
      canvas,
      element,
      size,
      displayError,
      requireCoverage,
      undefined,
      undefined,
      textTint,
    );
  } catch (cause) {
    mounted.error = cause instanceof Error ? cause : new Error(String(cause));
    displayError(mounted.error);
  }
}

/** Returns false only when a new shader program/backing is needed. Value updates retain time. */
export function updateShaderParameters(
  container: HTMLElement,
  element: ShaderPaint,
  preferredSize?: { width: number; height: number },
): boolean {
  const mounted = mountedShaders.get(container);
  if (
    !mounted?.renderer ||
    mounted.element.fragmentSource !== element.fragmentSource ||
    mounted.element.resolutionScale !== element.resolutionScale ||
    !sameInputImage(mounted.element.inputImage, element.inputImage) ||
    (preferredSize &&
      (mounted.size.width !== preferredSize.width || mounted.size.height !== preferredSize.height))
  )
    return false;
  mounted.renderer.updateParameters(element);
  mounted.element = element;
  return true;
}

export function setShaderCoverage(container: HTMLElement, source: TexImageSource | null): void {
  const mounted = mountedShaders.get(container);
  if (!mounted?.renderer) throw mounted?.error ?? new Error('Shader fill is not mounted.');
  mounted.renderer.setCoverage(source);
}

/** Experimental text-only path; validation must still reject unsupported paint combinations. */
export function setShaderTextTint(container: HTMLElement, source: TexImageSource | null): void {
  const mounted = mountedShaders.get(container);
  if (!mounted?.renderer) throw mounted?.error ?? new Error('Shader fill is not mounted.');
  mounted.renderer.setTextTint(source);
}

export function renderShaderAtTime(container: HTMLElement, elapsedMs: number): void {
  const mounted = mountedShaders.get(container);
  if (!mounted) throw new Error('Shader background is not mounted.');
  if (mounted.error) throw mounted.error;
  mounted.renderer?.render(elapsedMs);
}

export async function waitForShadersReady(root: ParentNode): Promise<void> {
  const renderers = [root, ...root.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
    const mounted = mountedShaders.get(element as HTMLElement);
    if (mounted?.error) throw mounted.error;
    return mounted?.renderer ? [mounted.renderer] : [];
  });
  await Promise.all(renderers.map((renderer) => renderer.ready()));
}

/** Ensures exact shader pixels after the final requested frame, without blocking realtime draws. */
export async function waitForShadersComplete(root: ParentNode): Promise<void> {
  const renderers = [root, ...root.querySelectorAll<HTMLElement>('*')].flatMap((element) => {
    const mounted = mountedShaders.get(element as HTMLElement);
    if (mounted?.error) throw mounted.error;
    return mounted?.renderer ? [mounted.renderer] : [];
  });
  await Promise.all(renderers.map((renderer) => renderer.completeFrame()));
}

export function disposeShader(container: HTMLElement): void {
  mountedShaders.get(container)?.renderer?.dispose();
  mountedShaders.delete(container);
  delete container.dataset.ografShaderError;
}
