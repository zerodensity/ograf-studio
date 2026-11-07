import { useState } from 'react';
import { captureAgentPng } from '../state/agentCapture';
import { useProjectStore } from '../state/projectStore';
import { useProjectSetStore } from '../state/projectSetStore';
import { useTestDataStore } from '../state/testDataStore';
import { boardCapturePlan } from './boardCapturePlan';
import { Panel } from './Panel';
import './BoardPanel.css';

interface BoardTile {
  template: string;
  label: string;
  image: string;
}

async function loadTile(data: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A board image could not be decoded.'));
    image.src = data;
  });
}

async function exportBoard(tiles: BoardTile[]) {
  const tileWidth = 320,
    tileHeight = 180,
    labelHeight = 28,
    gap = 10,
    columns = 3;
  const rows = Math.ceil(tiles.length / columns);
  const canvas = document.createElement('canvas');
  if (rows * (tileHeight + labelHeight + gap) + gap > 32767)
    throw new Error(
      'This board is too tall for one PNG. Export fewer templates or rundown rows at a time.',
    );
  canvas.width = columns * tileWidth + (columns + 1) * gap;
  canvas.height = rows * (tileHeight + labelHeight) + (rows + 1) * gap;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas export is unavailable.');
  context.fillStyle = '#15191e';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, tile] of tiles.entries()) {
    const x = gap + (index % columns) * (tileWidth + gap);
    const y = gap + Math.floor(index / columns) * (tileHeight + labelHeight + gap);
    const image = await loadTile(tile.image);
    const scale = Math.min(tileWidth / image.width, tileHeight / image.height);
    context.fillStyle = '#000';
    context.fillRect(x, y, tileWidth, tileHeight);
    context.drawImage(
      image,
      x + (tileWidth - image.width * scale) / 2,
      y + (tileHeight - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    context.font = '12px sans-serif';
    context.textBaseline = 'middle';
    context.fillStyle = '#eef5fa';
    context.fillText(
      `${tile.template} · ${tile.label}`,
      x + 5,
      y + tileHeight + labelHeight / 2,
      tileWidth - 10,
    );
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the board PNG.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ograf-board.png';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function BoardPanel() {
  const project = useProjectStore((state) => state.project);
  const activeCompositionId = useProjectStore((state) => state.activeCompositionId);
  const projectSet = useProjectSetStore((state) => state.projectSet);
  const activeTemplateId = useProjectSetStore((state) => state.activeTemplateId);
  const previewValues = useTestDataStore((state) => state.values);
  const [tiles, setTiles] = useState<BoardTile[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const generate = async () => {
    setBusy(true);
    setTiles([]);
    setStatus('Capturing moments…');
    try {
      const output: BoardTile[] = [];
      const moments = boardCapturePlan(
        project,
        activeCompositionId,
        projectSet,
        activeTemplateId,
        previewValues,
      );
      for (const moment of moments) {
        const image = await captureAgentPng({
          target: 'composition',
          project: moment.project,
          compositionId: moment.compositionId,
          frame: moment.frame,
          maxDimension: 640,
          matte: '#000000',
          ...(moment.dataOverrides ? { dataOverrides: moment.dataOverrides } : {}),
        });
        output.push({
          template: moment.template,
          label: moment.label,
          image: `data:image/png;base64,${image.data}`,
        });
        setStatus(`Captured ${output.length} moments…`);
      }
      if (
        useProjectStore.getState().project !== project ||
        useProjectSetStore.getState().projectSet !== projectSet ||
        useProjectSetStore.getState().activeTemplateId !== activeTemplateId ||
        useTestDataStore.getState().values !== previewValues
      )
        throw new Error(
          'The project or preview data changed during capture. Capture the board again.',
        );
      setTiles(output);
      setStatus(`Captured ${output.length} moments.`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Board">
      <div className="board-panel">
        <p>
          Capture lifecycle moments for this template or every template in the set. Update views use
          saved test-data rows, or the active preview data when there are no saved rows.
        </p>
        <div className="board-actions">
          <button type="button" disabled={busy} onClick={() => void generate()}>
            Capture board
          </button>
          <button
            type="button"
            disabled={busy || !tiles.length}
            onClick={() =>
              void exportBoard(tiles).catch((error: unknown) =>
                setStatus(error instanceof Error ? error.message : String(error)),
              )
            }
          >
            Export PNG
          </button>
        </div>
        <p role="status">{status}</p>
        <div className="board-grid">
          {tiles.map((tile, index) => (
            <figure key={`${tile.template}:${index}`}>
              <img src={tile.image} alt={`${tile.template} · ${tile.label}`} />
              <figcaption>
                {tile.template} · {tile.label}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </Panel>
  );
}
