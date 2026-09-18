"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// shared/petdo-core.js
var petdo_core_exports = {};
__export(petdo_core_exports, {
  CATEGORIES: () => CATEGORIES,
  PRIORITIES: () => PRIORITIES,
  STAGE_META: () => STAGE_META,
  categoryMeta: () => categoryMeta,
  computeStats: () => computeStats,
  dateToStr: () => dateToStr,
  daysBetween: () => daysBetween,
  derivePet: () => derivePet,
  extractTime: () => extractTime,
  fallbackSummary: () => fallbackSummary,
  isValidDate: () => isValidDate,
  levelInfo: () => levelInfo,
  mondayOf: () => mondayOf,
  monthKeyOf: () => monthKeyOf,
  normalizeCategory: () => normalizeCategory,
  normalizePriority: () => normalizePriority,
  pad2: () => pad2,
  parseRules: () => parseRules,
  resolveDate: () => resolveDate,
  shiftDays: () => shiftDays,
  streakOf: () => streakOf,
  todayStr: () => todayStr,
  uid: () => uid,
  xpFor: () => xpFor
});
module.exports = __toCommonJS(petdo_core_exports);
function pad2(n) {
  return String(n).padStart(2, "0");
}
function dateToStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayStr() {
  return dateToStr(/* @__PURE__ */ new Date());
}
function monthKeyOf(dateStr) {
  return String(dateStr || "").slice(0, 7);
}
function shiftDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return dateToStr(dt);
}
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7;
  return shiftDays(dateStr, -dow);
}
function isValidDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN((/* @__PURE__ */ new Date(s + "T00:00:00")).getTime());
}
function resolveDate(text, now) {
  const t = String(text || "");
  const base = dateToStr(now);
  if (/今天|今日|today/i.test(t)) return base;
  if (/明天|明日|tomorrow/i.test(t)) return shiftDays(base, 1);
  if (/后天/.test(t)) return shiftDays(base, 2);
  if (/大后天/.test(t)) return shiftDays(base, 3);
  if (/昨天|昨日|yesterday/i.test(t)) return shiftDays(base, -1);
  const nextWeek = /(下{1,2})(?:周|星期|礼拜)([一二三四五六日天])/.exec(t);
  if (nextWeek) {
    const mon = shiftDays(mondayOf(base), 7);
    return shiftDays(mon, WD_MAP[nextWeek[2]] ?? 0);
  }
  const wd = /(?:周|星期|礼拜)([一二三四五六日天])/.exec(t);
  if (wd) {
    const mon = mondayOf(base);
    const target = shiftDays(mon, WD_MAP[wd[1]] ?? 0);
    return target < base ? shiftDays(target, 7) : target;
  }
  const md = /(\d{1,2})\s*(?:月|[\/])\s*(\d{1,2})\s*[日号]?/.exec(t);
  if (md) {
    let y = now.getFullYear();
    let iso = `${y}-${pad2(+md[1])}-${pad2(+md[2])}`;
    if (isValidDate(iso)) return iso;
    iso = `${y + 1}-${pad2(+md[1])}-${pad2(+md[2])}`;
    if (isValidDate(iso)) return iso;
    return null;
  }
  const iso2 = /(\d{4}-\d{1,2}-\d{1,2})/.exec(t);
  if (iso2) {
    const [Y, M, D] = iso2[1].split("-").map(Number);
    const iso = `${Y}-${pad2(M)}-${pad2(D)}`;
    return isValidDate(iso) ? iso : null;
  }
  return null;
}
var WD_MAP = { "\u4E00": 0, "\u4E8C": 1, "\u4E09": 2, "\u56DB": 3, "\u4E94": 4, "\u516D": 5, "\u65E5": 6, "\u5929": 6 };
var TIME_CN_RE = /(上午|早上|凌晨|中午|下午|晚上|傍晚)?\s*(\d{1,2})\s*[点时]\s*(?:(\d{1,2})\s*分)?\s*钟?/;
var TIME_CN_RE_G = new RegExp(TIME_CN_RE.source, "g");
function extractTime(text) {
  const t = String(text || "");
  const direct = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(t);
  if (direct) {
    const h = +direct[1], m2 = +direct[2];
    if (h >= 0 && h <= 23 && m2 >= 0 && m2 <= 59) return `${pad2(h)}:${pad2(m2)}`;
  }
  const m = TIME_CN_RE.exec(t);
  if (!m) return null;
  let hour = +m[2];
  const minute = m[3] ? +m[3] : 0;
  const prefix = m[1];
  if (prefix) {
    if (/下午|晚上|傍晚/.test(prefix)) {
      if (hour < 12) hour += 12;
    } else if (prefix === "\u4E2D\u5348") {
      if (hour !== 12) hour += 12;
    }
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${pad2(hour)}:${pad2(minute)}`;
}
var CATEGORIES = [
  { id: "work", zh: "\u5DE5\u4F5C", en: "Work", emoji: "\u{1F4BC}", color: "#5B8DEF" },
  { id: "study", zh: "\u5B66\u4E60", en: "Study", emoji: "\u{1F4DA}", color: "#9B7EDE" },
  { id: "life", zh: "\u751F\u6D3B", en: "Life", emoji: "\u{1F3E0}", color: "#4CAF8D" },
  { id: "health", zh: "\u5065\u5EB7", en: "Health", emoji: "\u{1F3C3}", color: "#E67E22" },
  { id: "other", zh: "\u5176\u4ED6", en: "Other", emoji: "\u{1F4CC}", color: "#8A94A6" }
];
function categoryMeta(id, lang = "zh") {
  const c = CATEGORIES.find((x) => x.id === id);
  if (!c) return { id: "other", zh: "\u5176\u4ED6", en: "Other", emoji: "\u{1F4CC}", color: "#8A94A6" };
  return c;
}
function normalizeCategory(id) {
  const c = CATEGORIES.find((x) => x.id === String(id || "").toLowerCase().trim());
  return c ? c.id : "other";
}
var PRIORITIES = ["high", "normal", "low"];
function normalizePriority(p) {
  return PRIORITIES.includes(p) ? p : "normal";
}
var CAT_HINTS = [
  ["health", /健身|跑步|游泳|运动|锻炼|散步|瑜伽|体检|吃药|吃药|看病|复诊|疫苗|早睡|journal|gym|run|workout|doctor|medicine/i],
  ["study", /学习|复习|背|读书|看书|上课|作业|论文|考试|单词|课程|网课|笔记|study|read|homework|exam|course|review/i],
  ["work", /工作|开会|会议|报告|周报|日报|邮件|汇报|方案|需求|上线|发版|代码|评审|客户|面试|offer|deadline|meeting|report|email|review|deploy|code|standup/i],
  ["life", /买菜|做饭|洗衣|打扫|缴费|水电|房租|快递|取件|理发|购物|囤货|接|送|办证|银行|保险|买菜|垃圾/i]
];
var PRIORITY_HIGH = /紧急|马上|立刻|尽快|重要|优先|asap|urgent|important/i;
var PRIORITY_LOW = /不急|有空|顺便|低优先|不着急|有空再|someday|low priority|whenever/i;
function parseRules(text, now = /* @__PURE__ */ new Date()) {
  const raw = String(text || "").trim();
  if (!raw) return { drafts: [], engine: "rules" };
  const parts = /[，,；;\n]+/.test(raw) && !resolveDate(raw, now) ? raw.split(/[，,；;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5) : [raw];
  const drafts = [];
  for (const seg of parts) {
    const due = resolveDate(seg, now);
    const timeNote = extractTime(seg);
    let title = seg.replace(/^(帮我|请|记得|提醒我|我要?|需要|添加任务|新增任务|加个?任务|记一笔|然后|接着|还有|再|add task|remind me to|please)\s*/i, "").replace(/^(把|将)\s*/, "");
    if (due) {
      title = title.replace(/(大)?后天|今天|今日|明天|明日|昨天|昨日/g, "").replace(/(下{1,2}|本)?(周|星期|礼拜)[一二三四五六日天]/g, "").replace(/\d{1,2}\s*(?:月|[\/])\s*\d{1,2}\s*[日号]?/g, "").replace(/\d{4}-\d{1,2}-\d{1,2}/g, "");
    }
    if (timeNote) title = title.replace(TIME_CN_RE_G, "").replace(/\d{1,2}\s*[:：]\s*\d{2}/g, "");
    title = title.replace(/(紧急|重要|优先|不急|不着急|有空再|顺便|asap|urgent|important)/gi, "").replace(/(加上?任务|安排(一下)?|加上?|的?任务)$/g, "").replace(/^[，,、。.\s]+|[，,、。.\s]+$/g, "").trim();
    if (!title) title = seg.trim().slice(0, 80);
    let categoryId = "other";
    for (const [cat, re] of CAT_HINTS) {
      if (re.test(seg)) {
        categoryId = cat;
        break;
      }
    }
    const priority = PRIORITY_HIGH.test(seg) ? "high" : PRIORITY_LOW.test(seg) ? "low" : "normal";
    const signal = (due ? 1 : 0) + (categoryId !== "other" ? 1 : 0) + (priority !== "normal" ? 1 : 0);
    drafts.push({
      title: title.slice(0, 80),
      categoryId,
      priority,
      due: due || null,
      note: timeNote ? zhOrEn(seg) ? `${timeNote} \u63D0\u9192` : `remind at ${timeNote}` : null,
      confidence: signal === 0 ? 0.5 : signal === 1 ? 0.65 : 0.8
    });
  }
  return { drafts, engine: "rules" };
}
function zhOrEn(s) {
  return /[\u4e00-\u9fff]/.test(s);
}
function xpFor(task) {
  const base = task.priority === "high" ? 15 : task.priority === "low" ? 5 : 10;
  const onTime = task.due && task.completedAt ? dateToStr(new Date(task.completedAt)) <= task.due : false;
  return base + (onTime ? 5 : 0);
}
function levelInfo(xp) {
  let level = 1, acc = 0;
  while (xp >= acc + 50 * level) {
    acc += 50 * level;
    level += 1;
  }
  const into = xp - acc;
  const need = 50 * level;
  const stage = level <= 2 ? "kitten" : level <= 5 ? "junior" : level <= 9 ? "cat" : "legend";
  return { level, into, need, stage, progress: Math.min(1, into / need) };
}
var STAGE_META = {
  kitten: { zh: "\u5976\u732B", en: "Kitten" },
  junior: { zh: "\u5C11\u5E74\u732B", en: "Junior" },
  cat: { zh: "\u6210\u732B", en: "Cat" },
  legend: { zh: "\u4F20\u5947\u732B", en: "Legend" }
};
function daysBetween(fromStr, toStr) {
  const a = (/* @__PURE__ */ new Date(fromStr + "T00:00:00")).getTime();
  const b = (/* @__PURE__ */ new Date(toStr + "T00:00:00")).getTime();
  return Math.max(0, Math.round((b - a) / 864e5));
}
function streakOf(doneDates, today) {
  const set = new Set(doneDates);
  if (!set.size) return 0;
  let start = set.has(today) ? today : shiftDays(today, -1);
  if (!set.has(start)) return 0;
  let streak = 0, cur = start;
  while (set.has(cur)) {
    streak += 1;
    cur = shiftDays(cur, -1);
  }
  return streak;
}
function derivePet(tasks, pet, meta, now = /* @__PURE__ */ new Date()) {
  const today = todayStr();
  const todo = tasks.filter((t) => t.status === "todo");
  const doneDates = tasks.filter((t) => t.status === "done" && t.completedAt).map((t) => dateToStr(new Date(t.completedAt)));
  const todayDone = doneDates.filter((d) => d === today).length;
  const todayTotal = tasks.filter((t) => {
    if (t.status === "done") return t.completedAt && dateToStr(new Date(t.completedAt)) === today;
    return !t.due || t.due <= today;
  }).length;
  const overdue = todo.filter((t) => t.due && t.due < today).length;
  const lastActive = doneDates.length ? doneDates.sort().slice(-1)[0] : meta?.createdAt ? dateToStr(new Date(meta.createdAt)) : today;
  const idleDays = daysBetween(lastActive, today);
  const streak = streakOf(doneDates, today);
  let score = 30 + Math.min(45, todayDone * 15) + Math.min(30, streak * 4) - Math.min(48, overdue * 12) - Math.min(40, idleDays * 8);
  score = Math.max(0, Math.min(100, score));
  let mood;
  if (idleDays >= 3 && todayDone === 0 && overdue === 0) mood = "sleeping";
  else if (score >= 80) mood = "excited";
  else if (score >= 55) mood = "happy";
  else if (score >= 30) mood = "ok";
  else mood = "sad";
  const xp = Math.max(0, pet?.xp ?? 0);
  return {
    xp,
    ...levelInfo(xp),
    petName: meta?.petName || "Mochi",
    mood,
    score,
    overdue,
    todayDone,
    todayTotal,
    streak,
    idleDays,
    lastActive
  };
}
function computeStats(tasks, period, anchor) {
  const base = isValidDate(anchor) ? anchor : todayStr();
  let start, end, bucketKey;
  if (period === "week") {
    start = mondayOf(base);
    end = shiftDays(start, 6);
    bucketKey = (d) => d;
  } else if (period === "month") {
    const [y, m] = base.split("-").map(Number);
    start = `${y}-${pad2(m)}-01`;
    end = dateToStr(new Date(y, m, 0));
    bucketKey = (d) => d;
  } else {
    const y = Number(base.slice(0, 4));
    start = `${y}-01-01`;
    end = `${y}-12-31`;
    bucketKey = (d) => d.slice(0, 7);
  }
  const inRange = tasks.filter((t) => {
    const d = t.status === "done" && t.completedAt ? dateToStr(new Date(t.completedAt)) : t.due || t.createdAt?.slice(0, 10) || base;
    return d >= start && d <= end;
  });
  const bucketList = [];
  if (period === "week") {
    for (let i = 0; i < 7; i++) bucketList.push(shiftDays(start, i));
  } else if (period === "month") {
    const [y, m] = start.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    for (let i = 1; i <= last; i++) bucketList.push(`${start.slice(0, 7)}-${pad2(i)}`);
  } else {
    for (let i = 1; i <= 12; i++) bucketList.push(`${start.slice(0, 4)}-${pad2(i)}`);
  }
  const buckets = bucketList.map((key) => {
    const items = inRange.filter((t) => bucketKey(bucketDateOf(t, base)) === key);
    return {
      key,
      total: items.length,
      done: items.filter((t) => t.status === "done" && dateToStr(new Date(t.completedAt)) <= key).length
    };
  });
  const byCategory = {};
  for (const t of inRange) {
    const c = normalizeCategory(t.categoryId);
    byCategory[c] = byCategory[c] || { total: 0, done: 0 };
    byCategory[c].total += 1;
    if (t.status === "done") byCategory[c].done += 1;
  }
  const total = inRange.length;
  const done = inRange.filter((t) => t.status === "done").length;
  return {
    period,
    anchor: base,
    rangeStart: start,
    rangeEnd: end,
    label: period === "week" ? `${start} ~ ${end}` : period === "month" ? start.slice(0, 7) : start.slice(0, 4),
    buckets,
    byCategory,
    totals: { total, done, rate: total ? done / total : 0 }
  };
}
function bucketDateOf(t, base) {
  if (t.status === "done" && t.completedAt) return dateToStr(new Date(t.completedAt));
  if (t.due) return t.due;
  return t.createdAt ? String(t.createdAt).slice(0, 10) : base;
}
function fallbackSummary(stats, lang = "zh") {
  const zh = lang !== "en";
  const cats = Object.entries(stats.byCategory).sort((a, b) => b[1].total - a[1].total).slice(0, 3).map(([id, v]) => {
    const m = categoryMeta(id, zh ? "zh" : "en");
    const name = zh ? m.zh : m.en;
    const rate2 = v.total ? Math.round(v.done / v.total * 100) : 0;
    return zh ? `${m.emoji}${name} ${v.total} \u9879\uFF08\u5B8C\u6210 ${rate2}%\uFF09` : `${m.emoji}${name} ${v.total} (${rate2}% done)`;
  });
  const rate = Math.round(stats.totals.rate * 100);
  if (zh) {
    return `\u672C\u671F\u5171 ${stats.totals.total} \u9879\u4EFB\u52A1\uFF0C\u5B8C\u6210 ${stats.totals.done} \u9879\uFF0C\u5B8C\u6210\u7387 ${rate}%\u3002` + (cats.length ? `\u4EFB\u52A1\u6700\u591A\u7684\u662F\uFF1A${cats.join("\u3001")}\u3002` : "") + (rate >= 80 ? "\u6548\u7387\u5F88\u68D2\uFF0C\u5C0F\u732B\u4E3A\u4F60\u9A84\u50B2\uFF01" : rate >= 50 ? "\u8FDB\u5C55\u4E0D\u9519\uFF0C\u7EE7\u7EED\u4FDD\u6301\u8282\u594F\u3002" : "\u8FD8\u6709\u4E0D\u5C11\u6CA1\u5B8C\u6210\uFF0C\u660E\u5929\u548C\u5C0F\u732B\u4E00\u8D77\u52A0\u6CB9\u5427\u3002");
  }
  return `${stats.totals.total} tasks this period, ${stats.totals.done} done (${rate}% completion).` + (cats.length ? ` Top areas: ${cats.join(", ")}.` : "") + (rate >= 80 ? " Great job \u2014 your cat is proud!" : rate >= 50 ? " Solid progress, keep the rhythm." : " Quite a few left \u2014 let's catch up with your cat tomorrow.");
}
function uid() {
  return "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CATEGORIES,
  PRIORITIES,
  STAGE_META,
  categoryMeta,
  computeStats,
  dateToStr,
  daysBetween,
  derivePet,
  extractTime,
  fallbackSummary,
  isValidDate,
  levelInfo,
  mondayOf,
  monthKeyOf,
  normalizeCategory,
  normalizePriority,
  pad2,
  parseRules,
  resolveDate,
  shiftDays,
  streakOf,
  todayStr,
  uid,
  xpFor
});
