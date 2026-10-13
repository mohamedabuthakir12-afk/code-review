import { Octokit } from "@octokit/rest";
import { env } from "../config/env.js";
import type { Finding, PullRequestContext } from "../review/types.js";

export const octokit = new Octokit({ auth: env.githubToken });

export async function fetchPrDiff(ctx: PullRequestContext): Promise<string> {
  const res = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    {
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.prNumber,
      mediaType: { format: "diff" },
    },
  );
  return res.data as unknown as string;
}

/** Posts a single review with all findings as inline comments where possible, falling back to a summary comment for anything that can't be anchored to a diff line. */
export async function postReview(ctx: PullRequestContext, findings: Finding[]): Promise<void> {
  const comments = findings.map((f) => ({
    path: f.file,
    line: f.line,
    body: formatComment(f),
  }));

  const body = summarize(findings);

  if (comments.length === 0) {
    await octokit.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.prNumber,
      body,
    });
    return;
  }

  await octokit.pulls.createReview({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.prNumber,
    commit_id: ctx.headSha,
    event: "COMMENT",
    body,
    comments,
  });
}

function formatComment(f: Finding): string {
  const tag = f.source === "static" ? "static-analysis" : "llm-review";
  let body = `**[${f.severity.toUpperCase()}] ${f.category}** _(${tag})_\n\n${f.message}`;
  if (f.suggestion) body += `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``;
  return body;
}

function summarize(findings: Finding[]): string {
  if (findings.length === 0) return "No issues found by automated review.";
  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(counts).map(([sev, n]) => `${n} ${sev}`);
  return `Automated review found ${findings.length} issue(s): ${parts.join(", ")}.`;
}
