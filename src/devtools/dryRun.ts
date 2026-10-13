import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { localFileSource } from "../platforms/localFileSource.js";
import { chunkDiff } from "../review/diffChunker.js";
import { runReview } from "../orchestrator.js";
import type { Finding } from "../review/types.js";

const execFileAsync = promisify(execFile);

/**
 * Runs the full review pipeline (static analysis + LLM) against a local
 * checkout, with no GitHub webhook, token, or real PR needed. Useful to
 * validate the pipeline itself, or to sanity-check your self-hosted model
 * against a real diff before wiring up the webhook.
 *
 * Usage:
 *   npm run dry-run -- <repoRoot> [diffFile]
 *
 * With no diffFile, runs `git diff` (uncommitted changes) in repoRoot.
 */
async function main() {
  const [repoRoot, diffFile] = process.argv.slice(2);
  if (!repoRoot) {
    console.error("Usage: npm run dry-run -- <repoRoot> [diffFile]");
    process.exit(1);
  }

  const diff = diffFile
    ? await readFile(diffFile, "utf-8")
    : await getUncommittedDiff(repoRoot);

  if (!diff.trim()) {
    console.log("No diff to review (working tree clean, or diffFile empty).");
    return;
  }

  const files = chunkDiff(diff);
  const hunks = files.flatMap((f) => f.hunks);
  console.log(`Reviewing ${hunks.length} hunk(s) across ${files.length} file(s)...`);

  const findings = await runReview(localFileSource(repoRoot), hunks, files);
  printFindings(findings);
}

async function getUncommittedDiff(repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["diff", "HEAD"], { cwd: repoRoot, maxBuffer: 1024 * 1024 * 50 });
  return stdout;
}

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log("No issues found.");
    return;
  }
  for (const f of findings) {
    console.log(`\n[${f.severity.toUpperCase()}] ${f.file}:${f.line} (${f.source}/${f.category})`);
    console.log(`  ${f.message}`);
    if (f.suggestion) console.log(`  suggestion: ${f.suggestion}`);
  }
  console.log(`\n${findings.length} finding(s) total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
