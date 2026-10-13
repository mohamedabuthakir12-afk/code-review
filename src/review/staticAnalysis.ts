import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import type { FileSource } from "./fileSource.js";
import type { FileDiff, Finding, Severity } from "./types.js";

const execFileAsync = promisify(execFile);

interface SemgrepResult {
  results: Array<{
    path: string;
    start: { line: number };
    extra: {
      severity: string;
      message: string;
      metadata?: { category?: string };
    };
  }>;
}

/**
 * Rule-based scan, same role SonarQube plays: deterministic, zero token
 * cost, and scales to any repo size since it never goes through an LLM.
 * Runs semgrep's default rule pack against each changed file and keeps only
 * findings that land on lines actually touched by this diff, so the bot
 * doesn't resurface pre-existing issues on every PR.
 */
export async function runStaticAnalysis(source: FileSource, files: FileDiff[]): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const file of files) {
    if (file.isBinary || file.hunks.length === 0) continue;
    const changedLineSet = new Set(file.hunks.flatMap((h) => h.changedLines));
    if (changedLineSet.size === 0) continue;

    const results = await scanFile(source, file.file);
    for (const r of results) {
      if (!changedLineSet.has(r.start.line)) continue; // only flag what this PR touched
      findings.push({
        file: file.file,
        line: r.start.line,
        severity: mapSeverity(r.extra.severity),
        category: r.extra.metadata?.category ?? "static-analysis",
        message: r.extra.message,
        source: "static",
      });
    }
  }

  return findings;
}

async function scanFile(source: FileSource, filePath: string): Promise<SemgrepResult["results"]> {
  const content = await source.getFileContent(filePath);
  if (content === null) return [];

  const dir = await mkdtemp(path.join(tmpdir(), "review-"));
  const localPath = path.join(dir, path.basename(filePath));
  try {
    await writeFile(localPath, content, "utf-8");
    const { stdout } = await execFileAsync(env.semgrepBin, [
      "--config",
      "auto",
      "--json",
      "--quiet",
      localPath,
    ]);
    const parsed = JSON.parse(stdout) as SemgrepResult;
    // semgrep reports the temp path; rewrite back to the real repo-relative path
    return parsed.results.map((r) => ({ ...r, path: filePath }));
  } catch {
    return []; // semgrep not installed, unsupported language, or scan error — degrade gracefully
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mapSeverity(semgrepSeverity: string): Severity {
  switch (semgrepSeverity.toUpperCase()) {
    case "ERROR":
      return "critical";
    case "WARNING":
      return "major";
    default:
      return "minor";
  }
}
