import type { ManifestCustomAction } from './index';

/** Public, JSON-only package structure. Rendering scenes and private field values stay in main.js. */
export interface OGrafDiscoveryCatalog {
  version: 1;
  id: string;
  name: string;
  templates: Array<{ id: string; name: string }>;
  slots: Array<{
    id: string;
    name: string;
    stateIds: string[];
    requireOn: string[];
    blockWhileActive: string[];
    layoutWhen?: string[];
  }>;
  states: Array<{
    id: string;
    name: string;
    slotId: string;
    templateId: string;
    schema: Record<string, unknown>;
    defaults: Record<string, unknown>;
    actions: Array<{ id: string; name: string; schema?: Record<string, unknown> }>;
  }>;
  actions: ManifestCustomAction[];
  defaults: Record<string, unknown>;
}

/** An absent extension is unknown, not a declaration that the export is an ordinary graphic. */
export type OGrafDiscovery =
  { version: 1; kind: 'graphic' } | { version: 1; kind: 'package'; catalog: OGrafDiscoveryCatalog };
