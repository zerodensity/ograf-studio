import JSZip from 'jszip';
import manifest from '../../../../tools/figma-export/manifest.json?raw';
import code from '../../../../tools/figma-export/code.js?raw';
import ui from '../../../../tools/figma-export/ui.html?raw';
import guide from '../../../../tools/figma-export/README.md?raw';
import license from '../../../../LICENSE?raw';

/** Packaged with Studio, including standalone builds; nothing is fetched from a server. */
export async function buildFigmaPluginPackage(): Promise<Blob> {
  const archive = new JSZip();
  archive.file('manifest.json', manifest);
  archive.file('code.js', code);
  archive.file('ui.html', ui);
  archive.file('README.md', guide);
  archive.file('LICENSE.txt', license);
  return archive.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
