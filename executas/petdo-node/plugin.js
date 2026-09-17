#!/usr/bin/env node
/**
 * PetDo · 待办小宠 — Anna Executa 插件（Node.js，零第三方依赖）
 *
 * 协议：JSON-RPC 2.0 over stdio（换行分隔）
 *   宿主 → 插件：initialize / describe / health / invoke
 *   插件 → 宿主（反向 RPC）：storage/*（APS KV）、sampling/createMessage（LLM）
 *
 * 数据（APS scope=app self，key 前缀 petdo/）：
 *   petdo/meta            -> { schema: 1, petName, createdAt }
 *   petdo/pet             -> { xp, createdAt }
 *   petdo/tasks/<YYYY-MM> -> { tasks: [Task] }   // 按创建月分片
 *   Task = { id, title, categoryId, priority, due, status,
 *            completedAt, source, createdAt }
 */
"use strict";

const readline = require("node:readline");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// 共享领域核心（ESM）：npm 包内自带 lib/petdo-core.mjs（发布后自包含）；
// 仓库本地开发时回退到仓库根 shared/petdo-core.js
// 静态 require .cjs 优先（pkg/esbuild bundler 可探测字面量并把 core 打进单文件可执行）；
// 普通 Node 模式下若无 .cjs 会 throw 并落到下面的动态 import。
let Core = null;
async function loadCore() {
  if (Core) return Core;
  try { Core = require("./lib/petdo-core.cjs"); if (Core) return Core; } catch {}
  const candidates = [
    path.join(__dirname, "lib", "petdo-core.mjs"),
    path.join(__dirname, "..", "..", "shared", "petdo-core.js"),
  ];
  for (const p of candidates) {
    try { Core = await import(pathToFileURL(p).href); return Core; } catch { /* next */ }
  }
  throw new Error("cannot load petdo-core.js");
}

const PLUGIN_VERSION = "1.0.1";
const STORE_PREFIX = "petdo";
const K = {
  meta: `${STORE_PREFIX}/meta`,
  pet: `${STORE_PREFIX}/pet`,
  tasks: (m) => `${STORE_PREFIX}/tasks/${m}`,
  tasksPrefix: `${STORE_PREFIX}/tasks/`,
};

// ---------------------------------------------------------------------------
// JSON-RPC 基础
// ---------------------------------------------------------------------------
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyError(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });
}

/** 反向 RPC（插件 → 宿主），等待宿主在 stdin 上回传 result/error */
const pending = new Map();
function reverse(method, params, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`reverse RPC timeout: ${method}`), { code: -32005 }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

// ---------------------------------------------------------------------------
// APS 存储封装（scope=app self；host_capabilities: aps.kv）
// ---------------------------------------------------------------------------
async function kvGet(key) {
  const r = await reverse("storage/get", { key }, 15000);
  const exists = !!(r && r.value !== null && r.value !== undefined);
  return { value: exists ? r.value : null, exists, etag: r?.etag ?? null };
}
async function kvSetRaw(key, value, ifMatch) {
  const params = { key, value };
  if (ifMatch) params.if_match = ifMatch;
  const r = await reverse("storage/set", params, 15000);
  return { etag: r.etag ?? null };
}
async function kvList(prefix) {
  const r = await reverse("storage/list", { prefix, limit: 100 }, 15000);
  return r.items || [];
}

function extractKeys(items, prefix) {
  // items 可能是 string[] / [key,value][] / [{key,...}]（三种宿主/测试形态）
  return items
    .map((k) => {
      if (typeof k === "string") return k;
      if (k && typeof k === "object" && typeof k.key === "string") return k.key;
      if (Array.isArray(k) && typeof k[0] === "string") return k[0];
      return null;
    })
    .filter((k) => typeof k === "string" && k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

/** 读-改-写月分片，冲突(-32023)时重读重放 mutation 一次 */
async function mutateMonth(m, mutate) {
  const read = async () => {
    const r = await kvGet(K.tasks(m));
    const entries = r.exists && r.value && Array.isArray(r.value.tasks) ? r.value.tasks : [];
    return { etag: r.etag, tasks: entries };
  };
  let cur = await read();
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = mutate(cur.tasks.map((t) => ({ ...t })));
    try {
      await kvSetRaw(K.tasks(m), { tasks: next }, cur.etag);
      return next;
    } catch (e) {
      if (attempt === 0 && (e.code === -32023 || /precondition/i.test(String(e.message || "")))) {
        cur = await read();
        continue;
      }
      throw e;
    }
  }
}

async function readMeta() {
  const r = await kvGet(K.meta);
  if (r.exists && r.value && r.value.schema) return { value: r.value, etag: r.etag, created: false };
  const fresh = { schema: 1, petName: "Mochi", createdAt: new Date().toISOString() };
  try {
    const w = await kvSetRaw(K.meta, fresh, r.etag || undefined);
    return { value: fresh, etag: w.etag, created: true };
  } catch {
    const r2 = await kvGet(K.meta);
    return { value: (r2.exists && r2.value) || fresh, etag: r2.etag, created: false };
  }
}

async function readPet() {
  const r = await kvGet(K.pet);
  if (r.exists && r.value && typeof r.value.xp === "number") return { value: r.value, etag: r.etag };
  return { value: { xp: 0, createdAt: new Date().toISOString() }, etag: r.etag };
}

async function addXp(delta) {
  const cur = await readPet();
  const next = { ...cur.value, xp: Math.max(0, (cur.value.xp || 0) + delta) };
  try {
    const w = await kvSetRaw(K.pet, next, cur.etag);
    return { pet: next, etag: w.etag };
  } catch (e) {
    if (e.code === -32023 || /precondition/i.test(String(e.message || ""))) {
      const r2 = await kvGet(K.pet);
      const n2 = { ...(r2.exists && r2.value ? r2.value : {}), xp: Math.max(0, ((r2.value && r2.value.xp) || 0) + delta) };
      await kvSetRaw(K.pet, n2, r2.etag);
      return { pet: n2, etag: null };
    }
    throw e;
  }
}

/** 扫描月分片 key（kvList + 近 6 个月兜底），返回升序月列表 */
async function scanMonths() {
  const items = await kvList(K.tasksPrefix);
  const months = new Set(extractKeys(items, K.tasksPrefix));
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.add(`${d.getFullYear()}-${Core.pad2(d.getMonth() + 1)}`);
  }
  return [...months].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
}

async function loadAllTasks() {
  const months = await scanMonths();
  const all = [];
  for (const m of months) {
    const r = await kvGet(K.tasks(m));
    if (r.exists && r.value && Array.isArray(r.value.tasks)) all.push(...r.value.tasks);
  }
  return all;
}

async function findTask(id) {
  const months = await scanMonths();
  for (const m of months) {
    const r = await kvGet(K.tasks(m));
    const tasks = r.exists && r.value && Array.isArray(r.value.tasks) ? r.value.tasks : [];
    const found = tasks.find((t) => t.id === id);
    if (found) return { month: m, task: found, etag: r.etag, tasks };
  }
  return null;
}

// ---------------------------------------------------------------------------
// LLM 采样（sampling/createMessage）——不可用时返回 null，由调用方降级
// ---------------------------------------------------------------------------
const PARSE_SYSTEM_PROMPT = `You are a task parser for a to-do pet app. Extract structured JSON tasks from the user's casual description (Chinese or English).
Rules:
- Resolve relative dates (today, tomorrow, the day after tomorrow, next Monday, Chinese 今天/明天/后天/下周X/X月X号) against the "today" date given in the user message; output due as YYYY-MM-DD or null.
- category must be one of: work, study, life, health, other.
- priority: high (urgent/important/紧急/重要), low (不急/有空/whenever), else normal.
- title: short imperative phrase with date/priority words removed, max 40 chars.
- One message may contain multiple tasks separated by commas or "然后".
- note: optional extra info like a time of day (e.g. "15:00"), else null.
- confidence: 0 to 1.
Reply with a JSON object containing the tasks.`;

async function llmParse(text, today) {
  const userPrompt = `Today is ${today}.\nMessage: ${text}\n` +
    `Output JSON: {"tasks":[{"title":"","category":"work|study|life|health|other","priority":"high|normal|low","due":"YYYY-MM-DD|null","note":null,"confidence":0.9}]}`;
  const resp = await reverse("sampling/createMessage", {
    messages: [{ role: "user", content: { type: "text", text: userPrompt } }],
    maxTokens: 800,
    systemPrompt: PARSE_SYSTEM_PROMPT,
    temperature: 0.1,
    includeContext: "none",
    responseFormat: { type: "json_object" },
    onUnsupported: "json_object",
    metadata: { executa_invoke_id: currentInvokeId() },
  }, 25000);
  const raw = resp?.content?.text;
  if (!raw) throw new Error("sampling returned empty content");
  const json = JSON.parse(extractJson(raw));
  const items = Array.isArray(json.tasks) ? json.tasks : [];
  const drafts = [];
  for (const r of items.slice(0, 5)) {
    const title = String(r.title || "").trim();
    if (!title) continue;
    drafts.push({
      title: title.slice(0, 80),
      categoryId: Core.normalizeCategory(r.category),
      priority: Core.normalizePriority(r.priority),
      due: Core.isValidDate(r.due) ? r.due : null,
      note: r.note ? String(r.note).slice(0, 40) : null,
      confidence: typeof r.confidence === "number" ? r.confidence : 0.85,
    });
  }
  return drafts;
}

const SUMMARY_SYSTEM_PROMPT = `You are the report writer for PetDo, a to-do app with a virtual cat pet. Given task statistics JSON, write a short warm report (2-4 sentences) summarizing what the user accomplished, which category dominated, completion rate, and one concrete encouraging suggestion. Mention the cat's encouragement naturally once. Reply with a JSON object containing the report.`;

async function llmSummarize(statsObj, lang) {
  const userPrompt = `Statistics JSON: ${JSON.stringify(statsObj)}\nLanguage: ${lang === "en" ? "English" : "Simplified Chinese"}\n` +
    `Output JSON: {"text":"<report>"}`;
  const resp = await reverse("sampling/createMessage", {
    messages: [{ role: "user", content: { type: "text", text: userPrompt } }],
    maxTokens: 500,
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    temperature: 0.6,
    includeContext: "none",
    responseFormat: { type: "json_object" },
    onUnsupported: "json_object",
    metadata: { executa_invoke_id: currentInvokeId() },
  }, 25000);
  const raw = resp?.content?.text;
  if (!raw) throw new Error("sampling returned empty content");
  const json = JSON.parse(extractJson(raw));
  const text = String(json.text || "").trim();
  if (!text) throw new Error("empty summary");
  return text;
}

function extractJson(s) {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}
function currentInvokeId() {
  return global.__invokeId || null;
}

// ---------------------------------------------------------------------------
// 工具方法
// ---------------------------------------------------------------------------
function toolError(code, message, details) {
  return { success: false, error: { code, message, ...(details ? { details } : {}) } };
}
function petSnapshot() {
  return readPet().then(async (p) => {
    const meta = await readMeta();
    const tasks = await loadAllTasks();
    return Core.derivePet(tasks, p.value, meta.value, new Date());
  });
}
async function petAfter(deltaXp) {
  const { pet } = await addXp(deltaXp);
  return petSnapshot().then((snap) => ({ ...snap, xp: pet.xp, rawXp: pet.xp }));
}

async function toolParseText(args) {
  const text = String(args.text || "").trim();
  if (!text) return toolError("invalid_arg", "Missing text");
  const today = Core.todayStr();
  let drafts = null;
  let engine = "rules";
  if (ctx?.sampling_token) {
    try {
      drafts = await llmParse(text, today);
      engine = "llm";
    } catch (e) {
      process.stderr.write(`[petdo] sampling failed, fallback to rules: ${e.message || e}\n`);
      drafts = null;
    }
  }
  if (!drafts || drafts.length === 0) {
    const r = Core.parseRules(text, new Date());
    drafts = r.drafts;
    engine = "rules";
  }
  if (drafts.length === 0) {
    return toolError("no_task", "I could not find a task in that message — could you rephrase it?");
  }
  return { success: true, data: { drafts, engine } };
}

async function toolAddTask(args) {
  const title = String(args.title || "").trim();
  if (!title) return toolError("invalid_arg", "Missing title");
  const today = Core.todayStr();
  const task = {
    id: randomUUID(),
    title: title.slice(0, 80),
    categoryId: Core.normalizeCategory(args.category),
    priority: Core.normalizePriority(args.priority),
    due: Core.isValidDate(args.due) ? args.due : null,
    status: "todo",
    completedAt: null,
    source: ["manual", "voice", "chat"].includes(args.source) ? args.source : "chat",
    createdAt: new Date().toISOString(),
  };
  const month = task.createdAt.slice(0, 7);
  await mutateMonth(month, (tasks) => tasks.concat(task));
  const meta = await readMeta();
  const pet = await petSnapshot();
  const todayTasks = tasksForToday(await loadAllTasks(), today);
  return { success: true, data: { task, pet, today: todayTasks } };
}

function tasksForToday(tasks, today) {
  return tasks
    .filter((t) => t.status === "todo" && (!t.due || t.due <= today)
      || (t.status === "done" && t.completedAt && Core.dateToStr(new Date(t.completedAt)) === today))
    .sort((a, b) => (a.due || "9999") .localeCompare(b.due || "9999"));
}

async function toolCompleteTask(args) {
  if (!args.id) return toolError("invalid_arg", "Missing id");
  const found = await findTask(args.id);
  if (!found) return toolError("not_found", "Task not found");
  if (found.task.status === "done") return toolError("already_done", "Task already completed");
  const patched = { ...found.task, status: "done", completedAt: new Date().toISOString() };
  await mutateMonth(found.month, (tasks) => tasks.map((t) => (t.id === patched.id ? patched : t)));
  const gained = Core.xpFor(patched);
  const pet = await petAfter(gained);
  const before = Core.levelInfo(Math.max(0, pet.xp - gained)).level;
  return {
    success: true,
    data: {
      task: patched,
      pet: { ...pet, gained, leveledUp: Core.levelInfo(pet.xp).level > before },
    },
  };
}

async function toolUncompleteTask(args) {
  if (!args.id) return toolError("invalid_arg", "Missing id");
  const found = await findTask(args.id);
  if (!found) return toolError("not_found", "Task not found");
  if (found.task.status !== "done") return toolError("not_done", "Task is not completed");
  const patched = { ...found.task, status: "todo", completedAt: null };
  await mutateMonth(found.month, (tasks) => tasks.map((t) => (t.id === patched.id ? patched : t)));
  const lost = Core.xpFor({ ...found.task });
  const pet = await petAfter(-lost);
  return { success: true, data: { task: patched, pet, lostXp: lost } };
}

async function toolUpdateTask(args) {
  if (!args.id) return toolError("invalid_arg", "Missing id");
  const found = await findTask(args.id);
  if (!found) return toolError("not_found", "Task not found");
  const patched = { ...found.task };
  if (args.title != null && String(args.title).trim()) patched.title = String(args.title).trim().slice(0, 80);
  if (args.category != null) patched.categoryId = Core.normalizeCategory(args.category);
  if (args.priority != null) patched.priority = Core.normalizePriority(args.priority);
  if (args.due !== undefined) patched.due = Core.isValidDate(args.due) ? args.due : null;
  await mutateMonth(found.month, (tasks) => tasks.map((t) => (t.id === patched.id ? patched : t)));
  return { success: true, data: { task: patched } };
}

async function toolDeleteTask(args) {
  if (!args.id) return toolError("invalid_arg", "Missing id");
  const found = await findTask(args.id);
  if (!found) return toolError("not_found", "Task not found");
  await mutateMonth(found.month, (tasks) => tasks.filter((t) => t.id !== args.id));
  return { success: true, data: { deleted: found.task } };
}

async function toolListTasks(args) {
  const today = Core.todayStr();
  const all = await loadAllTasks();
  const filter = String(args.filter || "all");
  let tasks;
  if (filter === "today") {
    tasks = tasksForToday(all, today);
  } else if (filter === "overdue") {
    tasks = all.filter((t) => t.status === "todo" && t.due && t.due < today)
      .sort((a, b) => String(a.due).localeCompare(String(b.due)));
  } else if (filter === "week") {
    const end = Core.shiftDays(today, 7 - ((new Date().getDay() + 6) % 7));
    tasks = all.filter((t) => t.status === "todo" && t.due && t.due >= today && t.due <= end)
      .sort((a, b) => String(a.due).localeCompare(String(b.due)));
  } else {
    tasks = [...all].sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  const pet = await petSnapshot();
  return { success: true, data: { tasks, today, pet } };
}

async function toolGetState() {
  const tasks = await loadAllTasks();
  tasks.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const meta = await readMeta();
  const pet = await petSnapshot();
  return { success: true, data: { tasks, meta: meta.value, pet, today: Core.todayStr() } };
}

async function toolGetStats(args) {
  const period = ["week", "month", "year"].includes(args.period) ? args.period : "week";
  const anchor = Core.isValidDate(args.anchor) ? args.anchor : Core.todayStr();
  const tasks = await loadAllTasks();
  const stats = Core.computeStats(tasks, period, anchor);
  return { success: true, data: { stats } };
}

async function toolSummarizePeriod(args) {
  const period = ["week", "month", "year"].includes(args.period) ? args.period : "week";
  const anchor = Core.isValidDate(args.anchor) ? args.anchor : Core.todayStr();
  const lang = args.lang === "en" ? "en" : "zh";
  const tasks = await loadAllTasks();
  const stats = Core.computeStats(tasks, period, anchor);
  let text = null;
  let engine = "rules";
  if (ctx?.sampling_token) {
    try {
      text = await llmSummarize({
        period, range: [stats.rangeStart, stats.rangeEnd],
        totals: stats.totals,
        byCategory: stats.byCategory,
      }, lang);
      engine = "llm";
    } catch (e) {
      process.stderr.write(`[petdo] summarize sampling failed, fallback: ${e.message || e}\n`);
    }
  }
  if (!text) text = Core.fallbackSummary(stats, lang);
  return { success: true, data: { text, engine, stats } };
}

async function toolPetPat() {
  const pet = await petSnapshot();
  const zhMsg = {
    excited: "呼噜呼噜～今天效率爆棚，我最喜欢现在的你！",
    happy: "喵～被你摸得好开心，继续保持哦。",
    ok: "喵…有点想有人陪我完成任务呢。",
    sad: "喵呜…好久没一起完成任务了，我有点想你。",
    sleeping: "Zzz…（它睡得好熟，完成一个任务叫醒它吧）",
  };
  const enMsg = {
    excited: "Purrr~ You're on fire today! I love this!",
    happy: "Meow~ That feels nice. Keep it up!",
    ok: "Meow... I'd love some company while you finish tasks.",
    sad: "Mew... we haven't finished tasks together in a while. I miss you.",
    sleeping: "Zzz... (fast asleep — finish a task to wake your cat)",
  };
  return {
    success: true,
    data: { pet, _zh: zhMsg[pet.mood] || zhMsg.ok, _en: enMsg[pet.mood] || enMsg.ok },
  };
}

// ---------------------------------------------------------------------------
// describe manifest
// ---------------------------------------------------------------------------
const MANIFEST = {
  display_name: "PetDo",
  version: PLUGIN_VERSION,
  description: "AI-native pet task buddy: add tasks by chat or voice, a virtual cat reacts to your progress, "
    + "with weekly/monthly/yearly reports (category pie + completion bars) and durable per-user cloud storage.",
  author: "petdo",
  tags: ["productivity", "todo", "tasks", "pet", "anna-app", "ai-native"],
  host_capabilities: ["aps.kv", "llm.sample"],
  runtime: { type: "node", min_version: "18.0.0" },
  tools: [
    {
      name: "parse_text",
      description: "Parse a free-text sentence describing one or more tasks (e.g. \"明天下午3点写周报\", \"buy milk, call mom\") "
        + "into structured draft tasks (title, category, priority, due date). Returns drafts for confirmation; does NOT save anything.",
      parameters: [
        { name: "text", type: "string", description: "The raw task sentence", required: true },
      ],
    },
    {
      name: "add_task",
      description: "Save one task. Use after the user confirms a parsed draft, or when title and details are clear.",
      parameters: [
        { name: "title", type: "string", description: "Task title, max 80 chars", required: true },
        { name: "category", type: "string", description: "One of: work/study/life/health/other (default other)", required: false },
        { name: "priority", type: "string", description: "high/normal/low (default normal)", required: false },
        { name: "due", type: "string", description: "Due date YYYY-MM-DD, optional", required: false },
        { name: "source", type: "string", description: "manual/voice/chat, default chat", required: false },
      ],
    },
    {
      name: "complete_task",
      description: "Mark a task as done. Awards pet XP (more for high priority and on-time completion).",
      parameters: [
        { name: "id", type: "string", description: "Task id", required: true },
      ],
    },
    {
      name: "uncomplete_task",
      description: "Reopen a completed task and deduct the XP it awarded.",
      parameters: [
        { name: "id", type: "string", description: "Task id", required: true },
      ],
    },
    {
      name: "update_task",
      description: "Update a task's title, category, priority or due date.",
      parameters: [
        { name: "id", type: "string", description: "Task id", required: true },
        { name: "title", type: "string", description: "New title", required: false },
        { name: "category", type: "string", description: "New category: work/study/life/health/other", required: false },
        { name: "priority", type: "string", description: "New priority: high/normal/low", required: false },
        { name: "due", type: "string", description: "New due date YYYY-MM-DD; pass empty string to clear", required: false },
      ],
    },
    {
      name: "delete_task",
      description: "Delete one task by id.",
      parameters: [
        { name: "id", type: "string", description: "Task id", required: true },
      ],
    },
    {
      name: "list_tasks",
      description: "List tasks. filter=today (due today or overdue, undated tasks, plus done today), overdue, "
        + "week (due within this week), or all (newest first). Returns the pet snapshot too.",
      parameters: [
        { name: "filter", type: "string", description: "today/overdue/week/all (default all)", required: false },
      ],
    },
    {
      name: "get_state",
      description: "Full snapshot for hydrating the app window: all tasks, pet state (xp/level/mood/streak), and meta.",
      parameters: [],
    },
    {
      name: "get_stats",
      description: "Aggregated stats for a period: per-category totals/done (for pie chart), completion rate, "
        + "daily (week/month) or monthly (year) buckets.",
      parameters: [
        { name: "period", type: "string", description: "week/month/year (default week)", required: false },
        { name: "anchor", type: "string", description: "A date inside the period, YYYY-MM-DD (default today)", required: false },
      ],
    },
    {
      name: "summarize_period",
      description: "Write a short AI report for week/month/year based on task stats. Use when the user asks for a summary or review.",
      parameters: [
        { name: "period", type: "string", description: "week/month/year (default week)", required: false },
        { name: "anchor", type: "string", description: "A date inside the period, YYYY-MM-DD (default today)", required: false },
        { name: "lang", type: "string", description: "zh or en (default zh)", required: false },
      ],
    },
    {
      name: "pet_pat",
      description: "Pat the cat. Returns the pet state and a mood-based message (_zh Chinese / _en English). Just for fun.",
      parameters: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// stdio 主循环
// ---------------------------------------------------------------------------
let ctx = null;

async function main() {
  await loadCore();
  const rl = readline.createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { return; }

    // 反向 RPC 的响应（宿主回传）：无 method 字段
    if (!msg.method) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        const err = new Error(msg.error.message || "reverse RPC error");
        err.code = msg.error.code;
        err.data = msg.error.data;
        p.reject(err);
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    // 宿主 → 插件 的请求
    (async () => {
      try {
        switch (msg.method) {
          case "initialize":
            reply(msg.id, {
              protocolVersion: "2.0",
              serverInfo: { name: "petdo", version: PLUGIN_VERSION },
              capabilities: { sampling: {}, storage: {} },
            });
            break;
          case "describe":
            reply(msg.id, MANIFEST);
            break;
          case "health":
            reply(msg.id, { status: "ready", message: "", details: {} });
            break;
          case "invoke": {
            const params = msg.params || {};
            ctx = params.context || {};
            global.__invokeId = ctx.invoke_id || null;
            const handler = TOOLS[params.tool];
            if (!handler) {
              replyError(msg.id, -32601, `unknown tool: ${params.tool}`);
            } else {
              const result = await handler(params.arguments || {}, ctx);
              reply(msg.id, result);
            }
            break;
          }
          default:
            replyError(msg.id, -32601, `unknown method: ${msg.method}`);
        }
      } catch (e) {
        process.stderr.write(`[petdo] handler error: ${e.stack || e}\n`);
        replyError(msg.id, e.code ?? -32603, e.message || String(e));
      } finally {
        global.__invokeId = null;
        ctx = null;
      }
    })();
  });

  rl.on("close", () => process.exit(0));
}

const TOOLS = {
  parse_text: toolParseText,
  add_task: toolAddTask,
  complete_task: toolCompleteTask,
  uncomplete_task: toolUncompleteTask,
  update_task: toolUpdateTask,
  delete_task: toolDeleteTask,
  list_tasks: toolListTasks,
  get_state: toolGetState,
  get_stats: toolGetStats,
  summarize_period: toolSummarizePeriod,
  pet_pat: toolPetPat,
};

main().catch((e) => {
  process.stderr.write(`[petdo] fatal: ${e.stack || e}\n`);
  process.exit(1);
});
