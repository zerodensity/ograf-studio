import { useEffect } from 'react';
import type { EditorWindow } from '../layout/EditorWindow';
import { useActiveComposition } from './projectStore';
import { acquireProjectFonts } from './projectFonts';

/** Composition fonts belong to the window, independently of docked resource panes. */
export function useProjectFonts(owner: EditorWindow = window): void {
  const assets = useActiveComposition().assets;
  useEffect(() => acquireProjectFonts(owner.document, assets).dispose, [assets, owner]);
}
