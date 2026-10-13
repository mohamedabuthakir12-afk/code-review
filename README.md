# code-review-agent

In-house replacement for SonarQube + CodeRabbit: a GitHub webhook bot that
reviews every PR with two layers — a deterministic static-analysis pass and
an LLM semantic-review pass — and posts one combined review.

**Fully on-prem by design:** the LLM layer calls a self-hosted,
OpenAI-API-compatible inference server (Ollama, vLLM, llama.cpp server,
TGI, LM Studio, ...) over `LLM_BASE_URL`. No code, diff, or file content is
ever sent to an external AI vendor's API — the only network calls outside
your own infrastructure are to your Git host (GitHub), which already has
your code.

## Why this doesn't hit a token limit

An LLM call is always bounded by a context window; that's unavoidable. The
reason tools like CodeRabbit don't seem limited by it is architecture, not
magic:

1. **Never send the whole repo, or even the whole file.** [`diffChunker.ts`](src/review/diffChunker.ts)
   splits the PR diff into individual hunks (a few dozen lines each). Each
   hunk is reviewed independently, so prompt size depends on how much a PR
   *changed*, not on repo size.
2. **Static analysis handles the part that doesn't need an LLM at all.**
   [`staticAnalysis.ts`](src/review/staticAnalysis.ts) runs semgrep's rule
   engine per changed file — this is what gives SonarQube its "no limit":
   it's pattern matching, not a model call, so it scales to any codebase.
3. **Targeted context instead of RAG over the whole repo.** [`contextRetriever.ts`](src/review/contextRetriever.ts)
   pulls a small window of surrounding lines for each hunk instead of
   embedding/searching the entire repository.
4. **Bounded concurrency.** [`llmReviewer.ts`](src/review/llmReviewer.ts)
   reviews hunks in parallel, capped by `MAX_CONCURRENT_LLM_CALLS`, so a
   large PR doesn't overwhelm your inference server.
5. **Dedup, don't double-spend.** [`aggregator.ts`](src/review/aggregator.ts)
   merges static + LLM findings per file/line so both layers never comment
   on the same issue twice.

This means a 10,000-line PR costs roughly the same *per hunk* as a 10-line
PR — it just makes more parallel calls, which is a latency/throughput
scaling question (and, since this is self-hosted, a GPU-capacity question),
not a hard limit.

## Architecture

```
GitHub webhook (pull_request) -> server.ts (per-PR queue)
                                     |
                                     v
                              orchestrator.ts
                               /            \
                     staticAnalysis.ts   diffChunker.ts -> llmReviewer.ts
                     (semgrep, per file)   (per hunk)      (self-hosted LLM, per hunk,
                       \                                     + contextRetriever.ts)
                        \_________________________________/
                               both read via fileSource.ts
                               (GitHub API, or local disk for dry runs)
                               /            \
                                aggregator.ts
                                     |
                                     v
                         platforms/github.ts (postReview)
```

`fileSource.ts` is the seam that makes the whole pipeline platform- and
environment-agnostic: `githubFileSource.ts` reads files via the GitHub API
for real PRs, `localFileSource.ts` reads from disk for the offline dry-run
tool. Nothing in `src/review/` knows or cares which one it's talking to.

## Setup

```bash
npm install
cp .env.example .env   # fill in GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET
```

You need an OpenAI-API-compatible inference server running somewhere
reachable at `LLM_BASE_URL` (default `http://localhost:11434/v1`, i.e.
[Ollama](https://ollama.com)). Easiest local setup:

```bash
ollama pull qwen2.5-coder:14b   # or a larger/smaller variant to match your GPU
ollama serve
```

Static analysis needs `semgrep` on PATH (`pip install semgrep`); if it's
missing, that layer degrades gracefully and the bot still runs on LLM
findings alone.

```bash
npm run dev     # local dev, auto-reload
npm run build   # compile to dist/
npm start       # run compiled build
```

Point a GitHub webhook (repo or org level) at `POST /webhook` for the
`pull_request` event, with the same secret as `GITHUB_WEBHOOK_SECRET`. Use
something like `ngrok`/`smee.io` for local testing, or deploy behind your
usual ingress for production.

### Docker (app + Ollama together)

```bash
cp .env.example .env   # fill in GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET
docker compose up --build
```

This brings up Ollama (pulling `LLM_MODEL` automatically on first start)
and the app, wired together — nothing external required. Uncomment the GPU
block in `docker-compose.yml` if the host has an NVIDIA GPU; Ollama will
run on CPU otherwise (much slower, fine for small models/low volume).

### Continuous deployment (GitHub Actions)

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on
every push: a `test` job (typecheck + build) on GitHub's own cloud runners,
then a `deploy` job that only runs on a **self-hosted runner** — i.e. a
GitHub Actions runner you install on your own server. This keeps the
on-prem guarantee intact: your code only ever gets built/run on your own
machine, GitHub never touches your secrets or has a path into your
network.

One-time setup on the server you want to deploy to (the workflow targets a
Windows self-hosted runner by default — `runs-on: [self-hosted, Windows]`;
adjust the labels and the `Stage runtime secrets` step's path/shell in
`deploy.yml` if your runner is Linux/macOS instead):

1. Install Docker Desktop (or Docker Engine + Compose).
2. [Register a self-hosted runner](https://github.com/mohamedabuthakir12-afk/code-review/settings/actions/runners/new)
   for this repo and install it as a Windows service, so it's always
   listening.
3. Create a persistent secrets file **outside** the git checkout (the
   workflow copies this into place before each deploy — it never lives in
   the repo or passes through GitHub):
   ```powershell
   New-Item -ItemType Directory -Force -Path C:\code-review-agent-secrets
   Copy-Item .env.example C:\code-review-agent-secrets\.env
   notepad C:\code-review-agent-secrets\.env   # fill in real values
   ```

After that, every push to `master` that passes the typecheck/build job
automatically rebuilds the Docker image and restarts the containers on
that server, then verifies `/healthz` before finishing. Trigger it manually
anytime from the Actions tab (`workflow_dispatch`) too.

### Testing without a real PR

`src/devtools/dryRun.ts` runs the exact same pipeline (static analysis +
LLM review) against a local git checkout — no GitHub token, webhook, or
real PR needed:

```bash
npm run dry-run -- /path/to/some/repo          # reviews uncommitted changes
npm run dry-run -- /path/to/some/repo my.diff  # or a specific diff file
```

Use this to validate the pipeline itself or sanity-check your self-hosted
model's review quality before wiring up the webhook.

## Extending

- **Other Git platforms (GitLab/Bitbucket):** implement `fetchPrDiff` /
  `postReview` from `src/platforms/github.ts` and a `FileSource` (see
  `githubFileSource.ts`) against their APIs; nothing else in `src/review/`
  is GitHub-specific.
- **More static rules:** add a semgrep config/ruleset in `config/` and pass
  `--config <path>` instead of `--config auto` in `staticAnalysis.ts`.
- **Company-specific conventions:** edit [`config/review-standards.md`](config/review-standards.md)
  directly — it's loaded fresh on every review run, no code changes or
  redeploy needed.
- **Swap/add LLM backends:** `llmClient.ts` is the only file that talks to
  the inference server, via the standard OpenAI chat-completions API, so
  any compatible server works without code changes — just change
  `LLM_BASE_URL`/`LLM_MODEL`.
- **Scale beyond one instance:** `server.ts`'s per-PR queue is in-memory
  and per-process; if you run multiple replicas behind a load balancer,
  replace it with a real queue (e.g. Redis/BullMQ) keyed the same way
  (`owner/repo#prNumber`).
