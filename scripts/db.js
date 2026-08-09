/**
 * db.js — SQLite 持久化层（better-sqlite3，单文件 data/atoms.db）
 */
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "data", "atoms.db");
const fs = require("fs");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  requirement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK(status IN ('idle','planning','awaiting_approval','running','done','blocked','failed')),
  model TEXT,
  provider TEXT,
  credits_used REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'message',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  instruction TEXT NOT NULL,
  acceptance TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','running','done','blocked')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_chat ON tasks(chat_id, sort_order);
CREATE TABLE IF NOT EXISTS tool_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('pending','running','done','failed')),
  exit_code INTEGER,
  output TEXT,
  cost_credits REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_runs_chat ON tool_runs(chat_id, id);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'building'
    CHECK(status IN ('building','ready','failed')),
  site_path TEXT,
  quality TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_versions_chat ON versions(chat_id, version_no);
`);

const uuid = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// 兼容旧库：projects 补充 user_id 列
try { db.exec("ALTER TABLE projects ADD COLUMN user_id TEXT"); } catch (_) {}

// ---------- Users / Sessions ----------
const insertUser = db.prepare("INSERT INTO users(id,username,password_hash,salt) VALUES(?,?,?,?)");
const getUserByUsername = db.prepare("SELECT * FROM users WHERE username=?");
const getUserById = db.prepare("SELECT id,username,created_at FROM users WHERE id=?");
const insertSession = db.prepare("INSERT INTO sessions(token,user_id) VALUES(?,?)");
const getUserByToken = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?");
const deleteSession = db.prepare("DELETE FROM sessions WHERE token=?");

// ---------- Projects ----------
const insertProject = db.prepare("INSERT INTO projects(id,name,user_id) VALUES(?,?,?)");
const listProjects = db.prepare("SELECT * FROM projects WHERE user_id=? OR user_id IS NULL ORDER BY created_at DESC");
const getProject = db.prepare("SELECT * FROM projects WHERE id=?");

// ---------- Chats ----------
const insertChat = db.prepare(
  "INSERT INTO chats(id,project_id,title,requirement) VALUES(?,?,?,?)"
);
const getChat = db.prepare("SELECT * FROM chats WHERE id=?");
const updateChatStatus = db.prepare("UPDATE chats SET status=? WHERE id=?");
const updateChatMeta = db.prepare("UPDATE chats SET model=?,provider=?,credits_used=? WHERE id=?");
const listChatsByProject = db.prepare("SELECT * FROM chats WHERE project_id=? ORDER BY created_at DESC");

// ---------- Messages ----------
const insertMessage = db.prepare(
  "INSERT INTO messages(chat_id,role,type,content) VALUES(?,?,?,?)"
);
const listMessages = db.prepare("SELECT * FROM messages WHERE chat_id=? ORDER BY id");

// ---------- Tasks ----------
const clearTasks = db.prepare("DELETE FROM tasks WHERE chat_id=?");
const insertTask = db.prepare(
  "INSERT INTO tasks(chat_id,instruction,acceptance,status,sort_order) VALUES(?,?,?,?,?)"
);
const listTasks = db.prepare("SELECT * FROM tasks WHERE chat_id=? ORDER BY sort_order");
const markTasksApproved = db.prepare("UPDATE tasks SET status='approved' WHERE chat_id=? AND status='pending'");
const markTaskDone = db.prepare("UPDATE tasks SET status='done' WHERE id=?");
const markTaskBlocked = db.prepare("UPDATE tasks SET status='blocked' WHERE id=?");

// ---------- Tool runs ----------
const insertToolRun = db.prepare(
  "INSERT INTO tool_runs(chat_id,phase,detail,status,exit_code,output,cost_credits) VALUES(?,?,?,?,?,?,?)"
);
const updateToolRun = db.prepare(
  "UPDATE tool_runs SET status=?,exit_code=?,output=? WHERE id=?"
);
const listToolRuns = db.prepare("SELECT * FROM tool_runs WHERE chat_id=? ORDER BY id");

// ---------- Versions ----------
const insertVersion = db.prepare(
  "INSERT INTO versions(chat_id,version_no,status,site_path,quality,is_current) VALUES(?,?,?,?,?,?)"
);
const getLatestVersion = db.prepare(
  "SELECT * FROM versions WHERE chat_id=? ORDER BY version_no DESC LIMIT 1"
);
const setVersionReady = db.prepare("UPDATE versions SET status='ready',site_path=?,quality=? WHERE id=?");
const setVersionFailed = db.prepare("UPDATE versions SET status='failed' WHERE id=?");
const clearCurrent = db.prepare("UPDATE versions SET is_current=0 WHERE chat_id=? AND is_current=1");
const setCurrent = db.prepare("UPDATE versions SET is_current=1 WHERE id=?");

module.exports = {
  uuid,
  insertUser, getUserByUsername, getUserById, insertSession, getUserByToken, deleteSession,
  insertProject, listProjects, getProject,
  insertChat, getChat, updateChatStatus, updateChatMeta, listChatsByProject,
  insertMessage, listMessages,
  clearTasks, insertTask, listTasks, markTasksApproved, markTaskDone, markTaskBlocked,
  insertToolRun, updateToolRun, listToolRuns,
  insertVersion, getLatestVersion, setVersionReady, setVersionFailed, clearCurrent, setCurrent,
};
