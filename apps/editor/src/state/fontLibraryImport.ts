import { prepareAssetImport } from './assetImport';
import type { LibraryFont } from './fontLibraryCatalog';
/** Load only a bundled local resource; embed its exact bytes and license in the editable project. */
export async function prepareLibraryFontAsset(
  font: LibraryFont,
  fetchResource: typeof fetch = fetch,
) {
  const response = await fetchResource(font.url);
  if (!response.ok) throw new Error(`Could not read bundled ${font.family} font.`);
  const data = await response.arrayBuffer();
  const file = new File([data], font.filename, { type: 'font/ttf' });
  const { asset } = await prepareAssetImport(file);
  Object.assign(asset, {
    name: `${font.family} Variable`,
    fontFamily: font.family,
    fontWeight: font.weight,
    fontStyle: 'normal' as const,
    licenseName: 'SIL Open Font License 1.1',
    licenseUrl: font.licenseUrl,
    licenseText: font.licenseText,
  });
  return asset;
}
