# OGraf Studio — Next release

## Agent-tool architecture and context

- Extracted all canonical tool schemas and handlers into transport-neutral `packages/agent-tools`
  behind injected workspace and editor-bridge ports. `apps/mcp-server` now only renders shared records
  through the MCP SDK; no transport dependency enters the new package.
- Consolidated committed apply, browser-free dry-run, rendered preview, and human Accept/Reject
  proposal behavior into one mode-based `ograf_apply_operations` tool. Registered tools dropped from
  28 to 26 and the generated MCP contract from 334,854 to 133,868 bytes.
- Added a 150,000-byte generated-contract budget and a drift guard that rejects reintroduction of the
  removed preview/proposal tool names.

## Text outlines

- Added document-v20 broadcast text outlines with editable stroke colour and independently animated
  non-negative stroke width across the Inspector, Brand Kits, MCP authoring, lifecycle/local-loop
  sampling, SVG diagnostics, browser capture, and certified runtime output.
- Text outlines use `paint-order: stroke fill`, keeping the outline behind the glyph face. Existing
  documents migrate to transparent/zero stroke without visual changes, including reusable-component
  snapshots and older imported editor descriptors.

This file is the unreleased changelog. Add completed, verified changes here before assigning the
next version and tag.
