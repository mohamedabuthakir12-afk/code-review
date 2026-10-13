/**
 * Abstracts "get me the content of this file" away from where the repo
 * actually lives. The review pipeline (static analysis, context retrieval)
 * only ever talks to this interface, so the same logic runs against a
 * GitHub-hosted PR or a local on-disk checkout (used for offline dry runs).
 */
export interface FileSource {
  getFileContent(path: string): Promise<string | null>;
}
