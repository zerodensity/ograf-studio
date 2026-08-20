# Handover — 2026-08-16 — Agent-first P0 frame strips

## Outcome

Added `ograf_render_strip`, a read-only browser-rendered PNG contact sheet that lets MCP agents
inspect actual animation motion without reproducing the editor interpolation engine.

## Contract

- Accepts an optional composition and up to 12 explicit frames.
- When frames are omitted, samples Start/Step/End lifecycle frames and transition midpoints.
- Supports 1–12 columns, per-tile long-edge scaling, optional burned-in frame labels, and the same
  transparent/checker/solid mattes as composition capture.
- Returns tile/composition dimensions, resolved fonts, a random five-minute localhost URL, and an
  optional inline `image/png` block.
- Requires the live browser editor, fails closed when disconnected, and never changes revision.
- Reuses the P0 capture rasterizer and is not accepted as certification, package export, or video.

## Live verification

- Built a 640×360 two-layer composition exclusively through MCP authoring operations.
- Deliberately omitted the panel's hold key. The 0/4/8/12/15/18/21/24 strip visibly showed the
  panel fully entered at frame 12, already leaving at frame 15, and nearly gone at frame 21.
- Revision remained 3 before and after explicit and default-frame strip reads.
- Omitted frames resolved to `0, 6, 12, 18, 24` for the two 12-frame lifecycle transitions.
- A real MCP SDK client received an inline `image/png` block; the primary URL returned a valid PNG.

## Main files

- `apps/editor/src/state/agentCapture.ts`
- `apps/editor/src/state/agentBridge.ts`
- `apps/mcp-server/src/editorBridge.ts`
- `apps/mcp-server/src/mcpServer.ts`
- `apps/mcp-server/src/mcpServer.test.ts`

## Next work

Proceed to P1 agent discovery: publish complete element schemas, binding targets, and empirically
verified paint-order/easing/origin semantics in `ograf_get_capabilities`, then add filtered project
reads without changing the existing default response.
