import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

// Workspace packages are aliased straight to source so tests never depend on a build step. DOM
// module/lifecycle certification remains covered by the live browser gate; the local MCP transport
// is exercised here over a real ephemeral HTTP listener.
export default defineConfig({
  resolve: {
    alias: {
      '@ograf-editor/scene-model': pkg('scene-model'),
      '@ograf-editor/ograf-types': pkg('ograf-types'),
      '@ograf-editor/codegen': pkg('codegen'),
      '@ograf-editor/validation': pkg('validation'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
