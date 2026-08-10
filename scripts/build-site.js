/**
 * build-site.js — 按任务逐步生成产物站点
 * 每个计划任务 → 一个独立区块（section）；所有区块组装成 index.html
 */
const fs = require("fs");
const path = require("path");

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 从任务指令生成一个区块的 HTML 片段 */
function buildSection(task, index) {
  const title = String(task.instruction || task.t || "任务").trim()
    .replace(/^[\d.\- )）]+/, "")
    .slice(0, 60);
  return `
<section class="ts" id="section-${index + 1}">
  <div class="ts-num">${index + 1}</div>
  <h3>${esc(title)}</h3>
  <p>由 AI 团队根据需求自动实现</p>
</section>`;
}

/** 组装完整站点 */
function assembleSite({ name, requirement, tasks, sections, outDir }) {
  const title = esc(String(name || "Atoms Demo").slice(0, 40));
  const req = esc(String(requirement || "").slice(0, 80));
  const body = sections.join("\n");
  const planList = (tasks || [])
    .map((t, i) => `<li><b>${i + 1}</b> ${esc(String(t.instruction || "").slice(0, 60))}</li>`)
    .join("");

  const indexHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0f;color:#e5e5e5;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.6}
  .wrap{max-width:1080px;margin:0 auto;padding:0 24px}
  header{display:flex;justify-content:space-between;align-items:center;padding:20px 0;border-bottom:1px solid #1f1f28}
  .logo{font-weight:800;font-size:18px;background:linear-gradient(90deg,#7c6cff,#4fb3ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  nav a{color:#9a9aa8;text-decoration:none;margin-left:20px;font-size:14px}
  nav a:hover{color:#fff}
  .hero{text-align:center;padding:84px 0 52px}
  .hero h1{font-size:46px;font-weight:800;letter-spacing:-1px;line-height:1.15;background:linear-gradient(90deg,#fff,#b3a8ff 60%,#7cc0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .hero p{margin:16px auto 24px;max-width:560px;color:#9a9aa8;font-size:17px}
  .hero .req{display:inline-block;padding:5px 14px;border:1px solid #2a2a38;border-radius:99px;color:#8a8aff;font-size:13px}
  .badges{display:flex;justify-content:center;gap:44px;margin-top:44px}
  .badges div{text-align:center}
  .badges b{font-size:24px;background:linear-gradient(90deg,#7c6cff,#4fb3ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .badges span{display:block;font-size:13px;color:#7a7a88;margin-top:4px}
  .sections{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;padding:48px 0}
  .ts{background:#101018;border:1px solid #1f1f28;border-radius:14px;padding:22px;position:relative}
  .ts-num{position:absolute;top:16px;right:18px;font-size:13px;color:#7c6cff;font-weight:700}
  .ts h3{font-size:15px;margin-bottom:8px;color:#fff}
  .ts p{font-size:13px;color:#8a8a98}
  .plan{background:#101018;border:1px solid #1f1f28;border-radius:14px;padding:26px;margin:20px 0}
  .plan h2{font-size:15px;margin-bottom:14px;color:#fff}
  .plan ol{list-style:none}
  .plan li{padding:8px 0;border-bottom:1px dashed #1f1f28;color:#b5b5c0;font-size:14px}
  .plan li b{color:#7c6cff;margin-right:8px}
  .plan li:last-child{border-bottom:none}
  footer{border-top:1px solid #1f1f28;padding:26px 0;text-align:center;color:#6a6a78;font-size:13px}
</style>
</head>
<body>
<div class="wrap">
  <header><div class="logo">${title}</div><nav><a href="#sections">功能</a><a href="#plan">开发计划</a><a href="#">登录</a></nav></header>

  <section class="hero">
    <h1>Turn ideas into products<br/>that sell</h1>
    <p>由 AI 团队按计划逐步构建，每一块都由独立任务生成。</p>
    <div><span class="req">需求：${req}</span></div>
    <div class="badges">
      <div><b>${(tasks || []).length}</b><span>AI 规划任务</span></div>
      <div><b>5 min</b><span>从想法到上线</span></div>
      <div><b>100%</b><span>产物可下载</span></div>
    </div>
  </section>

  <section class="sections" id="sections">
    ${body}
  </section>

  <section class="plan" id="plan">
    <h2>AI 团队开发计划</h2>
    <ol>${planList}</ol>
  </section>

  <footer>© 2026 ${title} · 由 Atoms-Demo 笔试挑战生成</footer>
</div>
</body>
</html>`;

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), indexHtml);
  return outDir;
}

/** 一次性构建（用于初次部署） */
function buildSite({ name, requirement, tasks }, outDir) {
  const sections = (tasks || []).map((t, i) => buildSection(t, i));
  return assembleSite({ name, requirement, tasks, sections, outDir });
}

module.exports = { buildSite, buildSection, assembleSite };
