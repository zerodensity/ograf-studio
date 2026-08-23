import { createAsset, type Asset } from '@ograf-editor/scene-model';

export interface SvgBundleImportResult {
  svgAsset: Asset;
  fontAssets: Asset[];
  warnings: string[];
}

interface ImportFile {
  name: string;
  type: string;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

const FONT_MIME_BY_EXTENSION: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

function extension(name: string): string {
  return name.split('.').at(-1)?.toLowerCase() ?? '';
}

function basename(reference: string): string {
  const clean = reference.split(/[?#]/)[0] ?? reference;
  return decodeURIComponent(clean.replaceAll('\\', '/').split('/').at(-1) ?? clean).toLowerCase();
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x6000;
  let result = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    let binary = '';
    for (const byte of chunk) binary += String.fromCharCode(byte);
    result += btoa(binary);
  }
  return result;
}

async function dataUri(file: ImportFile, fallbackMime?: string): Promise<string> {
  const mimeType = file.type || fallbackMime || 'application/octet-stream';
  return `data:${mimeType};base64,${bytesToBase64(new Uint8Array(await file.arrayBuffer()))}`;
}

function isExternalReference(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(trimmed) && !/^(?:data:|https?:|blob:|#)/i.test(trimmed);
}

function fontFamilyForFile(css: string, fileName: string): string {
  const target = fileName.toLowerCase();
  for (const match of css.matchAll(/@font-face\s*\{([\s\S]*?)\}/gi)) {
    const block = match[1] ?? '';
    const urls = [...block.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((item) =>
      basename(item[2] ?? ''),
    );
    if (!urls.includes(target)) continue;
    const family = /font-family\s*:\s*(['"]?)(.*?)\1\s*;/i.exec(block)?.[2]?.trim();
    if (family) return family;
  }
  return fileName.replace(/\.[^.]+$/, '');
}

async function replaceRelativeReferences(
  source: string,
  filesByName: Map<string, ImportFile>,
  warnings: Set<string>,
): Promise<string> {
  const references = new Set<string>();
  for (const match of source.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (isExternalReference(match[2] ?? '')) references.add(match[2]!);
  }
  for (const match of source.matchAll(/(?:href|xlink:href)\s*=\s*(['"])(.*?)\1/gi)) {
    if (isExternalReference(match[2] ?? '')) references.add(match[2]!);
  }
  let resolved = source;
  for (const reference of references) {
    const file = filesByName.get(basename(reference));
    if (!file) {
      warnings.add(`Unresolved SVG/CSS companion resource: ${reference}`);
      continue;
    }
    const uri = await dataUri(file, FONT_MIME_BY_EXTENSION[extension(file.name)]);
    resolved = resolved.replaceAll(reference, uri);
  }
  return resolved;
}

/** Builds one portable SVG image asset by embedding selected CSS, images, and font files. */
export async function buildSvgBundle(files: ImportFile[]): Promise<SvgBundleImportResult> {
  const svgFiles = files.filter((file) => extension(file.name) === 'svg');
  if (svgFiles.length !== 1) throw new Error('Select exactly one SVG plus its companion files.');
  const svgFile = svgFiles[0]!;
  const cssFiles = files.filter(
    (file) => extension(file.name) === 'css' || file.type === 'text/css',
  );
  const filesByName = new Map(files.map((file) => [file.name.toLowerCase(), file]));
  const warnings = new Set<string>();
  let css = (await Promise.all(cssFiles.map((file) => file.text()))).join('\n');
  css = css.replace(/@import\s+(?:url\()?\s*(['"]?)[^;'")]+\1\s*\)?\s*;/gi, '');
  const sourceCss = css;
  css = await replaceRelativeReferences(css, filesByName, warnings);

  let svg = await svgFile.text();
  svg = svg.replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, '');
  svg = await replaceRelativeReferences(svg, filesByName, warnings);
  if (css.trim()) {
    const safeCss = css.replaceAll(']]>', ']]]]><![CDATA[>');
    svg = svg.replace(
      /<svg\b([^>]*)>/i,
      (opening) => `${opening}<defs><style type="text/css"><![CDATA[${safeCss}]]></style></defs>`,
    );
  }

  const svgDataUri = `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
  const fontFiles = files.filter((file) => extension(file.name) in FONT_MIME_BY_EXTENSION);
  const fontAssets = await Promise.all(
    fontFiles.map(async (file) =>
      createAsset({
        name: file.name,
        kind: 'font',
        mimeType: FONT_MIME_BY_EXTENSION[extension(file.name)]!,
        dataUri: await dataUri(file, FONT_MIME_BY_EXTENSION[extension(file.name)]),
        fontFamily: fontFamilyForFile(sourceCss, file.name),
      }),
    ),
  );
  return {
    svgAsset: createAsset({
      name: svgFile.name,
      kind: 'image',
      mimeType: 'image/svg+xml',
      dataUri: svgDataUri,
    }),
    fontAssets,
    warnings: [...warnings],
  };
}
