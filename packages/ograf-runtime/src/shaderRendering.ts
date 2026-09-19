import {
  inspectShaderElement,
  resolveShaderParameters,
  type ShaderPaint,
} from '@ograf-editor/scene-model';

export const MAX_SHADER_BACKING_AXIS = 4_096;
export const MAX_SHADER_BACKING_PIXELS = 8_388_608;

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

const VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

export function shaderFragmentSource(source: string): string {
  return `#version 300 es
precision highp float;
precision highp int;
uniform float iTime;
uniform vec3 iResolution;
uniform sampler2D ografCoverageSampler;
out vec4 ografFragmentColor;
#line 1
${source}
void main() {
  mainImage(ografFragmentColor, gl_FragCoord.xy);
  ografFragmentColor.a *= texture(ografCoverageSampler, gl_FragCoord.xy / iResolution.xy).a;
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
  checkReady(): void;
  dispose(): void;
}

/** Single-pass, stateless Shadertoy Image renderer; every draw depends on an absolute timestamp. */
export function createShaderRenderer(
  canvas: HTMLCanvasElement,
  element: ShaderPaint,
  size: { width: number; height: number },
  reportError: (error: Error | null) => void = () => {},
  requireCoverage = false,
): ShaderRenderer {
  const inspection = inspectShaderElement(element);
  if (!inspection.valid) throw new Error(inspection.errors.join('\n'));
  let parameterValues = resolveShaderParameters(element);
  let currentElement = element;
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    depth: false,
    stencil: false,
  });
  if (!gl)
    throw new Error('Shader backgrounds require WebGL 2, which is unavailable in this renderer.');

  let program: WebGLProgram | null = null;
  let vertexArray: WebGLVertexArrayObject | null = null;
  let colorTexture: WebGLTexture | null = null;
  let coverageTexture: WebGLTexture | null = null;
  let coverageSource: TexImageSource | null = null;
  let framebuffer: WebGLFramebuffer | null = null;
  let timeUniform: WebGLUniformLocation | null = null;
  let resolutionUniform: WebGLUniformLocation | null = null;
  const parameterUniforms = new Map<string, WebGLUniformLocation | null>();
  let error: Error | null = null;
  let disposed = false;
  let elapsedMs = 0;

  const releaseResources = () => {
    if (program) gl.deleteProgram(program);
    if (vertexArray) gl.deleteVertexArray(vertexArray);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (colorTexture) gl.deleteTexture(colorTexture);
    if (coverageTexture) gl.deleteTexture(coverageTexture);
    program = null;
    vertexArray = null;
    framebuffer = null;
    colorTexture = null;
    coverageTexture = null;
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
      fragment = compileShader(gl.FRAGMENT_SHADER, shaderFragmentSource(inspection.adaptedSource));
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindVertexArray(vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, coverageTexture);
    gl.uniform1f(timeUniform, shaderTimeSeconds(elapsedMs, currentElement.speed));
    gl.uniform3f(resolutionUniform, canvas.width, canvas.height, 1);
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
    // Complete the requested frame before OGraf goToTime resolves and before canvas capture.
    gl.finish();
    const code = gl.getError();
    if (code !== gl.NO_ERROR) {
      if (gl.isContextLost()) throw new ShaderContextLostError();
      error = new Error(`Shader frame rendering failed (WebGL error ${code}).`);
      reportError(error);
      throw error;
    }
  };

  const updateParameters = (nextElement: ShaderPaint) => {
    if (
      nextElement.fragmentSource !== element.fragmentSource ||
      nextElement.resolutionScale !== element.resolutionScale
    ) {
      throw new Error('Shader source or resolution changes require a new renderer.');
    }
    const nextInspection = inspectShaderElement(nextElement);
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
    // Context loss invalidates every GPU object; restored contexts must use fresh handles.
    program = null;
    vertexArray = null;
    colorTexture = null;
    coverageTexture = null;
    framebuffer = null;
    timeUniform = null;
    resolutionUniform = null;
    parameterUniforms.clear();
    error = new ShaderContextLostError();
    reportError(error);
  };
  const restored = () => {
    if (disposed) return;
    try {
      initialize();
      render(elapsedMs);
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error(String(cause));
      reportError(error);
    }
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
    releaseResources();
    // Browsers cap simultaneous contexts; return this one when a layer is removed/recompiled.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.width = 1;
    canvas.height = 1;
  };
  try {
    initialize();
    render(0);
  } catch (cause) {
    dispose();
    throw cause;
  }
  const setCoverage = (source: TexImageSource | null) => {
    coverageSource = source;
    checkReady();
    uploadCoverage();
  };
  return { render, updateParameters, setCoverage, checkReady, dispose };
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
    mounted.renderer = createShaderRenderer(canvas, element, size, displayError, requireCoverage);
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

export function renderShaderAtTime(container: HTMLElement, elapsedMs: number): void {
  const mounted = mountedShaders.get(container);
  if (!mounted) throw new Error('Shader background is not mounted.');
  if (mounted.error) throw mounted.error;
  mounted.renderer?.render(elapsedMs);
}

export function assertShadersReady(root: ParentNode): void {
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const mounted = mountedShaders.get(element as HTMLElement);
    if (mounted?.error) throw mounted.error;
    mounted?.renderer?.checkReady();
  }
}

export function disposeShader(container: HTMLElement): void {
  mountedShaders.get(container)?.renderer?.dispose();
  mountedShaders.delete(container);
  delete container.dataset.ografShaderError;
}
