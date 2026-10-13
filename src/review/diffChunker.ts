import parseDiff from "parse-diff";
import type { DiffHunk, FileDiff } from "./types.js";

/**
 * Splits a unified diff into per-file, per-hunk chunks. This is the core trick
 * for staying under any LLM's context window regardless of PR or repo size:
 * we never hand the model a whole file or whole repo, only the hunks that
 * actually changed, each a few dozen lines at most.
 */
export function chunkDiff(unifiedDiff: string): FileDiff[] {
  const files = parseDiff(unifiedDiff);

  return files
    .filter((f) => !f.to || f.to !== "/dev/null") // skip deletions
    .map((f): FileDiff => {
      const file = f.to ?? f.from ?? "unknown";

      if (f.chunks.length === 0) {
        return { file, isBinary: true, hunks: [] }; // no hunks usually means a binary diff
      }

      const hunks: DiffHunk[] = f.chunks.map((chunk) => {
        const changedLines: number[] = [];
        let newLineNo = chunk.newStart;
        const patchLines: string[] = [chunk.content];

        for (const change of chunk.changes) {
          patchLines.push(change.content);
          if (change.type === "add") {
            changedLines.push(newLineNo);
            newLineNo++;
          } else if (change.type === "normal") {
            newLineNo++;
          }
          // 'del' lines don't exist in the new file, newLineNo unchanged
        }

        return {
          file,
          newStart: chunk.newStart,
          patch: patchLines.join("\n"),
          changedLines,
        };
      });

      return { file, isBinary: false, hunks };
    });
}

/** Groups hunks from possibly many files into batches of roughly `maxHunks` each, for one LLM call per batch. */
export function batchHunks(files: FileDiff[], maxHunks: number): DiffHunk[][] {
  const all = files.flatMap((f) => f.hunks);
  const batches: DiffHunk[][] = [];
  for (let i = 0; i < all.length; i += maxHunks) {
    batches.push(all.slice(i, i + maxHunks));
  }
  return batches;
}
