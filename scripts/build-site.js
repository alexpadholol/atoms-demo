/**
 * build-site.js — 按 LLM 计划生成真实产物站点（静态落地页）
 * 输入：{ name, requirement, tasks[] } → 输出目录
 */
const fs = require("fs");
const path = require("path");

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 从任务指令里提取区块标题（截短做功能卡片）
 */
function featureCards(tasks, max = 4) {
  return (tasks || [])
    .map((t) => String(t.instruction || t.t || "").trim())
    .filter(Boolean)
    .map((ins) => ins.replace(/^[\d.\- )）]+/, "").slice(0, 26))
    .slice(0, max);
}

function buildSite({ name, requirement, tasks }, outDir) {
  const title = esc(String(name || "Atoms Demo").slice(0, 40));
  const req = esc(String(requirement || "").slice(0, 80));
  const feats = featureCards(tasks, 4);
  const featHtml = feats.length
    ? feats.map((f) => `<div class="feat"><h3>${f}</h3><p>由 AI 团队根据需求「${req}」自动实现</p></div>`).join("\n")
    : `
      <div class="feat"><h3>AI 产品经理</h3><p>调研需求、撰写 PRD、拆解任务</p></div>
      <div class="feat"><h3>AI 工程师</h3><p>全栈开发、构建验证、质量门禁</p></div>
      <div class="feat"><h3>AI 运营</h3><p>部署上线、SEO、增长建议</p></div>`;

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
  .hero{text-align:center;padding:88px 0 56px}
  .hero h1{font-size:48px;font-weight:800;letter-spacing:-1px;line-height:1.15;background:linear-gradient(90deg,#fff,#b3a8ff 60%,#7cc0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .hero p{margin:18px auto 28px;max-width:560px;color:#9a9aa8;font-size:17px}
  .hero .req{display:inline-block;padding:5px 14px;border:1px solid #2a2a38;border-radius:99px;color:#8a8aff;font-size:13px}
  .cta{display:inline-block;margin-top:22px;background:linear-gradient(90deg,#7c6cff,#5c8fff);color:#fff;text-decoration:none;padding:13px 26px;border-radius:11px;font-weight:600}
  .badges{display:flex;justify-content:center;gap:44px;margin-top:52px}
  .badges div{text-align:center}
  .badges b{font-size:24px;background:linear-gradient(90deg,#7c6cff,#4fb3ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .badges span{display:block;font-size:13px;color:#7a7a88;margin-top:4px}
  .features{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;padding:60px 0}
  .feat{background:#101018;border:1px solid #1f1f28;border-radius:14px;padding:22px}
  .feat h3{font-size:15px;margin-bottom:8px;color:#fff}
  .feat p{font-size:13px;color:#8a8a98}
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
  <header><div class="logo">${title}</div><nav><a href="#features">功能</a><a href="#plan">开发计划</a><a href="#">登录</a></nav></header>

  <section class="hero">
    <h1>Turn ideas into products<br/>that sell</h1>
    <p>由 AI 创业团队构建、上线并运营真实业务。输入想法，剩下的交给我们。</p>
    <div><span class="req">需求：${req}</span></div>
    <div><a class="cta" href="#plan">查看 AI 生成计划</a></div>
    <div class="badges">
      <div><b>${(tasks||[]).length || 12}</b><span>AI 规划任务</span></div>
      <div><b>5 min</b><span>从想法到上线</span></div>
      <div><b>100%</b><span>产物可下载</span></div>
    </div>
  </section>

  <section class="features" id="features">
    ${featHtml}
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

module.exports = { buildSite };
