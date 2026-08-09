/**
 * deploy-manual.js — 生成产物包内的部署手册
 */
function deployManual({ name, url }) {
  const title = String(name || "Atoms Demo").slice(0, 40);
  return `# ${title} · 部署手册

> 本产物由 Atoms-Demo（AI Agent 平台笔试原型）自动生成。
> 产物：静态站点（index.html + 内联样式）+ 本手册。

## 一、产物说明
- 类型：静态网站（纯 HTML/CSS，无后端依赖，可任意静态托管）
- 入口：\`index.html\`
- 生成方式：AI 规划器（LLM）拆解任务 → 代码生成器按计划产出 → 质量校验 → 部署打包
${url ? `- 在线预览：${url}\n` : ""}
## 二、本地预览
\`\`\`bash
npx serve .
# 或
python -m http.server 8000
# 打开 http://127.0.0.1:8000
\`\`\`

## 三、部署到 GitHub Pages（免费）
1. 推送产物到 GitHub 仓库 → Settings → Pages → 选择分支与根目录
2. 访问 \`https://<用户名>.github.io/<仓库名>/\`

## 四、部署到 Vercel / Netlify（免费，自动 CI）
- **Vercel**：\`npm i -g vercel\` → 产物目录执行 \`vercel\` → 框架选 \`Other\`
- **Netlify**：拖拽产物文件夹到 Netlify Drop，或关联 Git 仓库（构建命令留空，发布目录为根目录）

## 五、部署到自有服务器（nginx）
\`\`\`nginx
server { listen 80; server_name your.domain.com; root /var/www/${title}; index index.html; }
\`\`\`

## 六、验证清单
- [ ] 首页可访问，标题为「${title}」
- [ ] 导航链接可跳转
- [ ] 移动端自适应
- [ ] HTTPS 已启用（GitHub Pages/Vercel 自动，自有服务器请配证书）

## 七、回滚
- 静态托管：回滚到上一构建产物（git revert / 平台历史版本）
- 自有服务器：保留上一版目录，切换 nginx root 指向

## 八、安全提示
- 本产物为静态演示站，不含后端、数据库与用户数据。
- 如需登录/支付等真实业务，请由 Atoms-Demo 业务模板生成，并补充鉴权、支付回调验签、隐私合规声明。

---
*本手册由 Atoms-Demo 产物打包流程自动附带。*
`;
}

module.exports = { deployManual };
