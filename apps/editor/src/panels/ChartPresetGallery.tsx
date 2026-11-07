import type { ChartPreset } from '@ograf-editor/scene-model';
import { PluginTemplateGallery } from '../components/PluginTemplateGallery';
import { filterPluginTemplates } from '../components/pluginTemplateFilter';
import './ChartEditor.css';

const PRESETS: Array<{ id: ChartPreset; label: string }> = [
  { id: 'bar', label: 'Bar' },
  { id: 'horizontal-bar', label: 'Horizontal' },
  { id: 'stacked-bar', label: 'Stacked' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
  { id: 'doughnut', label: 'Doughnut' },
  { id: 'radar', label: 'Radar' },
  { id: 'polar-area', label: 'Polar area' },
];

function PresetIcon({ preset }: { preset: ChartPreset }) {
  const bars = preset === 'bar' || preset === 'stacked-bar';
  const horizontal = preset === 'horizontal-bar';
  const circle = preset === 'pie' || preset === 'doughnut' || preset === 'polar-area';
  return (
    <svg viewBox="0 0 64 40" aria-hidden="true">
      {bars && (
        <>
          <rect x="7" y="23" width="10" height="13" />
          <rect x="25" y="14" width="10" height="22" />
          <rect x="43" y="5" width="10" height="31" />
          {preset === 'stacked-bar' && <path d="M7 27h10M25 23h10M43 18h10" />}
        </>
      )}
      {horizontal && (
        <>
          <rect x="7" y="5" width="47" height="7" />
          <rect x="7" y="17" width="35" height="7" />
          <rect x="7" y="29" width="23" height="7" />
        </>
      )}
      {(preset === 'line' || preset === 'area') && (
        <>
          {preset === 'area' && (
            <path className="chart-icon-area" d="M5 32 18 23 28 27 41 9 58 15 58 36 5 36Z" />
          )}
          <path className="chart-icon-line" d="M5 32 18 23 28 27 41 9 58 15" />
        </>
      )}
      {circle && (
        <>
          <circle cx="32" cy="20" r="16" />
          <path className="chart-icon-cut" d="M32 20V4M32 20l14 8" />
          {preset === 'doughnut' && <circle className="chart-icon-hole" cx="32" cy="20" r="7" />}
          {preset === 'polar-area' && (
            <path className="chart-icon-cut" d="M32 20 20 31M32 20l15-8" />
          )}
        </>
      )}
      {preset === 'radar' && (
        <>
          <path className="chart-icon-line" d="M32 4 53 16 45 35 19 35 11 16Z" />
          <path className="chart-icon-area" d="M32 10 45 19 40 29 24 32 18 19Z" />
        </>
      )}
    </svg>
  );
}

export function ChartPresetGallery({
  selected,
  onSelect,
  presets,
  searchQuery = '',
}: {
  selected?: ChartPreset;
  onSelect: (preset: ChartPreset) => void;
  presets?: readonly ChartPreset[];
  searchQuery?: string;
}) {
  const items = filterPluginTemplates(
    PRESETS.filter(({ id }) => !presets || presets.includes(id)).map(({ id, label }) => ({
      id,
      name: label,
      icon: <PresetIcon preset={id} />,
    })),
    searchQuery,
  );
  return (
    <>
      <PluginTemplateGallery
        className="chart-preset-gallery"
        label="Chart type gallery"
        items={items}
        selected={selected}
        onSelect={(id) => {
          const preset = items.find((entry) => entry.id === id);
          if (preset) onSelect(preset.id);
        }}
      />
      {items.length === 0 ? (
        <p className="plugin-template-empty" role="status">
          No matching templates.
        </p>
      ) : null}
    </>
  );
}
