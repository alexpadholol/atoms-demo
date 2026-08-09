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
const crypto = require("crypto");
const archiver = require("archiver");
const { uuid, ...db } = require("./scripts/db");
const { planRequirement } = require("./scripts/planner");
const { detectProvider } = require("./scripts/llm");
const { buildSite } = require("./scripts/build-site");
const { deployManual } = require("./scripts/deploy-manual");
const { copyDir } = require("./scripts/utils");

const app = express();
const PORT = process.env.PORT || 8787;
const WEB_DIR = path.join(__dirname, "web");
const WORKSPACE = path.join(__dirname, "workspace");
const SITES_DIR = path.join(__dirname, "sites");

app.use(express.json());
fs.mkdirSync(WORKSPACE, { recursive: true });
fs.mkdirSync(SITES_DIR, { recursive: true });

process.on("uncaughtException", (e) => console.error("UNCAUGHT:", e));
process.on("unhandledRejection", (e) => console.error("UNHANDLED:", e));
process.on("exit", (c) => console.error("EXIT code:", c));

/* ================= 认证 ================= */
function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 64).toString("hex");
}
function newToken() {
  return crypto.randomBytes(32).toString("hex");
}
function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ code: 401, message: "未登录" });
  const user = db.getUserByToken.get(token);
  if (!user) return res.status(401).json({ code: 401, message: "登录已失效" });
  req.user = user;
  req.token = token;
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 注册（支持邮箱或用户名）/ 登录 / 登出 / 当前用户
app.post("/api/auth/register", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 100);
  let username = String(req.body?.username || "").trim().slice(0, 30);
  const password = String(req.body?.password || "");

  // 邮箱优先；无邮箱则退化为纯用户名注册（兼容）
  const useEmail = !!email;
  if (useEmail && !EMAIL_RE.test(email))
    return res.status(400).json({ code: 1, message: "邮箱格式不正确" });
  if (useEmail && !username) username = email.split("@")[0].slice(0, 30);
  if (username.length < 2 || password.length < 4)
    return res.status(400).json({ code: 1, message: "用户名至少2字符、密码至少4位" });

  if (db.getUserByUsername.get(username))
    return res.status(409).json({ code: 1, message: "用户名已存在" });
  if (useEmail && db.getUserByEmail.get(email))
    return res.status(409).json({ code: 1, message: "邮箱已被注册" });

  const salt = crypto.randomBytes(16).toString("hex");
  const id = uuid();
  db.insertUser.run(id, username, useEmail ? email : null, hashPassword(password, salt), salt);
  const token = newToken();
  db.insertSession.run(token, id);
  res.json({ code: 0, data: { token, user: db.getUserById.get(id) } });
});

app.post("/api/auth/login", (req, res) => {
  const account = String(req.body?.account || req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = db.getUserByLogin.get(account, account);
  if (!user || user.password_hash !== hashPassword(password, user.salt))
    return res.status(401).json({ code: 401, message: "账号或密码错误" });
  const token = newToken();
  db.insertSession.run(token, user.id);
  res.json({ code: 0, data: { token, user: db.getUserById.get(user.id) } });
});

app.post("/api/auth/logout", authMiddleware, (req, res) => {
  db.deleteSession.run(req.token);
  res.json({ code: 0, data: {} });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ code: 0, data: { user: db.getUserById.get(req.user.id) } });
});

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

/* ================= 生成管线 ================= */
async function runPipeline(chat, tasks) {
  const chatId = chat.id;
  const run = (phase, detail) => {
    const id = db.insertToolRun.run(chatId, phase, detail, "running", null, "", 0).lastInsertRowid;
    emit(chatId, "phase", { id, phase, detail, status: "running", output: "" });
    return { id, phase };
  };
  const done = (runInfo, ok, output) => {
    db.updateToolRun.run(ok ? "done" : "failed", ok ? 0 : 1, String(output || ""), runInfo.id);
    emit(chatId, "phase", { id: runInfo.id, phase: runInfo.phase, status: ok ? "done" : "failed", output: String(output || "") });
  };

  try {
    // 1) 代码生成
    const g = run("generate", `代码生成：为「${chat.title}」生成站点`);
    const versionNo = (db.getLatestVersion.get(chatId)?.version_no || 0) + 1;
    const siteDir = path.join(WORKSPACE, chatId, `v${versionNo}`);
    buildSite({ name: chat.title, requirement: chat.requirement, tasks }, siteDir);
    done(g, true, `已生成 ${fs.readdirSync(siteDir).length} 个文件`);

    // 2) 质量校验（真实文件检查）
    const q = run("checkui", "质量校验：检查产物完整性");
    const indexFile = path.join(siteDir, "index.html");
    const html = fs.readFileSync(indexFile, "utf-8");
    const checks = {
      index_exist: fs.existsSync(indexFile),
      has_title: /<title>/.test(html),
      has_hero: /class="hero"/.test(html),
      has_features: /class="features"/.test(html),
    };
    const allOk = Object.values(checks).every(Boolean);
    done(q, allOk, JSON.stringify(checks));

    // 3) 部署（拷贝到 sites + 原子切换 current）
    const d = run("deploy", "部署：发布到可访问路径");
    const target = path.join(SITES_DIR, chatId, `v${versionNo}`);
    fs.rmSync(target, { recursive: true, force: true });
    copyDir(siteDir, target);
    db.clearCurrent.run(chatId);
    const ver = db.insertVersion.run(chatId, versionNo, "building", target, "", 1).lastInsertRowid;
    db.setVersionReady.run(target, JSON.stringify(checks), ver);
    db.setCurrent.run(ver);
    const url = `/api/sites/${chatId}/v${versionNo}/`;
    done(d, true, url);

    db.updateChatStatus.run("done", chatId);
    emit(chatId, "done", { chatId, version: versionNo, url, checks });
  } catch (e) {
    db.updateChatStatus.run("failed", chatId);
    emit(chatId, "error", { message: e.message });
  }
}

/* ================= API ================= */
// 项目（需登录）
app.post("/api/projects", authMiddleware, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 40) || "我的项目";
  const id = uuid();
  db.insertProject.run(id, name, req.user.id);
  res.json({ code: 0, data: db.getProject.get(id) });
});
app.get("/api/projects", authMiddleware, (req, res) => {
  const projects = db.listProjects.all(req.user.id).map((p) => {
    const chats = db.listChatsByProject.all(p.id);
    return { ...p, chatCount: chats.length };
  });
  res.json({ code: 0, data: projects });
});
app.get("/api/projects/:id", authMiddleware, (req, res) => {
  const p = db.getProject.get(req.params.id);
  if (!p) return res.status(404).json({ code: 1, message: "项目不存在" });
  res.json({ code: 0, data: { ...p, chats: db.listChatsByProject.all(p.id) } });
});

// 会话：发起需求 → LLM 规划
app.post("/api/projects/:pid/chats", authMiddleware, async (req, res) => {
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

// 会话详情
app.get("/api/chats/:id", authMiddleware, (req, res) => {
  const chat = db.getChat.get(req.params.id);
  if (!chat) return res.status(404).json({ code: 1, message: "会话不存在" });
  res.json({
    code: 0,
    data: {
      chat,
      messages: db.listMessages.all(chat.id),
      tasks: db.listTasks.all(chat.id),
      toolRuns: db.listToolRuns.all(chat.id),
      version: db.getLatestVersion.get(chat.id) || null,
    },
  });
});

// 批准 → 启动真实管线
app.post("/api/chats/:id/approve", authMiddleware, (req, res) => {
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

// SSE 实时进度（EventSource 无法带 Header，token 走 query）
app.get("/api/chats/:id/events", (req, res) => {
  const token = req.query.token;
  if (!token || !db.getUserByToken.get(String(token)))
    return res.status(401).end();
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
app.get("/api/artifact/download", authMiddleware, (req, res) => {
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
  fs.writeFileSync(path.join(baseDir, "部署手册.md"), manual);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="atoms-demo-artifact.zip"`);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (e) => { console.error(e); res.status(500).end(); });
  archive.pipe(res);
  archive.directory(baseDir, "site");
  archive.finalize();
});

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ code: 0, data: { llm: detectProvider(), version: "1.0.0" } });
});

/* ================= 前端 ================= */
app.use(express.static(WEB_DIR));
app.get("/", (req, res) => res.sendFile(path.join(WEB_DIR, "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Atoms-Demo → http://127.0.0.1:${PORT}`);
  console.log(`  LLM provider → ${detectProvider() || "未配置"}\n`);
});
