export type Severity = "info" | "minor" | "major" | "critical";

export interface Finding {
  file: string;
  line: number;
  severity: Severity;
  category: string;
  message: string;
  suggestion?: string;
  source: "static" | "llm";
}

export interface DiffHunk {
  file: string;
  /** Line number in the new file where this hunk starts */
  newStart: number;
  /** Unified-diff text for just this hunk, including +/- markers */
  patch: string;
  /** Lines actually added/changed (new-file line numbers), for mapping LLM findings back to real lines */
  changedLines: number[];
}

export interface FileDiff {
  file: string;
  isBinary: boolean;
  hunks: DiffHunk[];
}

export interface PullRequestContext {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  baseSha: string;
}
