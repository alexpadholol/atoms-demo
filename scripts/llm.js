/**
 * llm.js — 多 Provider LLM 调用适配
 * 自动检测环境变量中的 API Key：
 *   1. Anthropic: ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY (+ ANTHROPIC_BASE_URL / ANTHROPIC_MODEL)
 *   2. DeepSeek:  DEEPSEEK_API_KEY (+ DEEPSEEK_BASE_URL)
 *   3. OpenAI:    OPENAI_API_KEY  (+ OPENAI_BASE_URL / OPENAI_MODEL)
 */
const axios = require("axios");

function detectProvider() {
  // 优先级：原生 DeepSeek（deepseek-chat 稳定）> Anthropic > OpenAI
  // 注意：部分环境把 ANTHROPIC_BASE_URL 指向 DeepSeek 网关，其 flash 模型易返回空，故优先原生
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

function stripFences(text) {
  return String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

async function callAnthropic({ system, messages, maxTokens = 1600 }) {
  const base = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const model = process.env.ANTHROPIC_MODEL
    || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    || "claude-sonnet-4-6";
  const headers = { "anthropic-version": "2023-06-01", "content-type": "application/json" };
  if (process.env.ANTHROPIC_AUTH_TOKEN) headers.Authorization = `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`;
  else if (process.env.ANTHROPIC_API_KEY) headers["x-api-key"] = process.env.ANTHROPIC_API_KEY;

  const { data } = await axios.post(
    `${base.replace(/\/$/, "")}/v1/messages`,
    { model, max_tokens: maxTokens, system, messages },
    { headers, timeout: 90000 }
  );
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return { text, model, provider: "anthropic" };
}

async function callOpenAICompat(provider, { system, messages, maxTokens = 1600 }) {
  const isDeepSeek = provider === "deepseek";
  const base = isDeepSeek
    ? (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com")
    : (process.env.OPENAI_BASE_URL || "https://api.openai.com");
  const apiKey = isDeepSeek ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
  const model = isDeepSeek
    ? "deepseek-chat"
    : (process.env.OPENAI_MODEL || "gpt-4o-mini");

  const { data } = await axios.post(
    `${base.replace(/\/$/, "")}/v1/chat/completions`,
    {
      model,
      max_tokens: maxTokens,
      messages: system ? [{ role: "system", content: system }, ...messages] : messages,
      response_format: { type: "json_object" }, // DeepSeek/OpenAI 原生 JSON 模式
    },
    { headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, timeout: 90000 }
  );
  const text = data.choices?.[0]?.message?.content || "";
  return { text, model, provider };
}

/**
 * 统一调用入口
 * @returns {Promise<{text:string, model:string, provider:string}>}
 */
async function callLLM({ system, messages, maxTokens }) {
  const provider = detectProvider();
  if (!provider) throw new Error("未检测到 LLM API Key（请配置 ANTHROPIC / DEEPSEEK / OPENAI）");
  if (provider === "anthropic") return callAnthropic({ system, messages, maxTokens });
  if (provider === "deepseek") return callOpenAICompat("deepseek", { system, messages, maxTokens });
  return callOpenAICompat("openai", { system, messages, maxTokens });
}

module.exports = { callLLM, detectProvider };
