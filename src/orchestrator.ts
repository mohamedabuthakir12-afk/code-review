import { env } from "./config/env.js";
import { fetchPrDiff, postReview } from "./platforms/github.js";
import { githubFileSource } from "./platforms/githubFileSource.js";
import { aggregateFindings } from "./review/aggregator.js";
import { chunkDiff } from "./review/diffChunker.js";
import type { FileSource } from "./review/fileSource.js";
import { reviewHunksConcurrently } from "./review/llmReviewer.js";
import { runStaticAnalysis } from "./review/staticAnalysis.js";
import type { DiffHunk, Finding, PullRequestContext } from "./review/types.js";
import { withRetry } from "./utils/retry.js";

/**
 * End-to-end review for one PR event: fetch diff -> chunk -> run static +
 * LLM layers in parallel -> aggregate -> post as a single review. Both
 * layers only ever see the changed hunks, so cost and latency scale with
 * the size of the PR, not the size of the repo.
 */
export async function reviewPullRequest(ctx: PullRequestContext): Promise<void> {
  const diff = await withRetry(() => fetchPrDiff(ctx));
  const files = chunkDiff(diff);
  const source = githubFileSource(ctx);

  const findings = await runReview(source, files.flatMap((f) => f.hunks), files);
  await withRetry(() => postReview(ctx, findings));
}

/** Platform-agnostic core: static analysis + LLM review + aggregation. Shared with the local dry-run tool so the exact same logic is what gets tested offline. */
export async function runReview(
  source: FileSource,
  allHunks: DiffHunk[],
  files: Parameters<typeof runStaticAnalysis>[1],
): Promise<Finding[]> {
  if (allHunks.length === 0) return [];

  const hunks = allHunks.length > env.maxHunksPerPr ? allHunks.slice(0, env.maxHunksPerPr) : allHunks;
  if (hunks.length < allHunks.length) {
    console.warn(
      `PR has ${allHunks.length} changed hunks, exceeding MAX_HUNKS_PER_PR=${env.maxHunksPerPr}; reviewing only the first ${hunks.length}.`,
    );
  }

  const [staticFindings, llmFindings] = await Promise.all([
    runStaticAnalysis(source, files),
    reviewHunksConcurrently(source, hunks),
  ]);

  return aggregateFindings([...staticFindings, ...llmFindings]);
}
