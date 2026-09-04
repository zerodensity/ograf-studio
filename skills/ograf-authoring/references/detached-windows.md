# Detached Studio panes

Tool windows share the original editor's project, selection, undo, local form drafts and MCP
connection. Use the pane header's Open in new window button; browser popup creation requires a
user gesture. Closing or Dock back restores the original dock location. The Window menu focuses
an already-detached pane. Preview's Picture only view hides controls while keeping playback alive.

Keep the main editor open. Do not open another full editor to create a multi-monitor workspace:
the newer editor takes over the MCP socket. Main reload/close closes its child windows; panes
return to their saved dock positions on reload. Browser-dependent capture/certification still
belongs to the main editor: bring it into view and require `editor.certificationReady` as usual.

Embedded browser hosts may turn detached-window requests into tabs. Use a regular Edge/Chrome
window for OS-level monitor placement. A popup-blocked message leaves the pane safely docked.
The normal revision-checked tools continue to operate on session `editor`; detaching is local UI
state, not a scene operation or a new authoring session.
