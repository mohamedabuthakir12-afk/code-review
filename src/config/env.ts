import "dotenv/config";

export const env = {
  // Only required by the webhook server (server.ts), not by the dry-run
  // tool, which never talks to GitHub's API for auth.
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  githubToken: process.env.GITHUB_TOKEN,

  // Self-hosted, OpenAI-API-compatible inference server (Ollama, vLLM,
  // llama.cpp server, TGI, LM Studio, ...). Nothing here ever calls an
  // external LLM vendor's API.
  llmBaseUrl: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
  llmApiKey: process.env.LLM_API_KEY ?? "not-needed",
  llmModel: process.env.LLM_MODEL ?? "qwen2.5-coder:14b",

  port: Number(process.env.PORT ?? 3000),
  semgrepBin: process.env.SEMGREP_BIN ?? "semgrep",
  maxConcurrentLlmCalls: Number(process.env.MAX_CONCURRENT_LLM_CALLS ?? 4),
  maxHunksPerLlmCall: Number(process.env.MAX_HUNKS_PER_LLM_CALL ?? 6),
  maxHunksPerPr: Number(process.env.MAX_HUNKS_PER_PR ?? 150),
  llmRequestTimeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 60_000),
  reviewStandardsPath: process.env.REVIEW_STANDARDS_PATH ?? "config/review-standards.md",
};

/** Fails fast with a clear message if a GitHub-dependent env var is missing. Called only by code paths that actually need it (the webhook server), not by the dry-run tool. */
export function requireGithubEnv(): { githubWebhookSecret: string; githubToken: string } {
  if (!env.githubWebhookSecret) throw new Error("Missing required env var: GITHUB_WEBHOOK_SECRET");
  if (!env.githubToken) throw new Error("Missing required env var: GITHUB_TOKEN");
  return { githubWebhookSecret: env.githubWebhookSecret, githubToken: env.githubToken };
}
