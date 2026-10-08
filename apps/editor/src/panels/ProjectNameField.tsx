import { useState, type KeyboardEvent } from 'react';
import { useProjectStore } from '../state/projectStore';

/**
 * The template name in the menubar. Double-click (or F2/Enter when focused) edits it in place;
 * Enter or leaving the field saves, Escape cancels. Exports and saved templates use this name.
 */
export function ProjectNameField() {
  const projectName = useProjectStore((s) => s.project.name);
  const renameProject = useProjectStore((s) => s.renameProject);
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    const startEditing = () => setDraft(projectName);
    return (
      <span
        className="menubar-project-name"
        role="button"
        tabIndex={0}
        title="Double-click to rename"
        aria-label={`Template name: ${projectName}. Press Enter to rename.`}
        onDoubleClick={startEditing}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault();
            startEditing();
          }
        }}
      >
        {projectName}
      </span>
    );
  }

  const finish = (save: boolean) => {
    if (save) renameProject(draft);
    setDraft(null);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  };

  return (
    <input
      className="menubar-project-name-input"
      aria-label="Template name"
      value={draft}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => finish(true)}
    />
  );
}
