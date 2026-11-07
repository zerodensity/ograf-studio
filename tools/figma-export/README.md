# OGraf Studio Figma Export

In the Figma desktop app, open **Plugins → Development → Import plugin from manifest** and choose `manifest.json` in this folder. Select the artwork, run **OGraf Studio Export**, and choose **Export selected layers**. In Studio open **Resources → Import Figma JSON** and select the downloaded file.

The plugin works locally without a token or network access. It embeds PNG fallbacks so unsupported Figma effects remain visible. Studio imports simple shapes and available-font text as editable layers; complex nodes become images. Nested group hierarchy and text metrics may differ, and Studio reports these cases during import. Exports are limited to 512 nodes and 64 MB.

The plugin is part of OGraf Studio and is distributed under the GNU Affero General Public License version 3. The full license accompanies the plugin ZIP.
