import type { SharedGraphicInput } from '@ograf-editor/ograf-types';

export interface SharedInputGraphic {
  setSharedInputHandler?(handler: ((input: SharedGraphicInput) => void) | null): void;
  applySharedInput?(input: SharedGraphicInput): boolean;
}

export interface SharedInputEntry {
  publicationId: string;
  sequence: number;
  syncVersion: number;
  clientId: string;
  input: SharedGraphicInput;
}

export interface SharedInputSession {
  publicationId: string | null;
  syncVersion: number;
  syncViewers: boolean;
  canSend: boolean;
  graphic: SharedInputGraphic | null;
}

export function createSharedInput(options: {
  url: string;
  onError?(error: unknown): void;
  onPointer?(position: { x: number; y: number } | null): void;
  fetchImpl?: typeof fetch;
}): {
  setSession(session: SharedInputSession | null): void;
  receive(entry: SharedInputEntry): void;
  dispose(): void;
};
