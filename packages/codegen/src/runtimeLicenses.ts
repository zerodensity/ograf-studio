import { STUDIO_RUNTIME_LICENSE_TEXT } from './studioRuntimeLicense.generated';

/** One archive-relative copy accompanies the Studio runtime in every exported graphic. */
export const STUDIO_RUNTIME_LICENSE_PATH = 'licenses/OGRAF-STUDIO-AGPL-3.0.txt';
export { STUDIO_RUNTIME_LICENSE_TEXT };
export const STUDIO_RUNTIME_NOTICE = `/* OGraf Studio playback runtime: AGPL-3.0-only.
 * License text: ${STUDIO_RUNTIME_LICENSE_PATH}
 * User-created graphic content and third-party assets may have separate licenses.
 */`;

// Exact upstream MIT notices for dependencies embedded in every graphic runtime bundle.
export const NOBLE_HASHES_LICENSE =
  'The MIT License (MIT)\n\nCopyright (c) 2022 Paul Miller (https://paulmillr.com)\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the “Software”), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in\nall copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN\nTHE SOFTWARE.';
export const ES_MODULE_LEXER_LICENSE =
  'MIT License\n-----------\n\nCopyright (C) 2018-2022 Guy Bedford\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n';

export const RUNTIME_DEPENDENCY_LICENSES: Readonly<Record<string, string>> = Object.freeze({
  'licenses/noble-hashes-LICENSE.txt': NOBLE_HASHES_LICENSE,
  'licenses/es-module-lexer-LICENSE.txt': ES_MODULE_LEXER_LICENSE,
});

export const RUNTIME_PACKAGE_LICENSES: Readonly<Record<string, string>> = Object.freeze({
  [STUDIO_RUNTIME_LICENSE_PATH]: STUDIO_RUNTIME_LICENSE_TEXT,
  ...RUNTIME_DEPENDENCY_LICENSES,
});
