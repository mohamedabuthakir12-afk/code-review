import OpenAI from "openai";
import { env } from "../config/env.js";

/**
 * Thin client for a self-hosted, OpenAI-API-compatible inference server
 * (Ollama, vLLM, llama.cpp server, TGI, LM Studio, ...). No code or diff
 * content ever leaves the network this server runs on — there is no
 * external LLM vendor in this path.
 */
const client = new OpenAI({
  baseURL: env.llmBaseUrl,
  apiKey: env.llmApiKey,
  timeout: env.llmRequestTimeoutMs,
});

export async function completeJson(systemPrompt: string, userPrompt: string): Promise<unknown> {
  const response = await client.chat.completions.create({
    model: env.llmModel,
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  return extractJson(text);
}

/**
 * Open-weight models reliably follow "output JSON" instructions but often
 * wrap it in prose or a markdown code fence rather than emitting bare JSON
 * the way Claude's tool-use does. This pulls the first well-formed JSON
 * object out of whatever text comes back instead of assuming a clean
 * response.
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Model response did not contain a JSON object: ${text.slice(0, 200)}`);
  }

  return JSON.parse(candidate.slice(start, end + 1));
}
