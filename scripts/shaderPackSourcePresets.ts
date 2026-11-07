import { createShaderPaint, inspectShaderElement } from '../packages/scene-model/src/shader';
import type { ShaderPackPreset } from '../packages/scene-model/src/types';

/** Infer layer-input effects from the shader contract, not a particular numbered filename. */
export function numberedShaderPackPreset(
  file: string,
  fragmentSource: string,
  license: string,
): ShaderPackPreset {
  if (!/^\d{2}-[a-z0-9-]+\.glsl$/.test(file))
    throw new Error(`Invalid numbered shader filename: ${file}.`);
  const lines = fragmentSource.split(/\r?\n/);
  const name = lines[0]!
    .replace(/^\/\/\s*/, '')
    .split(' - ')[0]!
    .trim();
  const header = lines
    .filter((line) => line.startsWith('//'))
    .map((line) => line.replace(/^\/\/\s*/, ''));
  const technique = header.findIndex(
    (line) => line.startsWith('Technique:') || line.startsWith('Inspired by'),
  );
  const description = header
    .slice(1, technique < 0 ? 9 : technique)
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);
  const paint = createShaderPaint({ name, fragmentSource, speed: 1, resolutionScale: 1 });
  const fill = inspectShaderElement(paint);
  const effect = inspectShaderElement(paint, { channel0Provided: true });
  if (!fill.valid && !effect.valid) throw new Error(`${file}: ${effect.errors.join('\n')}`);
  return {
    id: file.replace(/^\d{2}-/, '').replace(/\.glsl$/, ''),
    name,
    ...(description ? { description } : {}),
    targets: fill.valid ? ['fill', 'outline'] : ['effect'],
    paint,
    license,
  };
}
