import JSZip from 'jszip';
import {
  assertRendererPluginModule,
  createRendererPluginSnapshot,
  MAX_RENDERER_PLUGIN_LICENSE_BYTES,
  MAX_RENDERER_PLUGIN_SOURCE_BYTES,
  validateRendererPluginManifest,
  validateRendererPluginSnapshot,
  createAnimationPresetPluginSnapshot,
  createShaderPackPluginSnapshot,
  isShaderPackPluginSnapshot,
  isRendererPluginSnapshot,
  validateStudioPluginSnapshot,
  type AnimationPresetPluginManifest,
  type AnimationPluginPreset,
  type ShaderPackPluginManifest,
  type ShaderPackPreset,
  type StudioPluginSnapshot,
  type RendererPluginManifest,
  type RendererPluginSnapshot,
} from '@ograf-editor/scene-model';

export const MAX_RENDERER_PLUGIN_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const CHART_FILES = ['manifest.json', 'renderer.js', 'LICENSE.txt'];
const ANIMATION_FILES = ['manifest.json', 'presets.json', 'LICENSE.txt'];
const SHADER_FILES = ['manifest.json', 'shaders.json', 'LICENSE.txt'];

/** Reject non-OGS plugin bundles and oversized picker inputs before reading file bytes. */
export async function parseStudioPluginFile(
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
): Promise<StudioPluginSnapshot> {
  if (!/\.ogsplugin\.zip$/i.test(file.name))
    throw new Error('Choose an OGS plugin bundle with the .ogsplugin.zip extension.');
  if (file.size > MAX_RENDERER_PLUGIN_BUNDLE_BYTES) throw new Error('Plugin bundle exceeds 8 MiB.');
  return parseStudioPluginBundle(await file.arrayBuffer());
}
export async function parseRendererPluginFile(
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
): Promise<RendererPluginSnapshot> {
  const snapshot = await parseStudioPluginFile(file);
  if (!isRendererPluginSnapshot(snapshot))
    throw new Error('Choose a chart renderer plugin bundle.');
  return snapshot;
}

// JSZip 3 implements this bounded decode stream, but omits it from JSZipObject's declarations.
interface PluginDecodeStream {
  on(event: 'data', handler: (chunk: Uint8Array) => void): PluginDecodeStream;
  on(event: 'error', handler: (cause: unknown) => void): PluginDecodeStream;
  on(event: 'end', handler: () => void): PluginDecodeStream;
  pause(): PluginDecodeStream;
  resume(): PluginDecodeStream;
}

/** Check declared inflate sizes before JSZip allocates decoded contents. ZIP64/multidisk are not v1. */
function preflightArchive(data: ArrayBuffer): string[] {
  if (data.byteLength > MAX_RENDERER_PLUGIN_BUNDLE_BYTES)
    throw new Error('Plugin bundle exceeds 8 MiB.');
  if (data.byteLength < 22) throw new Error('Plugin bundle is not a ZIP archive.');
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (
      view.getUint32(index, true) === 0x06054b50 &&
      index + 22 + view.getUint16(index + 20, true) === bytes.length
    ) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('Plugin bundle ZIP directory is invalid.');
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let position = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    count > 16 ||
    count === 0 ||
    size === 0xffffffff ||
    position === 0xffffffff ||
    position + size > end
  )
    throw new Error(
      'Only single-disk, non-ZIP64 plugin bundles with at most 16 entries are supported.',
    );
  const directoryEnd = position + size;
  const names: string[] = [];
  let total = 0;
  for (let entry = 0; entry < count; entry++) {
    if (position + 46 > directoryEnd || view.getUint32(position, true) !== 0x02014b50)
      throw new Error('Plugin ZIP directory entry is invalid.');
    const flags = view.getUint16(position + 8, true);
    const compression = view.getUint16(position + 10, true);
    const decodedSize = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const next = position + 46 + nameLength + extraLength + commentLength;
    const permissions = view.getUint32(position + 38, true) >>> 16;
    if (
      flags & 1 ||
      ![0, 8].includes(compression) ||
      view.getUint16(position + 34, true) ||
      next > directoryEnd ||
      decodedSize === 0xffffffff ||
      decodedSize > MAX_RENDERER_PLUGIN_SOURCE_BYTES ||
      (permissions & 0xf000) === 0xa000
    )
      throw new Error(
        'Encrypted, linked, oversized or unsupported plugin ZIP entries are not allowed.',
      );
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(position + 46, position + 46 + nameLength),
    );
    if (
      !name ||
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      /^[a-z]:/i.test(name) ||
      name.split('/').includes('..') ||
      names.includes(name)
    )
      throw new Error('Plugin ZIP paths must be unique and relative, without traversal.');
    names.push(name);
    total += decodedSize;
    if (
      total >
      MAX_RENDERER_PLUGIN_SOURCE_BYTES + MAX_RENDERER_PLUGIN_LICENSE_BYTES + MAX_MANIFEST_BYTES
    )
      throw new Error('Plugin bundle decoded contents exceed their size budget.');
    position = next;
  }
  if (position !== directoryEnd)
    throw new Error('Plugin ZIP directory size does not match its entries.');
  return names;
}

/** Parsing never evaluates provider code. Execution requires a separate explicit trust action. */
export async function parseStudioPluginBundle(data: ArrayBuffer): Promise<StudioPluginSnapshot> {
  const names = preflightArchive(data);
  const manifests = names.filter(
    (name) => name === 'manifest.json' || name.endsWith('/manifest.json'),
  );
  if (manifests.length !== 1)
    throw new Error('Plugin bundle must contain exactly one manifest.json.');
  const prefix = manifests[0]!.slice(0, -'manifest.json'.length);
  if (prefix && prefix.slice(0, -1).includes('/'))
    throw new Error('Plugin files must be at the ZIP root or in one enclosing directory.');
  const zip = await JSZip.loadAsync(data);
  const read = async (name: string, limit: number) => {
    const entry = zip.file(prefix + name);
    if (!entry) throw new Error(`Plugin bundle is missing ${name}.`);
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const streamedEntry = entry as typeof entry & {
        internalStream(type: 'uint8array'): PluginDecodeStream;
      };
      const stream = streamedEntry.internalStream('uint8array');
      const chunks: Uint8Array[] = [];
      let size = 0;
      let settled = false;
      stream.on('data', (chunk: Uint8Array) => {
        if (settled) return;
        size += chunk.length;
        if (size > limit) {
          settled = true;
          stream.pause();
          reject(new Error(`Plugin ${name} exceeds its size limit.`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', (cause: unknown) => {
        if (!settled) {
          settled = true;
          reject(cause);
        }
      });
      stream.on('end', () => {
        if (settled) return;
        settled = true;
        const combined = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(combined);
      });
      stream.resume();
    });
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  };
  let manifest: unknown;
  try {
    manifest = JSON.parse(await read('manifest.json', MAX_MANIFEST_BYTES));
  } catch (cause) {
    throw new Error(
      `Plugin manifest could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const kind =
    manifest && typeof manifest === 'object' ? (manifest as { kind?: unknown }).kind : undefined;
  if (kind !== 'chart' && kind !== 'animation-presets' && kind !== 'shader-pack')
    throw new Error('Unsupported Studio plugin kind.');
  const files = names.filter((name) => !name.endsWith('/'));
  const expected =
    kind === 'chart' ? CHART_FILES : kind === 'shader-pack' ? SHADER_FILES : ANIMATION_FILES;
  if (files.length !== 3 || files.some((name) => !expected.some((file) => name === prefix + file)))
    throw new Error(`A ${kind} bundle contains only ${expected.join(', ')}.`);
  const licenseText = await read('LICENSE.txt', MAX_RENDERER_PLUGIN_LICENSE_BYTES);
  if (kind === 'shader-pack') {
    let shaders: unknown;
    try {
      shaders = JSON.parse(await read('shaders.json', MAX_RENDERER_PLUGIN_SOURCE_BYTES));
    } catch (cause) {
      throw new Error(
        `Plugin shaders could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return createShaderPackPluginSnapshot({
      manifest: manifest as ShaderPackPluginManifest,
      shaders: shaders as ShaderPackPreset[],
      licenseText,
    });
  }
  if (kind === 'animation-presets') {
    let presets: unknown;
    try {
      presets = JSON.parse(await read('presets.json', MAX_RENDERER_PLUGIN_SOURCE_BYTES));
    } catch (cause) {
      throw new Error(
        `Plugin presets could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    return createAnimationPresetPluginSnapshot({
      manifest: manifest as AnimationPresetPluginManifest,
      presets: presets as AnimationPluginPreset[],
      licenseText,
    });
  }
  const errors = validateRendererPluginManifest(manifest);
  if (errors.length) throw new Error(errors.join(' '));
  const source = await read('renderer.js', MAX_RENDERER_PLUGIN_SOURCE_BYTES);
  await assertRendererPluginModule(source);
  return createRendererPluginSnapshot({
    manifest: manifest as RendererPluginManifest,
    source,
    licenseText,
  });
}

export async function parseRendererPluginBundle(
  data: ArrayBuffer,
): Promise<RendererPluginSnapshot> {
  const snapshot = await parseStudioPluginBundle(data);
  if (!isRendererPluginSnapshot(snapshot))
    throw new Error('Choose a chart renderer plugin bundle.');
  return snapshot;
}

export async function rendererPluginBundleBlob(snapshot: RendererPluginSnapshot): Promise<Blob> {
  const errors = validateRendererPluginSnapshot(snapshot);
  if (errors.length) throw new Error(errors.join(' '));
  await assertRendererPluginModule(snapshot.source);
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(snapshot.manifest, null, 2));
  zip.file('renderer.js', snapshot.source);
  zip.file('LICENSE.txt', snapshot.licenseText);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export async function studioPluginBundleBlob(snapshot: StudioPluginSnapshot): Promise<Blob> {
  if (isRendererPluginSnapshot(snapshot)) return rendererPluginBundleBlob(snapshot);
  const errors = validateStudioPluginSnapshot(snapshot);
  if (errors.length) throw new Error(errors.join(' '));
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(snapshot.manifest, null, 2));
  // Keep the emitted file inside the same byte budget validated for the canonical definitions.
  if (isShaderPackPluginSnapshot(snapshot))
    zip.file('shaders.json', JSON.stringify(snapshot.shaders));
  else zip.file('presets.json', JSON.stringify(snapshot.presets));
  zip.file('LICENSE.txt', snapshot.licenseText);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
