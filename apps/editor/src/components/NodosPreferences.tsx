import { useEffect, useState } from 'react';
import { useProjectSetStore } from '../state/projectSetStore';
import { useProjectStore } from '../state/projectStore';
import {
  chooseNodosTemplate,
  openTemplates,
  updateNodosPreferences,
  useNodos,
} from '../state/nodosSync';

/** A text field that applies its value when it loses focus or on Enter, not on every keystroke. */
function CommitField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };
  return (
    <label>
      {label}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
    </label>
  );
}

/** Preferences → Nodos: which templates of the open document Studio keeps as presets in a Nodos engine. */
export function NodosPreferences() {
  const enabled = useNodos((state) => state.enabled);
  const address = useNodos((state) => state.address);
  const category = useNodos((state) => state.category);
  const presets = useNodos((state) => state.presets);
  const status = useNodos((state) => state.status);
  // The template list follows the open document.
  useProjectSetStore((state) => state.projectSet);
  useProjectStore((state) => state.project.id);
  useProjectStore((state) => state.project.name);
  const templates = openTemplates();
  return (
    <>
      <h3>Nodos</h3>
      <p>
        Studio sets the chosen templates as presets in the Nodos node menu and updates them when
        your edits pause. Each update restarts the ElectroNodes made from the template. Studio
        serves the template files to Nodos, so Nodos must run on this machine.
      </p>
      <label className="template-settings-check">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => updateNodosPreferences({ enabled: event.target.checked })}
        />
        Keep Nodos up to date
      </label>
      <CommitField
        label="Nodos engine address"
        value={address}
        onCommit={(next) => updateNodosPreferences({ address: next })}
      />
      <CommitField
        label="Menu category"
        value={category}
        onCommit={(next) => updateNodosPreferences({ category: next })}
      />
      <h3>Templates</h3>
      {templates.map((template) => (
        <label key={template.id} className="template-settings-check">
          <input
            type="checkbox"
            checked={!!presets[template.id]}
            onChange={(event) => chooseNodosTemplate(template, event.target.checked)}
          />
          {template.name}
          <small>
            {presets[template.id]
              ? enabled
                ? (status[template.id] ?? presets[template.id])
                : presets[template.id]
              : ''}
          </small>
        </label>
      ))}
      <p>
        A template left out keeps its preset in Nodos. Choosing it again keeps the same node class.
      </p>
    </>
  );
}
