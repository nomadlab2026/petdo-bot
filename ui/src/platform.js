/**
 * platform.js —— PetDo 运行时适配层
 * Anna 宿主模式：SDK 调用 Executa 插件（APS 存储 + Sampling 由宿主提供）。
 * 独立预览模式：localStorage 本地存储 + Web Speech 语音 + 规则解析，共用 shared/petdo-core.js。
 */
import * as Core from "../../shared/petdo-core.js";

const DEV_TOOL_ID = "tool-dev-petdo";
const SDK_URL = "/static/anna-apps/_sdk/latest/index.js";

export async function createPlatform() {
  const params = new URLSearchParams(location.search);
  const looksAnna = params.has("wid") && params.has("t");
  if (looksAnna) {
    try {
      // 动态加载宿主 SDK；@vite-ignore 防止构建期解析这个宿主绝对路径。
      // 同时加载 anna-app 发布时生成于 bundle 根目录的工具 ID 映射 sidecar。
      const [mod] = await Promise.all([
        import(/* @vite-ignore */ SDK_URL),
        loadToolIdSidecar(),
      ]);
      const anna = await mod.AnnaAppRuntime.connect();
      return annaPlatform(anna);
    } catch (e) {
      console.warn("[petdo] Anna connect failed, standalone mode:", e?.message || e);
    }
  }
  return standalonePlatform();
}

/**
 * 加载发布时由 `anna-app apps push` 写到 bundle 根目录的 anna-tool-ids.js
 * （内容：window.__ANNA_TOOL_IDS__ = { "petdo": "<正式 tool_id>" }）。
 * 本地开发环境该文件不存在（404），静默回退到 DEV_TOOL_ID。
 */
function loadToolIdSidecar() {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.__ANNA_TOOL_IDS__) {
      return resolve(window.__ANNA_TOOL_IDS__);
    }
    const s = document.createElement("script");
    s.src = new URL("anna-tool-ids.js", document.baseURI).href;
    s.onload = () => resolve((typeof window !== "undefined" && window.__ANNA_TOOL_IDS__) || {});
    s.onerror = () => resolve({});
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------------------
// Anna 宿主模式
// ---------------------------------------------------------------------------
function annaPlatform(anna) {
  const toolId =
    (typeof window !== "undefined" && window.__ANNA_TOOL_IDS__ && window.__ANNA_TOOL_IDS__["petdo"]) ||
    DEV_TOOL_ID;

  async function call(method, args) {
    // 宿主 dispatcher 解包 {success,data} 双层信封：成功 resolve 为 data，失败 reject。
    return await anna.tools.invoke({ tool_id: toolId, method, args: args || {}, timeoutMs: 60000 });
  }

  return {
    mode: "anna",
    voiceSupported: createVoice().supported, // iframe 可能被禁；onError 时 UI 引导走聊天
    startVoice(onText, onEnd, lang) {
      if (!this.__voice) this.__voice = createVoice();
      return this.__voice.start(onText, onEnd, lang);
    },
    stopVoice() {
      this.__voice?.stop();
    },
    async getState() {
      return call("get_state"); // {tasks, meta, pet, today}
    },
    async parseText(text) {
      return call("parse_text", { text }); // {drafts, engine}
    },
    async addTask(draft) {
      // draft: {title, categoryId, priority, due, note, source}
      return call("add_task", {
        title: draft.title,
        category: draft.categoryId,
        priority: draft.priority,
        due: draft.due || null,
        source: draft.source || "manual",
      });
    },
    async completeTask(id) {
      return call("complete_task", { id }); // {task, pet:{gained, leveledUp,...}}
    },
    async uncompleteTask(id) {
      return call("uncomplete_task", { id });
    },
    async updateTask(id, fields) {
      const args = { id };
      if (fields.title != null) args.title = fields.title;
      if (fields.categoryId != null) args.category = fields.categoryId;
      if (fields.priority != null) args.priority = fields.priority;
      if (fields.due !== undefined) args.due = fields.due || "";
      return call("update_task", args); // {task}
    },
    async deleteTask(id) {
      return call("delete_task", { id }); // {deleted}
    },
    async getStats(period, anchor) {
      const data = await call("get_stats", { period, anchor });
      return data.stats;
    },
    async summarizePeriod(period, lang) {
      return call("summarize_period", { period, lang }); // {text, engine, stats}
    },
    async patPet() {
      return call("pet_pat"); // {pet, _zh, _en}
    },
    prefs: {
      async get() {
        try {
          const r = await anna.storage.get({ key: "petdo:prefs" });
          return r?.value || {};
        } catch {
          return {};
        }
      },
      async set(p) {
        try {
          await anna.storage.set({ key: "petdo:prefs", value: p });
        } catch {
          /* non-fatal */
        }
      },
    },
    onExternalAction(cb) {
      try {
        if (anna.entryPayload) cb(anna.entryPayload);
        anna.on?.("entry_payload", cb);
      } catch {
        /* older SDK */
      }
    },
    async appendCard(summary, payload) {
      try {
        await anna.chat?.append_artifact?.({ kind: "app_event", summary, payload });
      } catch {
        /* chat artifact optional */
      }
    },
    async setTitle(title) {
      try {
        await anna.window?.set_title?.(title);
      } catch {
        /* optional */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 独立预览模式（localStorage + 规则解析 + Web Speech）
// ---------------------------------------------------------------------------
const LS_KEY = "petdo:data";
const LS_PREFS = "petdo:prefs";

function dbLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_KEY));
    if (d && d.months) return d;
  } catch {
    /* fresh */
  }
  return {
    months: {},
    pet: { xp: 0, createdAt: new Date().toISOString() },
    meta: { schema: 1, petName: "Mochi", createdAt: new Date().toISOString() },
  };
}
function dbSave(d) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(d));
  } catch {
    /* storage full / blocked */
  }
}
function allTasks(d) {
  return Object.values(d.months).flatMap((m) => m.tasks || []);
}

// Web Speech 语音引擎（与 iBill 同构）
function createVoice() {
  const SR = typeof window !== "undefined"
    && (window.SpeechRecognition || window.webkitSpeechRecognition);
  let recognition = null;
  return {
    supported: !!SR,
    start(onText, onEnd, lang) {
      if (!SR) { onEnd(); return false; }
      recognition = new SR();
      recognition.lang = lang === "en" ? "en-US" : "zh-CN";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = (ev) => {
        let text = "";
        for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
        onText(text);
      };
      recognition.onerror = (ev) => onEnd(ev?.error || "error");
      recognition.onend = () => onEnd();
      try {
        recognition.start();
      } catch {
        onEnd();
        return false;
      }
      return true;
    },
    stop() {
      try { recognition?.stop(); } catch { /* noop */ }
      recognition = null;
    },
  };
}

function standalonePlatform() {
  const voice = createVoice();

  function petSnapshot(d) {
    return Core.derivePet(allTasks(d), d.pet, d.meta, new Date());
  }
  function todayList(d) {
    const today = Core.todayStr();
    return allTasks(d)
      .filter((t) => (t.status === "todo" && (!t.due || t.due <= today))
        || (t.status === "done" && t.completedAt && Core.dateToStr(new Date(t.completedAt)) === today))
      .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999")));
  }

  return {
    mode: "standalone",
    voiceSupported: voice.supported,
    startVoice(onText, onEnd, lang) {
      return voice.start(onText, onEnd, lang);
    },
    stopVoice() {
      voice.stop();
    },
    async getState() {
      const d = dbLoad();
      const tasks = [...allTasks(d)].sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)));
      return { tasks, meta: d.meta, pet: petSnapshot(d), today: Core.todayStr() };
    },
    async parseText(text) {
      return Core.parseRules(String(text || ""), new Date());
    },
    async addTask(draft) {
      const d = dbLoad();
      const task = {
        id: Core.uid(),
        title: String(draft.title || "").slice(0, 80),
        categoryId: Core.normalizeCategory(draft.categoryId),
        priority: Core.normalizePriority(draft.priority),
        due: draft.due || null,
        status: "todo",
        completedAt: null,
        source: draft.source || "manual",
        createdAt: new Date().toISOString(),
      };
      const month = task.createdAt.slice(0, 7);
      if (!d.months[month]) d.months[month] = { tasks: [] };
      d.months[month].tasks.push(task);
      dbSave(d);
      return { task, pet: petSnapshot(d), today: todayList(d) };
    },
    async completeTask(id) {
      const d = dbLoad();
      const task = allTasks(d).find((t) => t.id === id);
      if (!task) throw Object.assign(new Error("Task not found"), { code: "not_found" });
      task.status = "done";
      task.completedAt = new Date().toISOString();
      const gained = Core.xpFor(task);
      d.pet = { ...(d.pet || {}), xp: Math.max(0, (d.pet?.xp || 0) + gained) };
      dbSave(d);
      const pet = petSnapshot(d);
      const before = Core.levelInfo(Math.max(0, pet.xp - gained)).level;
      return { task, pet: { ...pet, gained, leveledUp: Core.levelInfo(pet.xp).level > before } };
    },
    async uncompleteTask(id) {
      const d = dbLoad();
      const task = allTasks(d).find((t) => t.id === id);
      if (!task) throw Object.assign(new Error("Task not found"), { code: "not_found" });
      const lost = Core.xpFor({ ...task });
      task.status = "todo";
      task.completedAt = null;
      d.pet = { ...(d.pet || {}), xp: Math.max(0, (d.pet?.xp || 0) - lost) };
      dbSave(d);
      return { task, pet: petSnapshot(d), lostXp: lost };
    },
    async updateTask(id, fields) {
      const d = dbLoad();
      const task = allTasks(d).find((t) => t.id === id);
      if (!task) throw Object.assign(new Error("Task not found"), { code: "not_found" });
      if (fields.title != null && String(fields.title).trim()) task.title = String(fields.title).trim().slice(0, 80);
      if (fields.categoryId != null) task.categoryId = Core.normalizeCategory(fields.categoryId);
      if (fields.priority != null) task.priority = Core.normalizePriority(fields.priority);
      if (fields.due !== undefined) task.due = fields.due || null;
      dbSave(d);
      return { task };
    },
    async deleteTask(id) {
      const d = dbLoad();
      let deleted = null;
      for (const m of Object.keys(d.months)) {
        const found = d.months[m].tasks.find((t) => t.id === id);
        if (found) {
          deleted = found;
          d.months[m].tasks = d.months[m].tasks.filter((t) => t.id !== id);
          break;
        }
      }
      dbSave(d);
      if (!deleted) throw Object.assign(new Error("Task not found"), { code: "not_found" });
      return { deleted };
    },
    async getStats(period, anchor) {
      const d = dbLoad();
      return Core.computeStats(allTasks(d), period, anchor);
    },
    async summarizePeriod(period, lang) {
      const d = dbLoad();
      const stats = Core.computeStats(allTasks(d), period);
      return { text: Core.fallbackSummary(stats, lang), engine: "rules", stats };
    },
    async patPet() {
      const d = dbLoad();
      const pet = petSnapshot(d);
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
      return { pet, _zh: zhMsg[pet.mood], _en: enMsg[pet.mood] };
    },
    prefs: {
      async get() {
        try {
          return JSON.parse(localStorage.getItem(LS_PREFS)) || {};
        } catch {
          return {};
        }
      },
      async set(p) {
        try {
          localStorage.setItem(LS_PREFS, JSON.stringify(p));
        } catch {
          /* noop */
        }
      },
    },
    onExternalAction() {
      /* standalone: no external entry */
    },
    async appendCard() {
      /* standalone: no chat */
    },
    async setTitle() {
      /* standalone: no window chrome */
    },
  };
}
