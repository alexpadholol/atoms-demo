/**
 * planner.js — 真实 LLM 规划器
 * 输入：用户一句话需求
 * 输出：tasks[]  {instruction, acceptance}
 */
const { callLLM } = require("./llm");

const PLANNER_SYSTEM = `你是"Atoms Lite"的任务规划器。把用户的业务需求拆解成可执行任务列表。

规则：
1. 每个任务 = 一个可验证的产物单元（一个页面区块 / 一个组件 / 一次构建）。
2. 任务数 5-15 个，按实现顺序排列。
3. acceptance 必须是可自动断言的验收标准，例如：
   - "构建成功（npm run build 通过）"
   - "页面包含标题 'Turn ideas into products that sell'"
   - "存在导航栏（.nav）并含 4 个链接"
4. 必须基于用户的具体需求定制，不要套用通用模板。
5. 严格输出 JSON，格式如下，不要输出任何其他内容：
{"tasks":[{"instruction":"...","acceptance":"..."}]}`;

function parseTasks(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const obj = JSON.parse(cleaned);
  const list = Array.isArray(obj) ? obj : obj.tasks;
  if (!Array.isArray(list) || list.length === 0) throw new Error("规划结果格式无效");
  return list
    .map((t) => ({ instruction: String(t.instruction || t.name || "").trim(), acceptance: String(t.acceptance || t.accept || "").trim() }))
    .filter((t) => t.instruction);
}

async function planRequirement(requirement) {
  // flash 等廉价模型偶发返回空文本/截断，做最多 3 次重试
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await callLLM({
        system: PLANNER_SYSTEM,
        messages: [
          { role: "user", content: `用户需求：${requirement}` },
          // 空返回/失败时，给模型一个"容易"的出口，避免闪断
          ...(attempt > 1
            ? [{ role: "user", content: "请立即输出 JSON。如果觉得任务太多，可以精简到 5-8 个，但必须完整返回合法 JSON。" }]
            : []),
        ],
        maxTokens: 2400,
      });
      if (!res.text || !res.text.trim()) {
        lastErr = new Error(`第${attempt}次返回空`);
        await new Promise((r) => setTimeout(r, 800 * attempt)); // 退避
        continue;
      }
      const tasks = parseTasks(res.text);
      if (!tasks.length) { lastErr = new Error("任务列表为空"); continue; }
      return { tasks, model: res.model, provider: res.provider, attempts: attempt };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw lastErr || new Error("规划失败（LLM 返回为空或格式错误）");
}

module.exports = { planRequirement };
