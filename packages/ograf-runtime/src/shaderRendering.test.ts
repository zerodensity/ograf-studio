import { describe, expect, it, vi } from 'vitest';
import { createShaderElement, type ShaderElement } from '@ograf-editor/scene-model';
import type { CompiledLayer } from '@ograf-editor/ograf-types';
import {
  disposeElementContent,
  renderAnimatedElementAtTime,
  renderElementContent,
  resolveBoundElement,
} from './renderElement';
import {
  createShaderRenderer,
  shaderBackingSize,
  shaderBackingSizeForLayer,
  ShaderContextLostError,
  shaderTimeSeconds,
  mountShader,
  updateShaderParameters,
  renderShaderAtTime,
  disposeShader,
} from './shaderRendering';

const element: ShaderElement = createShaderElement({
  fragmentSource:
    'void mainImage(out vec4 color, in vec2 coord) { color = vec4(coord / iResolution.xy, sin(iTime), 1.0); }',
  speed: 2,
  resolutionScale: 1,
});

const parameterElement = createShaderElement({
  speed: 2,
  fragmentSource: `#pragma ograf gain slider min(0.0) max(2.0) step(0.1)
const float gain = 0.5;
#pragma ograf count slider min(1) max(12) step(1)
const int count = 3;
#pragma ograf enabled toggle
const bool enabled = true;
#pragma ograf offset vector2 min(-4.0) max(4.0) step(0.1)
const vec2 offset = vec2(-2.0, 0.0);
#pragma ograf tint color
vec3 tint = vec3(0.1, 0.2, 0.3);
#pragma ograf overlay color
vec4 overlay = vec4(0.2, 0.3, 0.4, 0.5);
void mainImage(out vec4 color, in vec2 coord) {
  color = vec4(tint * gain + vec3(offset.x + float(count) + (enabled ? 1.0 : 0.0)) * 0.01, 1.0) + overlay * 0.1;
}`,
});

function mockCanvas(
  options: { fragmentCompiles?: boolean; links?: boolean; framebufferComplete?: boolean } = {},
) {
  let contextLost = false;
  const loseContext = vi.fn();
  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    MAX_VIEWPORT_DIMS: 0x0d3a,
    MAX_RENDERBUFFER_SIZE: 0x84e8,
    MAX_TEXTURE_SIZE: 0x0d33,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
    NONE: 0,
    LINEAR: 0x2601,
    RGBA8: 0x8058,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    FRAMEBUFFER: 0x8d40,
    READ_FRAMEBUFFER: 0x8ca8,
    DRAW_FRAMEBUFFER: 0x8ca9,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    BLEND: 0x0be2,
    DEPTH_TEST: 0x0b71,
    CULL_FACE: 0x0b44,
    SCISSOR_TEST: 0x0c11,
    DITHER: 0x0bd0,
    COLOR_BUFFER_BIT: 0x4000,
    TRIANGLES: 4,
    NO_ERROR: 0,
    createShader: vi.fn((kind: number) => ({ kind })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(
      (shader: { kind: number }) => shader.kind !== 0x8b30 || options.fragmentCompiles !== false,
    ),
    getShaderInfoLog: vi.fn(() => 'ERROR: 0:4: invalid shader'),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => options.links !== false),
    getProgramInfoLog: vi.fn(() => 'Interface mismatch'),
    deleteProgram: vi.fn(),
    createVertexArray: vi.fn(() => ({})),
    deleteVertexArray: vi.fn(),
    createTexture: vi.fn(() => ({})),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    activeTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texImage2D: vi.fn(),
    texStorage2D: vi.fn(),
    texParameteri: vi.fn(),
    createFramebuffer: vi.fn(() => ({})),
    deleteFramebuffer: vi.fn(),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    checkFramebufferStatus: vi.fn(() => (options.framebufferComplete === false ? 0x8cd6 : 0x8cd5)),
    blitFramebuffer: vi.fn(),
    getUniformLocation: vi.fn((_program: unknown, name: string) => ({ name })),
    getParameter: vi.fn((parameter: number) =>
      parameter === 0x0d3a ? new Int32Array([4096, 4096]) : 4096,
    ),
    disable: vi.fn(),
    isContextLost: vi.fn(() => contextLost),
    viewport: vi.fn(),
    useProgram: vi.fn(),
    bindVertexArray: vi.fn(),
    uniform1f: vi.fn(),
    uniform1i: vi.fn(),
    uniform2fv: vi.fn(),
    uniform3fv: vi.fn(),
    uniform4fv: vi.fn(),
    uniform3f: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    finish: vi.fn(),
    getError: vi.fn(() => 0),
    getExtension: vi.fn(() => ({ loseContext })),
  };
  const canvas = Object.assign(new EventTarget(), {
    width: 0,
    height: 0,
    dataset: {},
    style: {},
    getAttribute: () => null,
    getContext: vi.fn(() => gl),
  }) as unknown as HTMLCanvasElement;
  return {
    canvas,
    gl,
    loseContext,
    setContextLost(value: boolean) {
      contextLost = value;
    },
  };
}

function mockHost(canvas: HTMLCanvasElement): HTMLElement {
  const children: HTMLCanvasElement[] = [];
  return {
    children,
    dataset: {},
    style: {},
    clientWidth: 640,
    clientHeight: 360,
    ownerDocument: { createElement: () => canvas },
    querySelector: () => null,
    appendChild(child: HTMLCanvasElement) {
      children.push(child);
      return child;
    },
    replaceChildren() {
      children.length = 0;
    },
    append(...items: HTMLCanvasElement[]) {
      children.push(...items);
    },
    get firstElementChild() {
      return children[0] ?? null;
    },
  } as unknown as HTMLElement;
}

describe('shader backing and clock', () => {
  it('maps repeated and backwards timestamps without accumulated state', () => {
    expect([3000, 1200, 3000].map((time) => shaderTimeSeconds(time, 0.5))).toEqual([1.5, 0.6, 1.5]);
    expect(shaderTimeSeconds(1500, 0)).toBe(0);
    expect(shaderTimeSeconds(-100, 2)).toBe(0);
  });

  it('uses authored animated bounds and caps quality while preserving aspect ratio', () => {
    const size = shaderBackingSizeForLayer({
      keyframes: [
        { transform: { width: 0, height: 0 } },
        { transform: { width: 1920, height: 1080 } },
      ],
      animationTracks: { width: [{ value: 2400 }] },
      loop: { tracks: { height: [{ value: 1200 }] } },
    });
    expect(size).toEqual({ width: 2400, height: 1200 });
    expect(shaderBackingSize(size, 0.5)).toEqual({ width: 1200, height: 600 });
    expect(shaderBackingSize({ width: 7680, height: 4320 }, 1)).toEqual({
      width: 3861,
      height: 2172,
    });
    expect(shaderBackingSize({ width: 1920, height: 1080 }, 1, 1024)).toEqual({
      width: 1024,
      height: 576,
    });
  });
});

describe('WebGL shader lifecycle', () => {
  it('renders exact absolute time uniforms, preserves captures and releases GPU resources once', () => {
    const { canvas, gl, loseContext } = mockCanvas();
    const renderer = createShaderRenderer(canvas, element, { width: 1920, height: 1080 });
    renderer.render(4000);
    renderer.render(1000);
    renderer.render(4000);
    expect(gl.uniform1f.mock.calls.map((call) => call[1])).toEqual([0, 8, 2, 8]);
    expect(gl.uniform3f).toHaveBeenLastCalledWith({ name: 'iResolution' }, 1920, 1080, 1);
    expect(canvas.getContext).toHaveBeenCalledWith(
      'webgl2',
      expect.objectContaining({ preserveDrawingBuffer: true }),
    );
    expect(gl.finish).toHaveBeenCalledTimes(4);
    expect(gl.texStorage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 1, gl.RGBA8, 1920, 1080);
    expect(gl.blitFramebuffer).toHaveBeenCalledTimes(4);
    expect(gl.blitFramebuffer).toHaveBeenLastCalledWith(
      0,
      0,
      1920,
      1080,
      0,
      0,
      1920,
      1080,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    renderer.dispose();
    renderer.dispose();
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
    expect(() => renderer.render(0)).toThrow('disposed');
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
  });

  it('surfaces shader compiler diagnostics and cleans up partially created resources', () => {
    const { canvas, gl, loseContext } = mockCanvas({ fragmentCompiles: false });
    expect(() => createShaderRenderer(canvas, element, { width: 16, height: 16 })).toThrow(
      'fragment compilation failed: ERROR: 0:4',
    );
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.createProgram).not.toHaveBeenCalled();
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('surfaces program link failures and cleans up the failed program', () => {
    const { canvas, gl } = mockCanvas({ links: false });
    expect(() => createShaderRenderer(canvas, element, { width: 16, height: 16 })).toThrow(
      'linking failed: Interface mismatch',
    );
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('fails readiness during context loss and rebuilds at the requested timestamp on restoration', () => {
    const { canvas, gl, setContextLost } = mockCanvas();
    const errors = vi.fn();
    const renderer = createShaderRenderer(canvas, element, { width: 640, height: 360 }, errors);
    renderer.render(1000);
    setContextLost(true);
    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(() => renderer.checkReady()).toThrow(ShaderContextLostError);
    expect(() => renderer.render(2000)).toThrow(ShaderContextLostError);
    setContextLost(false);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
    expect(gl.createTexture).toHaveBeenCalledTimes(4);
    expect(gl.createFramebuffer).toHaveBeenCalledTimes(2);
    expect(gl.uniform1f).toHaveBeenLastCalledWith({ name: 'iTime' }, 4);
    expect(errors).toHaveBeenLastCalledWith(null);
    expect(() => renderer.checkReady()).not.toThrow();
    renderer.dispose();
  });

  it('cleans up an incomplete offscreen framebuffer and fails initialization', () => {
    const { canvas, gl, loseContext } = mockCanvas({ framebufferComplete: false });
    expect(() => createShaderRenderer(canvas, element, { width: 16, height: 16 })).toThrow(
      'RGBA8 frame target is incomplete',
    );
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('rejects missing WebGL2 and draw failures instead of reporting a ready blank frame', () => {
    const unavailable = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => createShaderRenderer(unavailable, element, { width: 16, height: 16 })).toThrow(
      'require WebGL 2',
    );
    const { canvas, gl } = mockCanvas();
    const renderer = createShaderRenderer(canvas, element, { width: 16, height: 16 });
    gl.getError.mockReturnValue(1282);
    expect(() => renderer.render(1000)).toThrow('WebGL error 1282');
    expect(() => renderer.checkReady()).toThrow('WebGL error 1282');
    renderer.dispose();
  });
});

describe('shader parameter uniforms', () => {
  it('starts object fills transparent, samples coverage alpha only and restores the mask without recompiling for updates', () => {
    const { canvas, gl, setContextLost } = mockCanvas();
    const renderer = createShaderRenderer(
      canvas,
      element,
      { width: 640, height: 360 },
      () => {},
      true,
    );
    const initialUpload = gl.texImage2D.mock.calls[0]!;
    expect(initialUpload.at(-1)).toEqual(new Uint8Array([255, 255, 255, 0]));
    expect(gl.shaderSource.mock.calls[1]![1]).toContain(
      'texture(ografCoverageSampler, gl_FragCoord.xy / iResolution.xy).a',
    );
    const coverage = { width: 640, height: 360 } as HTMLCanvasElement;
    renderer.render(2500);
    renderer.setCoverage(coverage);
    renderer.render(2500);
    expect(gl.texImage2D).toHaveBeenLastCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      coverage,
    );
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, true);
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    setContextLost(true);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    setContextLost(false);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(gl.texImage2D).toHaveBeenLastCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      coverage,
    );
    expect(gl.uniform1f).toHaveBeenLastCalledWith({ name: 'iTime' }, 5);
    renderer.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
  });

  it('compiles adapted declarations and uploads every supported GLSL parameter type', () => {
    const { canvas, gl } = mockCanvas();
    const renderer = createShaderRenderer(canvas, parameterElement, { width: 640, height: 360 });
    const fragment = gl.shaderSource.mock.calls[1]![1] as string;
    expect(fragment).toContain('uniform float gain;');
    expect(fragment).toContain('uniform vec3 tint;');
    expect(fragment).not.toContain('#pragma ograf');
    expect(gl.uniform1f).toHaveBeenCalledWith({ name: 'gain' }, 0.5);
    expect(gl.uniform1i).toHaveBeenCalledWith({ name: 'count' }, 3);
    expect(gl.uniform1i).toHaveBeenCalledWith({ name: 'enabled' }, 1);
    expect(gl.uniform2fv).toHaveBeenCalledWith({ name: 'offset' }, [-2, 0]);
    expect(gl.uniform3fv).toHaveBeenCalledWith({ name: 'tint' }, [0.1, 0.2, 0.3]);
    expect(gl.uniform4fv).toHaveBeenCalledWith({ name: 'overlay' }, [0.2, 0.3, 0.4, 0.5]);
    renderer.dispose();
  });

  it('updates uniforms and legacy speed at the current time without recompiling or replacing GPU resources', () => {
    const { canvas, gl } = mockCanvas();
    const renderer = createShaderRenderer(canvas, parameterElement, { width: 640, height: 360 });
    renderer.render(4000);
    renderer.updateParameters({
      ...parameterElement,
      speed: 3,
      parameters: {
        gain: 1.2,
        count: 7,
        enabled: false,
        offset: [1, -1],
        tint: [1, 0, 0.5],
        overlay: [0, 1, 0, 0.8],
      },
    });
    expect(gl.uniform1f).toHaveBeenCalledWith({ name: 'iTime' }, 12);
    expect(gl.uniform1f).toHaveBeenLastCalledWith({ name: 'gain' }, 1.2);
    expect(gl.uniform1i).toHaveBeenCalledWith({ name: 'count' }, 7);
    expect(gl.uniform1i).toHaveBeenLastCalledWith({ name: 'enabled' }, 0);
    expect(gl.uniform2fv).toHaveBeenLastCalledWith({ name: 'offset' }, [1, -1]);
    expect(gl.uniform3fv).toHaveBeenLastCalledWith({ name: 'tint' }, [1, 0, 0.5]);
    expect(gl.uniform4fv).toHaveBeenLastCalledWith({ name: 'overlay' }, [0, 1, 0, 0.8]);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    expect(gl.compileShader).toHaveBeenCalledTimes(2);
    expect(gl.createTexture).toHaveBeenCalledTimes(2);
    expect(canvas.getContext).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });

  it('rejects wrong parameter types atomically and allows a later valid update', () => {
    const { canvas, gl } = mockCanvas();
    const renderer = createShaderRenderer(canvas, parameterElement, { width: 16, height: 16 });
    renderer.render(2500);
    const draws = gl.drawArrays.mock.calls.length;
    expect(() =>
      renderer.updateParameters({ ...parameterElement, parameters: { gain: false } }),
    ).toThrow();
    expect(gl.drawArrays).toHaveBeenCalledTimes(draws);
    expect(() => renderer.checkReady()).not.toThrow();
    renderer.updateParameters({ ...parameterElement, parameters: { gain: 1 } });
    expect(gl.uniform1f).toHaveBeenCalledWith({ name: 'iTime' }, 5);
    expect(gl.uniform1f).toHaveBeenLastCalledWith({ name: 'gain' }, 1);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });

  it('restores the latest parameter values and elapsed time after WebGL context restoration', () => {
    const { canvas, gl, setContextLost } = mockCanvas();
    const renderer = createShaderRenderer(canvas, parameterElement, { width: 16, height: 16 });
    renderer.render(3500);
    renderer.updateParameters({ ...parameterElement, parameters: { gain: 1.5, enabled: false } });
    setContextLost(true);
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    setContextLost(false);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(gl.uniform1f).toHaveBeenCalledWith({ name: 'iTime' }, 7);
    expect(gl.uniform1f).toHaveBeenLastCalledWith({ name: 'gain' }, 1.5);
    expect(gl.uniform1i).toHaveBeenLastCalledWith({ name: 'enabled' }, 0);
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
    renderer.dispose();
  });

  it('keeps shader DOM and bound parameters through content refresh and backward data replay', () => {
    const { canvas, gl } = mockCanvas();
    const host = mockHost(canvas);
    const layer = {
      element: parameterElement,
      bindings: [{ dataKey: 'intensity', targetProperty: 'parameters.gain' }],
    } as CompiledLayer;
    const options = { shaderBackingSize: { width: 640, height: 360 } };
    renderElementContent(host, parameterElement, 0, options);
    const samples: unknown[] = [];
    for (const [time, intensity] of [
      [5000, 1.5],
      [2000, 0.2],
      [5000, 1.5],
    ]) {
      renderElementContent(host, resolveBoundElement(layer, { intensity }), 0, options);
      // The raw descriptor is intentionally passed during frame ticks; its defaults must not
      // overwrite the parameters already resolved from the current schedule/data state.
      renderAnimatedElementAtTime(host, parameterElement, time!);
      samples.push(gl.uniform1f.mock.calls.at(-1));
    }
    expect(samples).toEqual([
      [{ name: 'gain' }, 1.5],
      [{ name: 'gain' }, 0.2],
      [{ name: 'gain' }, 1.5],
    ]);
    expect(host.firstElementChild).toBe(canvas);
    expect(host.children).toHaveLength(1);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    disposeElementContent(host);
  });

  it('requests a remount only for changed program or backing identity', () => {
    const { canvas, gl } = mockCanvas();
    const host = mockHost(canvas);
    mountShader(host, parameterElement, { width: 640, height: 360 });
    renderShaderAtTime(host, 2500);
    expect(updateShaderParameters(host, { ...parameterElement, parameters: { gain: 1 } })).toBe(
      true,
    );
    expect(updateShaderParameters(host, { ...parameterElement, resolutionScale: 0.5 })).toBe(false);
    expect(
      updateShaderParameters(host, { ...parameterElement, fragmentSource: element.fragmentSource }),
    ).toBe(false);
    expect(updateShaderParameters(host, parameterElement, { width: 800, height: 360 })).toBe(false);
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    disposeShader(host);
  });
});
