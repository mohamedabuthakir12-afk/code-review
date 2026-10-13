import { octokit } from "./github.js";
import type { FileSource } from "../review/fileSource.js";
import type { PullRequestContext } from "../review/types.js";

export function githubFileSource(ctx: PullRequestContext): FileSource {
  return {
    async getFileContent(path: string): Promise<string | null> {
      try {
        const res = await octokit.repos.getContent({
          owner: ctx.owner,
          repo: ctx.repo,
          path,
          ref: ctx.headSha,
        });
        if (Array.isArray(res.data) || res.data.type !== "file" || !res.data.content) {
          return null;
        }
        return Buffer.from(res.data.content, "base64").toString("utf-8");
      } catch {
        return null; // binary, too large, or not found — caller falls back gracefully
      }
    },
  };
}
