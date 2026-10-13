import { Webhooks } from "@octokit/webhooks";
import express from "express";
import pino from "pino";
import { env, requireGithubEnv } from "./config/env.js";
import { reviewPullRequest } from "./orchestrator.js";
import type { PullRequestContext } from "./review/types.js";

const log = pino();
const { githubWebhookSecret } = requireGithubEnv();
const webhooks = new Webhooks({ secret: githubWebhookSecret });

/**
 * Serializes reviews per-PR so a rapid sequence of pushes (each firing its
 * own `synchronize` event) can't run two reviews concurrently and post
 * duplicate/conflicting comments. Different PRs still run in parallel.
 */
const prQueues = new Map<string, Promise<void>>();

function enqueueReview(ctx: PullRequestContext): void {
  const key = `${ctx.owner}/${ctx.repo}#${ctx.prNumber}`;
  const previous = prQueues.get(key) ?? Promise.resolve();

  const next = previous
    .catch(() => undefined) // a prior failure shouldn't block later reviews for the same PR
    .then(async () => {
      log.info({ ctx }, "reviewing pull request");
      await reviewPullRequest(ctx);
      log.info({ ctx }, "review posted");
    })
    .catch((err) => {
      log.error({ ctx, err }, "review failed");
    })
    .finally(() => {
      if (prQueues.get(key) === next) prQueues.delete(key); // avoid unbounded growth once the queue drains
    });

  prQueues.set(key, next);
}

webhooks.on(["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"], async ({ payload }) => {
  enqueueReview({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    prNumber: payload.pull_request.number,
    headSha: payload.pull_request.head.sha,
    baseSha: payload.pull_request.base.sha,
  });
});

webhooks.onError((err) => {
  log.error({ err }, "webhook error");
});

const app = express();
app.use(express.text({ type: "*/*" }));

app.post("/webhook", async (req, res) => {
  const id = req.header("x-github-delivery") ?? "";
  const name = req.header("x-github-event") ?? "";
  const signature = req.header("x-hub-signature-256") ?? "";

  try {
    await webhooks.verifyAndReceive({
      id,
      name: name as "pull_request",
      payload: req.body as string,
      signature,
    });
    res.status(202).send("accepted");
  } catch (err) {
    log.warn({ err }, "rejected webhook delivery");
    res.status(400).send("invalid signature or payload");
  }
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.listen(env.port, () => {
  log.info(`code-review-agent listening on port ${env.port}`);
});
