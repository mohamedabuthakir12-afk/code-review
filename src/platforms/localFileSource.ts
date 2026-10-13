import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FileSource } from "../review/fileSource.js";

/** Reads files from a local checkout on disk — used by the dry-run tool so the whole pipeline can be tested without GitHub credentials or a webhook. */
export function localFileSource(repoRoot: string): FileSource {
  return {
    async getFileContent(filePath: string): Promise<string | null> {
      try {
        return await readFile(path.join(repoRoot, filePath), "utf-8");
      } catch {
        return null;
      }
    },
  };
}
