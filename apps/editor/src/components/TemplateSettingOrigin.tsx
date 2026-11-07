import type { ReactNode } from 'react';
import type { TemplateSetSettingKey } from '../state/templateSetSettings';
import {
  setTemplateSettingOverride,
  useTemplateSettingOrigin,
} from '../state/templateSetInheritance';
import './TemplateSettingOrigin.css';
import { InheritanceIcon, ResetInheritanceIcon } from './InheritanceIcons';

/** Provenance is explicit metadata; equal values can still be deliberate local overrides. */
export function TemplateSettingOrigin({ setting }: { setting: TemplateSetSettingKey }) {
  const { origin, sourceName } = useTemplateSettingOrigin(setting);
  if (origin === 'local') return null;
  const source = sourceName || 'Template Set';
  return (
    <span className={`template-setting-origin ${origin}`}>
      {origin === 'inherited' ? (
        <button
          type="button"
          className="template-setting-origin-badge"
          title={`Inherited from ${source}. Edit the value, or click to keep this value as a local override.`}
          aria-label={`Inherited ${setting} from ${source}; keep current value as an override`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setTemplateSettingOverride(setting, true);
          }}
        >
          <InheritanceIcon />
        </button>
      ) : (
        <>
          <button
            type="button"
            className="template-setting-origin-reset"
            title={`Overridden. Reset ${setting} to inherit from ${source}`}
            aria-label={`Overridden ${setting}; reset to inherit from ${source}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setTemplateSettingOverride(setting, false);
            }}
          >
            <ResetInheritanceIcon />
          </button>
        </>
      )}
    </span>
  );
}

/** Fits control and origin into the existing value column without adding another row. */
export function TemplateSettingValue({
  setting,
  children,
}: {
  setting: TemplateSetSettingKey;
  children: ReactNode;
}) {
  return (
    <span className="template-setting-value">
      {children}
      <TemplateSettingOrigin setting={setting} />
    </span>
  );
}
