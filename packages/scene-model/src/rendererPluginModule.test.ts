import { describe, expect, it } from 'vitest';
import { assertRendererPluginModule } from './rendererPluginModule';

describe('self-contained renderer modules', () => {
  it('accepts a default provider without executing top-level source', async () => {
    await expect(
      assertRendererPluginModule(
        'throw new Error("not evaluated"); export default {apiVersion:1,create(){}};',
      ),
    ).resolves.toBeUndefined();
  });
  it('does not mistake comments or strings for imports', async () => {
    await expect(
      assertRendererPluginModule(
        "/* import x from 'x' */ const note=\"import('x')\"; export default {};",
      ),
    ).resolves.toBeUndefined();
  });
  it.each([
    'import x from "https://example.com/x.js"; export default x;',
    'export {default} from "./dependency.js";',
    'export default {create:()=>import("./dependency.js")};',
    'export default {create:()=>import(someVariable)};',
    'export default {url:import.meta.url};',
  ])('rejects dependency execution outside the exact pinned bundle', async (source) => {
    await expect(assertRendererPluginModule(source)).rejects.toThrow(/self-contained/);
  });
  it('requires the provider entry export', async () => {
    await expect(assertRendererPluginModule('export const other = {};')).rejects.toThrow(
      /default-export/,
    );
  });
});
