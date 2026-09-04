import { PropertyRow } from '../components/PropertyRow';
import { useEffect, useState } from 'react';
import type { Asset, Layer } from '@ograf-editor/scene-model';
import { ImagePicker } from '../components/ImagePicker';
import { useProjectStore } from '../state/projectStore';
import { readImageSize } from '../state/imageImport';

export function ImageSourceEditor({ layer, assets }: { layer: Layer; assets: Asset[] }) {
  const [open, setOpen] = useState(false);
  const [dimensions, setDimensions] = useState<{
    src: string;
    width: number;
    height: number;
  } | null>(null);
  const src = layer.element.type === 'image' ? layer.element.src : null;
  const asset = assets.find(
    (a) => a.kind === 'image' && (src === `asset:${a.id}` || src === a.dataUri),
  );
  const preview = asset?.dataUri ?? (src?.startsWith('asset:') ? undefined : (src ?? undefined));
  useEffect(() => {
    let cancelled = false;
    if (preview)
      void readImageSize(preview)
        .then((size) => {
          if (!cancelled) setDimensions({ src: preview, ...size });
        })
        .catch(() => {
          if (!cancelled) setDimensions(null);
        });
    return () => {
      cancelled = true;
    };
  }, [preview]);
  return (
    <div>
      {preview && <img className="image-source-preview" src={preview} alt="Selected image" />}
      <div className="image-source-actions">
        <button type="button" disabled={layer.isLocked} onClick={() => setOpen(true)}>
          {src ? 'Replace image…' : 'Choose image…'}
        </button>
        <span className="image-source-name" title={asset?.name}>
          {asset?.name ?? (src ? 'Linked image' : 'No image selected')}
        </span>
      </div>
      {dimensions && dimensions.src === preview && (
        <p className="inspector-hint">
          {dimensions.width} × {dimensions.height} px · Original size
        </p>
      )}
      {layer.bindings.some((b) => b.targetProperty === 'src') && (
        <p className="inspector-hint">A data binding can override this image during playback.</p>
      )}
      <details className="image-source-advanced">
        <summary>Source URL</summary>
        <PropertyRow
          help={
            "Image URL or project resource reference used by this layer. Replacing the source keeps the layer's placement and animation."
          }
          className="inspector-row inspector-row-stacked"
        >
          <span>URL or resource reference</span>
          <input
            type="text"
            disabled={layer.isLocked}
            placeholder="https://…"
            value={src ?? ''}
            onChange={(event) =>
              useProjectStore
                .getState()
                .updateLayerElement(layer.id, { src: event.target.value || null })
            }
          />
        </PropertyRow>
      </details>
      {open && <ImagePicker replaceLayerId={layer.id} onClose={() => setOpen(false)} />}
    </div>
  );
}
