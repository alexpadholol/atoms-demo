/**
 * Atoms-Demo — AI Agent 平台笔试原型
 * 真实链路：项目 → 需求 → LLM 规划 → 批准 → 代码生成 → 校验 → 部署 → 预览/下载
 * 持久化：SQLite（data/atoms.db）
 * 实时进度：SSE（/api/chats/:id/events）
 */
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const iconv = require("iconv-lite");
const archiver = require("archiver");
const { uuid, ...db } = require("./scripts/db");
const { planRequirement } = require("./scripts/planner");
const { detectProvider } = require("./scripts/llm");
const { buildSite, buildSection, assembleSite } = require("./scripts/build-site");
const { deployManual } = require("./scripts/deploy-manual");
const { copyDir } = require("./scripts/utils");

const app = express();
const PORT = process.env.PORT || 8787;
const WEB_DIR = path.join(__dirname, "web");
const WORKSPACE = path.join(__dirname, "workspace");
const SITES_DIR = path.join(__dirname, "sites");

// JSON 解析：捕获原始字节，兼容 UTF-8（浏览器）与 GBK（Windows 终端 curl）
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use((req, res, next) => {
  if (req.rawBody && req.rawBody.length) {
    try {
      const utf8 = req.rawBody.toString("utf8");
      if (utf8.includes("\uFFFD")) {
        // 说明终端用 GBK 提交了中文 → 用 GBK 重新解析，避免存入乱码
        const gbk = iconv.decode(req.rawBody, "gbk");
        req.body = JSON.parse(gbk);
      }
    } catch (_) { /* 保持原 body */ }
  }
  next();
});
fs.mkdirSync(WORKSPACE, { recursive: true });
fs.mkdirSync(SITES_DIR, { recursive: true });

// 统一给文本/JSON 响应加 charset=utf-8，避免中文乱码
app.use((req, res, next) => {
  const orig = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    if (/^content-type$/i.test(name) && typeof value === "string") {
      if (/^text\/|^application\/json/.test(value) && !/charset=/i.test(value)) {
        value += "; charset=utf-8";
      }
    }
    return orig(name, value);
  };
  next();
});

process.on("uncaughtException", (e) => console.error("UNCAUGHT:", e));
process.on("unhandledRejection", (e) => console.error("UNHANDLED:", e));
process.on("exit", (c) => console.error("EXIT code:", c));

/* ================= SSE 事件中心 ================= */
const clients = new Map(); // chatId -> Set<res>

function subscribe(chatId, res) {
  if (!clients.has(chatId)) clients.set(chatId, new Set());
  clients.get(chatId).add(res);
}
function unsubscribe(chatId, res) {
  clients.get(chatId)?.delete(res);
}
function emit(chatId, event, data) {
  const set = clients.get(chatId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch (_) { /* ignore */ }
  }
}

/* ================= 生成管线（逐任务执行） ================= */
function readPart(partsDir, i) {
  const f = path.join(partsDir, `part-${i}.html`);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : buildSection({ instruction: `区块 ${i + 1}` }, i);
}
function partsDirOf(chatId, versionNo) {
  return path.join(WORKSPACE, chatId, `v${versionNo}`, "parts");
}

function deploySite(chatId, versionNo, siteDir, checks) {
  const target = path.join(SITES_DIR, chatId, `v${versionNo}`);
  fs.rmSync(target, { recursive: true, force: true });
  copyDir(siteDir, target);
  db.clearCurrent.run(chatId);
  const ver = db.insertVersion.run(chatId, versionNo, "building", target, "", 1).lastInsertRowid;
  db.setVersionReady.run(target, JSON.stringify(checks), ver);
  db.setCurrent.run(ver);
  return `/api/sites/${chatId}/v${versionNo}/`;
}

function assembleFromParts(chat, tasks, versionNo) {
  const partsDir = partsDirOf(chat.id, versionNo);
  const sections = tasks.map((t, i) => readPart(partsDir, i));
  const siteDir = path.join(WORKSPACE, chat.id, `v${versionNo}`);
  assembleSite({ name: chat.title, requirement: chat.requirement, tasks, sections, outDir: siteDir });
  return siteDir;
}

async function runPipeline(chat, tasks) {
  const chatId = chat.id;
  try {
    const versionNo = (db.getLatestVersion.get(chatId)?.version_no || 0) + 1;
    const partsDir = partsDirOf(chatId, versionNo);
    fs.mkdirSync(partsDir, { recursive: true });

    // 逐任务执行：每个任务 = 生成一个区块，独立状态
    for (const [i, task] of tasks.entries()) {
      db.markTaskRunning.run(task.id);
      emit(chatId, "task", { task_id: task.id, status: "running" });
      try {
        const sec = buildSection(task, i);
        fs.writeFileSync(path.join(partsDir, `part-${i}.html`), sec);
        db.markTaskDone.run(task.id);
        emit(chatId, "task", { task_id: task.id, status: "done" });
      } catch (e) {
        db.markTaskBlocked.run(task.id);
        emit(chatId, "task", { task_id: task.id, status: "blocked", error: e.message });
      }
    }

    // 组装 → 校验 → 部署
    const g = db.insertToolRun.run(chatId, "generate", "代码生成：按计划逐区块生成", "done", 0, `共 ${tasks.length} 个区块`, 0).lastInsertRowid;
    emit(chatId, "phase", { id: g, phase: "generate", status: "done", output: `共 ${tasks.length} 个区块` });

    const siteDir = assembleFromParts(chat, tasks, versionNo);
    const indexFile = path.join(siteDir, "index.html");
    const html = fs.readFileSync(indexFile, "utf-8");
    const checks = {
      index_exist: fs.existsSync(indexFile),
      has_title: /<title>/.test(html),
      has_hero: /class="hero"/.test(html),
      has_sections: /class="ts"/.test(html),
    };
    const q = db.insertToolRun.run(chatId, "checkui", "质量校验：检查产物完整性", "done", 0, JSON.stringify(checks), 0).lastInsertRowid;
    emit(chatId, "phase", { id: q, phase: "checkui", status: "done", output: JSON.stringify(checks) });

    const url = deploySite(chatId, versionNo, siteDir, checks);
    const d = db.insertToolRun.run(chatId, "deploy", "部署：发布到可访问路径", "done", 0, url, 0).lastInsertRowid;
    emit(chatId, "phase", { id: d, phase: "deploy", status: "done", output: url });

    const blocked = db.listTasks.all(chatId).filter((t) => t.status === "blocked").length;
    db.updateChatStatus.run(blocked ? "blocked" : "done", chatId);
    emit(chatId, "done", { chatId, version: versionNo, url, checks, blocked });
  } catch (e) {
    db.updateChatStatus.run("failed", chatId);
    emit(chatId, "error", { message: e.message });
  }
}

/**
 * 状态对账：修复不一致状态
 * 场景：任务全部完成但会话 failed / 无产物（旧版本崩溃遗留）
 * 处理：任务全 done 时强制恢复 done；无产物则重建版本
 */
function repairChat(chatId) {
  const chat = db.getChat.get(chatId);
  if (!chat) return;
  const tasks = db.listTasks.all(chatId);
  if (!tasks.length) return;
  const allDone = tasks.every((t) => t.status === "done");
  const ver = db.getLatestVersion.get(chatId);
  if (allDone && (!ver || ver.status !== "ready")) {
    try {
      const versionNo = ver ? ver.version_no : 1;
      const partsDir = partsDirOf(chatId, versionNo);
      fs.mkdirSync(partsDir, { recursive: true });
      tasks.forEach((t, i) => {
        const f = path.join(partsDir, `part-${i}.html`);
        if (!fs.existsSync(f)) fs.writeFileSync(f, buildSection(t, i));
      });
      const siteDir = assembleFromParts(chat, tasks, versionNo);
      const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
      const checks = {
        index_exist: true, has_title: /<title>/.test(html), has_hero: /class="hero"/.test(html), has_sections: /class="ts"/.test(html),
      };
      deploySite(chatId, versionNo, siteDir, checks);
    } catch (e) {
      console.error("[repair]", e.message);
    }
  }
  if (allDone) db.updateChatStatus.run("done", chatId);
}

/** 重试/修改单个任务：重生成该区块并重新组装、重新部署 */
function rebuildTask(chat, task) {
  const chatId = chat.id;
  const ver = db.getLatestVersion.get(chatId);
  if (!ver) return;
  const versionNo = ver.version_no;
  const tasks = db.listTasks.all(chatId);
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx < 0) return;

  db.markTaskRunning.run(task.id);
  emit(chatId, "task", { task_id: task.id, status: "running" });
  try {
    const partsDir = partsDirOf(chatId, versionNo);
    fs.mkdirSync(partsDir, { recursive: true });
    const sec = buildSection(task, idx);
    fs.writeFileSync(path.join(partsDir, `part-${idx}.html`), sec);
    const siteDir = assembleFromParts(chat, tasks, versionNo);
    const html = fs.readFileSync(path.join(siteDir, "index.html"), "utf-8");
    const checks = {
      index_exist: true, has_title: /<title>/.test(html), has_hero: /class="hero"/.test(html), has_sections: /class="ts"/.test(html),
    };
    deploySite(chatId, versionNo, siteDir, checks);
    db.markTaskDone.run(task.id);
    emit(chatId, "task", { task_id: task.id, status: "done" });
  } catch (e) {
    db.markTaskBlocked.run(task.id);
    emit(chatId, "task", { task_id: task.id, status: "blocked", error: e.message });
  }
}

/* ================= API ================= */
// 项目
app.post("/api/projects", (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 40) || "我的项目";
  const id = uuid();
  db.insertProject.run(id, name);
  res.json({ code: 0, data: db.getProject.get(id) });
});
app.get("/api/projects", (req, res) => {
  const projects = db.listProjects.all().map((p) => {
    const chats = db.listChatsByProject.all(p.id);
    return { ...p, chatCount: chats.length };
  });
  res.json({ code: 0, data: projects });
});
app.get("/api/projects/:id", (req, res) => {
  const p = db.getProject.get(req.params.id);
  if (!p) return res.status(404).json({ code: 1, message: "项目不存在" });
  // 触发状态对账，让侧边栏会话状态正确
  db.listChatsByProject.all(p.id).forEach((c) => repairChat(c.id));
  res.json({ code: 0, data: { ...db.getProject.get(p.id), chats: db.listChatsByProject.all(p.id) } });
});

// 会话：发起需求 → LLM 规划
app.post("/api/projects/:pid/chats", async (req, res) => {
  const requirement = String(req.body?.requirement || "").trim().slice(0, 200);
  if (!requirement) return res.status(400).json({ code: 1, message: "需求不能为空" });
  const project = db.getProject.get(req.params.pid);
  if (!project) return res.status(404).json({ code: 1, message: "项目不存在" });

  const chatId = uuid();
  const title = requirement.split(/[，,。\n]/)[0].slice(0, 20);
  db.insertChat.run(chatId, project.id, title, requirement);
  db.insertMessage.run(chatId, "user", "message", requirement);

  // 真实 LLM 规划
  db.updateChatStatus.run("planning", chatId);
  try {
    const { tasks, model, provider } = await planRequirement(requirement);
    db.clearTasks.run(chatId);
    tasks.forEach((t, i) => db.insertTask.run(chatId, t.instruction, t.acceptance, "pending", i));
    db.updateChatMeta.run(model, provider, 0, chatId);
    db.insertMessage.run(chatId, "agent", "message", `已拆解为 ${tasks.length} 个任务，等待批准`);
    db.updateChatStatus.run("awaiting_approval", chatId);
    res.json({ code: 0, data: { chat: db.getChat.get(chatId), tasks: db.listTasks.all(chatId) } });
  } catch (e) {
    db.updateChatStatus.run("failed", chatId);
    res.status(500).json({ code: 1, message: `规划失败：${e.message}` });
  }
});

// 会话详情（先做状态对账，修复旧数据不一致）
app.get("/api/chats/:id", (req, res) => {
  const chat = db.getChat.get(req.params.id);
  if (!chat) return res.status(404).json({ code: 1, message: "会话不存在" });
  repairChat(chat.id);
  res.json({
    code: 0,
    data: {
      chat: db.getChat.get(chat.id),
      messages: db.listMessages.all(chat.id),
      tasks: db.listTasks.all(chat.id),
      toolRuns: db.listToolRuns.all(chat.id),
      version: db.getLatestVersion.get(chat.id) || null,
    },
  });
});

// 批准 → 启动真实管线
app.post("/api/chats/:id/approve", (req, res) => {
  const chat = db.getChat.get(req.params.id);
  if (!chat) return res.status(404).json({ code: 1, message: "会话不存在" });
  if (chat.status !== "awaiting_approval" && chat.status !== "failed")
    return res.status(400).json({ code: 1, message: `当前状态不允许批准：${chat.status}` });
  db.markTasksApproved.run(chat.id);
  db.updateChatStatus.run("running", chat.id);
  const tasks = db.listTasks.all(chat.id);
  // 异步执行管线
  runPipeline(chat, tasks);
  res.json({ code: 0, data: { chat: db.getChat.get(chat.id) } });
});

// 重试单个任务（重新生成该区块并重新部署）
app.post("/api/tasks/:id/retry", (req, res) => {
  const task = db.getTask.get(req.params.id);
  if (!task) return res.status(404).json({ code: 1, message: "任务不存在" });
  const chat = db.getChat.get(task.chat_id);
  if (!chat || !db.getLatestVersion.get(chat.id))
    return res.status(400).json({ code: 1, message: "会话尚未完成过部署，无法重试" });
  rebuildTask(chat, task);
  res.json({ code: 0, data: { task: db.getTask.get(task.id) } });
});

// 修改任务指令（保存后自动重生成该区块）
app.put("/api/tasks/:id", (req, res) => {
  const instruction = String(req.body?.instruction || "").trim().slice(0, 200);
  if (!instruction) return res.status(400).json({ code: 1, message: "指令不能为空" });
  const task = db.getTask.get(req.params.id);
  if (!task) return res.status(404).json({ code: 1, message: "任务不存在" });
  db.updateTaskInstruction.run(instruction, task.id);
  const chat = db.getChat.get(task.chat_id);
  if (chat && db.getLatestVersion.get(chat.id)) rebuildTask(chat, db.getTask.get(task.id));
  res.json({ code: 0, data: { task: db.getTask.get(task.id) } });
});

// SSE 实时进度
app.get("/api/chats/:id/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const chatId = req.params.id;
  subscribe(chatId, res);

  // 重放已有进度
  const runs = db.listToolRuns.all(chatId);
  for (const r of runs) {
    res.write(`event: phase\ndata: ${JSON.stringify({ phase: r.phase, detail: r.detail, status: r.status === "running" ? "done" : r.status, output: r.output })}\n\n`);
  }
  const chat = db.getChat.get(chatId);
  if (chat && chat.status === "done") {
    const v = db.getLatestVersion.get(chatId);
    res.write(`event: done\ndata: ${JSON.stringify({ chatId, version: v?.version_no, url: v ? `/api/sites/${chatId}/v${v.version_no}/` : null })}\n\n`);
  }

  const hb = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => { clearInterval(hb); unsubscribe(chatId, res); });
});

// 产物站点预览
app.use("/api/sites", express.static(SITES_DIR));

// 产物下载（含部署手册）
app.get("/api/artifact/download", (req, res) => {
  const chatId = String(req.query.chatId || "");
  const chat = db.getChat.get(chatId);
  const ver = db.getLatestVersion.get(chatId);
  if (!chat || !ver || ver.status !== "ready")
    return res.status(404).json({ code: 1, message: "产物不存在或尚未完成" });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atoms-artifact-"));
  const siteDir = path.join(ver.site_path);
  const baseDir = path.join(tmp, "site");
  copyDir(siteDir, baseDir);
  const manual = deployManual({ name: chat.title, url: `https://${req.get("host")}/api/sites/${chatId}/v${ver.version_no}/` });
  // 加 UTF-8 BOM：避免中文 Windows 编辑器按 ANSI(GBK) 打开导致乱码
  fs.writeFileSync(path.join(baseDir, "部署手册.md"), "\uFEFF" + manual);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="atoms-demo-artifact.zip"`);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (e) => { console.error(e); res.status(500).end(); });
  archive.pipe(res);
  archive.directory(baseDir, "site");
  archive.finalize();
});

// 健康检查（含数据库状态，便于部署诊断）
app.get("/api/health", (req, res) => {
  let dbOk = true, dbMsg = "ok";
  try { db.listProjects.all(); } catch (e) { dbOk = false; dbMsg = e.message; }
  res.json({ code: 0, data: { llm: detectProvider(), db: { ok: dbOk, msg: dbMsg }, version: "1.0.0" } });
});

/* ================= 前端 ================= */
// 强制不缓存 HTML，避免浏览器用旧版本导致乱码/功能不一致
const noStore = (res, p) => {
  if (/\.html?$/.test(p) || p === "/") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  }
};
app.use(express.static(WEB_DIR, { etag: true, setHeaders: noStore }));
app.get("/", (req, res) => res.sendFile(path.join(WEB_DIR, "index.html"), { setHeaders: (r) => r.setHeader("Cache-Control", "no-store, no-cache, must-revalidate") }));

// 启动修复：上次进程异常退出残留的 running 会话（管线已不在运行，
// 若不处理会导致前端打开后永远等待 done → "执行总是完不成"）
try { db.resetStuckRunning.run(); } catch (_) {}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Atoms-Demo → http://127.0.0.1:${PORT}`);
  console.log(`  LLM provider → ${detectProvider() || "未配置"}\n`);
});
