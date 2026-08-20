# OGraf Editor application

This workspace contains the React/Vite visual editor. Use the repository-root commands so the
descriptor-driven OGraf runtime is built before the application starts.

```powershell
npm run dev
```

The editor is available at `http://localhost:5173/` by default. Run the production build from the
repository root with `npm run build` and the full quality gate with `npm run verify`.

Do not run this workspace's `dev` script directly in a fresh clone: the editor imports
`packages/ograf-runtime/dist/graphic-runtime.js`, which is intentionally generated and ignored.

See the [root README](../../README.md) for file formats, import/export behavior, MCP startup, Claude
Desktop configuration, and backend-free operation.
