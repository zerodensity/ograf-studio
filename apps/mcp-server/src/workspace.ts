import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthoringSession } from '@ograf-editor/authoring-core';
import {
  createProject,
  isProjectSourcePath,
  migrateProject,
  type Project,
} from '@ograf-editor/scene-model';

export class AuthoringWorkspace {
  readonly root: string;
  readonly sessions = new Map<string, AuthoringSession>();

  constructor(
    root = process.env.OGRAF_WORKSPACE_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url)),
  ) {
    this.root = resolve(root);
    this.sessions.set('editor', new AuthoringSession(createProject(), 'editor'));
  }

  list(): Array<{ sessionId: string; revision: number; projectName: string; valid: boolean }> {
    return [...this.sessions.values()].map((session) => {
      const snapshot = session.snapshot();
      return {
        sessionId: session.id,
        revision: session.revision,
        projectName: snapshot.project.name,
        valid: snapshot.validation.valid,
      };
    });
  }

  get(sessionId = 'editor'): AuthoringSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown authoring session "${sessionId}".`);
    return session;
  }

  create(sessionId: string, project: Project = createProject()): AuthoringSession {
    if (!/^[a-zA-Z0-9._-]{1,80}$/.test(sessionId)) {
      throw new Error('sessionId may contain only letters, numbers, dot, underscore, and hyphen.');
    }
    if (this.sessions.has(sessionId)) throw new Error(`Session "${sessionId}" already exists.`);
    const session = new AuthoringSession(project, sessionId);
    this.sessions.set(sessionId, session);
    return session;
  }

  delete(sessionId: string): void {
    if (sessionId === 'editor') throw new Error('The live editor session cannot be deleted.');
    if (!this.sessions.delete(sessionId)) {
      throw new Error(`Unknown authoring session "${sessionId}".`);
    }
  }

  setEditorProject(project: Project, reason?: string): AuthoringSession {
    const session = this.get('editor');
    session.replaceExternal(project, reason);
    return session;
  }

  initializeEditorProject(project: Project): AuthoringSession {
    const session = this.get('editor');
    session.initializeExternal(project);
    return session;
  }

  resolveAllowedPath(input: string): string {
    if (!input.trim()) throw new Error('A non-empty path is required.');
    const target = resolve(this.root, input);
    const rel = relative(this.root, target);
    if (rel === '' || rel === '.')
      throw new Error('The workspace root itself is not a file target.');
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path must remain inside the configured workspace root: ${this.root}`);
    }
    return target;
  }

  async open(sessionId: string, inputPath: string): Promise<AuthoringSession> {
    if (!isProjectSourcePath(inputPath)) {
      throw new Error('Editable project input must use .ogs or a legacy .ogeproj extension.');
    }
    const project = migrateProject(
      JSON.parse(await readFile(this.resolveAllowedPath(inputPath), 'utf8')),
    );
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.reset(project, existing.revision, 'Open editable project');
      return existing;
    }
    return this.create(sessionId, project);
  }
}
