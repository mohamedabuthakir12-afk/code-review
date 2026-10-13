import type { FileSource } from "./fileSource.js";
import type { DiffHunk } from "./types.js";

/**
 * Gives the LLM a bit more surrounding code than the diff's own 3 context
 * lines, without ever sending a whole file. This is the "targeted retrieval"
 * trick used instead of a RAG index over the whole repo: for a PR-sized
 * change, pulling a window around each hunk is enough and far cheaper than
 * embedding/searching an entire codebase.
 */
export async function getHunkContext(source: FileSource, hunk: DiffHunk, radius = 40): Promise<string> {
  const content = await source.getFileContent(hunk.file);
  if (content === null) return "(no additional context available)";

  const centerLine = hunk.changedLines[Math.floor(hunk.changedLines.length / 2)] ?? hunk.newStart;
  const lines = content.split("\n");
  const start = Math.max(0, centerLine - radius);
  const end = Math.min(lines.length, centerLine + radius);

  return lines
    .slice(start, end)
    .map((l, i) => `${start + i + 1}: ${l}`)
    .join("\n");
}
