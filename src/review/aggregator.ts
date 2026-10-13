import type { Finding } from "./types.js";

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  critical: 3,
  major: 2,
  minor: 1,
  info: 0,
};

/**
 * Merges static-analysis and LLM findings. When both layers flag the same
 * file/line, the static finding wins (it's deterministic and cheaper to
 * trust); the LLM finding is dropped to avoid duplicate comments. Final
 * list is sorted by severity so the most important issues surface first.
 */
export function aggregateFindings(findings: Finding[]): Finding[] {
  const byLocation = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.file}:${f.line}`;
    const list = byLocation.get(key) ?? [];
    list.push(f);
    byLocation.set(key, list);
  }

  const merged: Finding[] = [];
  for (const group of byLocation.values()) {
    const staticFinding = group.find((f) => f.source === "static");
    merged.push(staticFinding ?? group[0]);
  }

  return merged.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
