/**
 * clean-mojibake.js — 清理数据库中因 GBK 终端提交产生的乱码数据
 * 用法: node scripts/clean-mojibake.js
 */
const db = require("./db");

const isMojibake = (s) => typeof s === "string" && s.includes("\uFFFD");

// 找出含乱码的项目
const projects = db.listProjects.all();
const badProjects = projects.filter((p) => isMojibake(p.name));
const badChats = db
  .exec
  ? []
  : [];
// chats 需要单独查：直接从 db 模块无法枚举全部 chats，用 raw 查询
const Database = require("better-sqlite3");
const path = require("path");
const raw = new Database(path.join(__dirname, "..", "data", "atoms.db"));
const allChats = raw.prepare("SELECT * FROM chats").all();
const badChatList = allChats.filter(
  (c) => isMojibake(c.title) || isMojibake(c.requirement)
);

let removedChats = 0;
let removedProjects = 0;

// 删除乱码会话及其关联数据
const delStmt = {
  messages: raw.prepare("DELETE FROM messages WHERE chat_id=?"),
  tasks: raw.prepare("DELETE FROM tasks WHERE chat_id=?"),
  tool_runs: raw.prepare("DELETE FROM tool_runs WHERE chat_id=?"),
  versions: raw.prepare("DELETE FROM versions WHERE chat_id=?"),
  chats: raw.prepare("DELETE FROM chats WHERE id=?"),
};
for (const c of badChatList) {
  for (const k of ["messages", "tasks", "tool_runs", "versions", "chats"]) {
    delStmt[k].run(c.id);
  }
  removedChats++;
}

// 删除乱码项目（以及属于它的、未在 badChatList 里的其他会话）
const delProj = {
  chats: raw.prepare("DELETE FROM chats WHERE project_id=?"),
  projects: raw.prepare("DELETE FROM projects WHERE id=?"),
};
for (const p of badProjects) {
  const projChats = raw.prepare("SELECT * FROM chats WHERE project_id=?").all(p.id);
  for (const c of projChats) {
    for (const k of ["messages", "tasks", "tool_runs", "versions", "chats"]) {
      delStmt[k].run(c.id);
    }
    removedChats++;
  }
  delProj.projects.run(p.id);
  removedProjects++;
}

// 清理会话消息中带乱码的条目（可能出现在 requirement 回显里）
const allMsgs = raw.prepare("SELECT * FROM messages").all();
const delMsg = raw.prepare("DELETE FROM messages WHERE id=?");
let removedMsgs = 0;
for (const m of allMsgs) {
  if (isMojibake(m.content)) { delMsg.run(m.id); removedMsgs++; }
}
// 清理任务里带乱码的
const allTasks = raw.prepare("SELECT * FROM tasks").all();
const delTask = raw.prepare("DELETE FROM tasks WHERE id=?");
let removedTasks = 0;
for (const t of allTasks) {
  if (isMojibake(t.instruction) || isMojibake(t.acceptance)) { delTask.run(t.id); removedTasks++; }
}

console.log(`清理完成：删除乱码项目 ${removedProjects} 个，会话 ${removedChats} 个，消息 ${removedMsgs} 条，任务 ${removedTasks} 条`);
