# ADR-003: Revisioned Agent Authoring over MCP

Status: Accepted  
Date: 2026-08-16

## Context

AI agents need to inspect and author the same editable OGraf document shown in the browser. Direct
DOM automation, raw JSON rewriting, and a second server-only export implementation would each
create a competing source of truth and could bypass the project's mandatory OGraf compatibility
gate. Human and agent edits may also overlap, so silent last-write-wins behavior is unsafe.

## Decision

Extract framework-neutral authoring operations into `packages/authoring-core`. Every committed
agent mutation is an atomic batch against an explicit expected revision, produces a compact change
summary, and is one agent undo unit. Stale revisions fail and require a deliberate re-read/rebase.
Dry runs evaluate the complete batch without changing revision or editor state.

Expose that core through a localhost-only Streamable HTTP MCP server. The server owns authoring
sessions and a WebSocket bridge mirrors the `editor` session into the live browser. Direct browser
edits advance the server revision and invalidate server-side agent undo history; the browser keeps
its existing history for human edits. The menubar reports connection and agent activity.

Move exact artifact construction into shared codegen. Certification sends those exact artifacts to
the live browser, which runs the existing project/schema/package/module/lifecycle gate. MCP save and
export fail closed without a connected browser or a completely successful result. File tools are
restricted to the configured workspace and require explicit confirmation and opt-in overwrite.

Ship `skills/ograf-authoring` as the agent workflow contract only after the MCP schemas are defined.

## Consequences

- UI and agents use the same scene and timeline semantics without coupling the core to React.
- Concurrent changes cannot silently overwrite one another.
- Agent transactions are observable, reversible, testable, and visually inspectable.
- MCP cannot produce an uncertified `.ogeproj` or `.ograf.zip` through its output tools.
- Certification/save/export require the editor browser to remain open; headless browser
  certification can be added later without weakening the gate.
- Localhost binding, DNS-rebinding protection, workspace path confinement, and explicit destructive
  annotations reduce the exposed authority, but remote multi-user hosting would require real
  authentication and authorization before it is allowed.
