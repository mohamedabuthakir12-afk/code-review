import { readFile } from "node:fs/promises";
import { env } from "../config/env.js";
import { withRetry } from "../utils/retry.js";
import type { FileSource } from "./fileSource.js";
import { getHunkContext } from "./contextRetriever.js";
import { completeJson } from "./llmClient.js";
import type { DiffHunk, Finding, Severity } from "./types.js";

let cachedStandards: string | null = null;

async function loadStandards(): Promise<string> {
  if (cachedStandards === null) {
    cachedStandards = await readFile(env.reviewStandardsPath, "utf-8");
  }
  return cachedStandards;
}

const JSON_SHAPE = `
Respond with ONLY a JSON object, no prose, no markdown fence, in exactly this shape:
{
  "findings": [
    {
      "line": <number, a new-file line number that appears in the diff hunk below>,
      "severity": "info" | "minor" | "major" | "critical",
      "category": "<short category, e.g. 'security', 'logic-bug', 'standards'>",
      "message": "<concise explanation>",
      "suggestion": "<optional replacement code for the flagged line(s)>"
    }
  ]
}
If the hunk has no issues, respond with {"findings": []}.
`.trim();

interface RawFinding {
  line: number;
  severity: string;
  category: string;
  message: string;
  suggestion?: string;
}

/**
 * Reviews one diff hunk with the locally-hosted LLM. Each call is scoped to
 * a single hunk plus a small retrieved context window — never a whole file
 * or repo — so the prompt size is bounded regardless of how large the PR or
 * codebase is, and nothing about the request depends on an external API.
 */
export async function reviewHunk(source: FileSource, hunk: DiffHunk): Promise<Finding[]> {
  const [standards, context] = await Promise.all([loadStandards(), getHunkContext(source, hunk)]);

  const userPrompt = `File: ${hunk.file}

Surrounding context (for reference only, do not flag lines outside the diff below):
\`\`\`
${context}
\`\`\`

Diff hunk to review (lines starting with + are new/changed):
\`\`\`diff
${hunk.patch}
\`\`\`

${JSON_SHAPE}`;

  let parsed: { findings?: RawFinding[] };
  try {
    parsed = (await withRetry(() => completeJson(standards, userPrompt))) as { findings?: RawFinding[] };
  } catch {
    return []; // inference server unreachable or model output stayed malformed after retries — skip this hunk rather than fail the whole review
  }

  const changedLineSet = new Set(hunk.changedLines);

  return (parsed.findings ?? [])
    .filter((f) => changedLineSet.has(f.line)) // guard against hallucinated line numbers outside the diff
    .map((f) => ({
      file: hunk.file,
      line: f.line,
      severity: f.severity as Severity,
      category: f.category,
      message: f.message,
      suggestion: f.suggestion,
      source: "llm" as const,
    }));
}

/** Runs reviewHunk across many hunks with bounded concurrency so a large PR doesn't fire hundreds of simultaneous requests at the inference server. */
export async function reviewHunksConcurrently(source: FileSource, hunks: DiffHunk[]): Promise<Finding[]> {
  const results: Finding[] = [];
  let index = 0;

  async function worker() {
    while (index < hunks.length) {
      const current = hunks[index++];
      const findings = await reviewHunk(source, current);
      results.push(...findings);
    }
  }

  const workers = Array.from({ length: Math.min(env.maxConcurrentLlmCalls, hunks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
