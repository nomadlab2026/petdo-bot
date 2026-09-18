/**
 * petdo-core.js —— PetDo 领域核心（ESM，零依赖）
 * 插件（Executa）与 UI 共用：日期、分类、优先级、规则解析、宠物机制、统计聚合。
 */
"use strict";

// ---------------------------------------------------------------------------
// 日期工具
// ---------------------------------------------------------------------------
export function pad2(n) { return String(n).padStart(2, "0"); }
export function dateToStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function todayStr() { return dateToStr(new Date()); }
export function monthKeyOf(dateStr) { return String(dateStr || "").slice(0, 7); }
export function shiftDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return dateToStr(dt);
}
/** 本周周一（周一起始周） */
export function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // Mon=0
  return shiftDays(dateStr, -dow);
}
export function isValidDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00").getTime()); }

/** 相对日期词解析（今天/明天/后天/大后天/昨前天/周X/下周X/X月X号/MM-DD） */
export function resolveDate(text, now) {
  const t = String(text || "");
  const base = dateToStr(now);
  if (/今天|今日|today/i.test(t)) return base;
  if (/明天|明日|tomorrow/i.test(t)) return shiftDays(base, 1);
  if (/后天/.test(t)) return shiftDays(base, 2);
  if (/大后天/.test(t)) return shiftDays(base, 3);
  if (/昨天|昨日|yesterday/i.test(t)) return shiftDays(base, -1);
  // 下周X（周一起始）：周一=下周一本周
  const nextWeek = /(下{1,2})(?:周|星期|礼拜)([一二三四五六日天])/.exec(t);
  if (nextWeek) {
    const mon = shiftDays(mondayOf(base), 7);
    return shiftDays(mon, WD_MAP[nextWeek[2]] ?? 0);
  }
  const wd = /(?:周|星期|礼拜)([一二三四五六日天])/.exec(t);
  if (wd) {
    const mon = mondayOf(base);
    const target = shiftDays(mon, WD_MAP[wd[1]] ?? 0);
    return target < base ? shiftDays(target, 7) : target; // 本周已过的周X归下周
  }
  // 支持 9月19 / 9月19日 / 9/19（"日/号"可省略）
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
const WD_MAP = { "一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6 };

// ---------------------------------------------------------------------------
// 时间工具（HH:MM，与桌面版同源）
// ---------------------------------------------------------------------------
const TIME_CN_RE = /(上午|早上|凌晨|中午|下午|晚上|傍晚)?\s*(\d{1,2})\s*[点时]\s*(?:(\d{1,2})\s*分)?\s*钟?/;
const TIME_CN_RE_G = new RegExp(TIME_CN_RE.source, "g");

/** 从文本提取时间（HH:MM）。支持 "下午3点"→"15:00"、"10:30"、"晚上8点30分"→"20:30" */
export function extractTime(text) {
  const t = String(text || "");
  // 直接 HH:MM / H:MM（兼容全角冒号）
  const direct = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(t);
  if (direct) {
    const h = +direct[1], m = +direct[2];
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad2(h)}:${pad2(m)}`;
  }
  const m = TIME_CN_RE.exec(t);
  if (!m) return null;
  let hour = +m[2];
  const minute = m[3] ? +m[3] : 0;
  const prefix = m[1];
  if (prefix) {
    if (/下午|晚上|傍晚/.test(prefix)) {
      if (hour < 12) hour += 12; // 下午3点 → 15:00
    } else if (prefix === "中午") {
      if (hour !== 12) hour += 12; // 中午1点 → 13:00
    }
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${pad2(hour)}:${pad2(minute)}`;
}

// ---------------------------------------------------------------------------
// 分类 / 优先级
// ---------------------------------------------------------------------------
export const CATEGORIES = [
  { id: "work",   zh: "工作", en: "Work",    emoji: "💼", color: "#5B8DEF" },
  { id: "study",  zh: "学习", en: "Study",   emoji: "📚", color: "#9B7EDE" },
  { id: "life",   zh: "生活", en: "Life",    emoji: "🏠", color: "#4CAF8D" },
  { id: "health", zh: "健康", en: "Health",  emoji: "🏃", color: "#E67E22" },
  { id: "other",  zh: "其他", en: "Other",   emoji: "📌", color: "#8A94A6" },
];
export function categoryMeta(id, lang = "zh") {
  const c = CATEGORIES.find((x) => x.id === id);
  if (!c) return { id: "other", zh: "其他", en: "Other", emoji: "📌", color: "#8A94A6" };
  return c;
}
export function normalizeCategory(id) {
  const c = CATEGORIES.find((x) => x.id === String(id || "").toLowerCase().trim());
  return c ? c.id : "other";
}
export const PRIORITIES = ["high", "normal", "low"];
export function normalizePriority(p) { return PRIORITIES.includes(p) ? p : "normal"; }

// ---------------------------------------------------------------------------
// 分类关键词（规则解析兜底）
// ---------------------------------------------------------------------------
const CAT_HINTS = [
  ["health", /健身|跑步|游泳|运动|锻炼|散步|瑜伽|体检|吃药|吃药|看病|复诊|疫苗|早睡|journal|gym|run|workout|doctor|medicine/i],
  ["study",  /学习|复习|背|读书|看书|上课|作业|论文|考试|单词|课程|网课|笔记|study|read|homework|exam|course|review/i],
  ["work",   /工作|开会|会议|报告|周报|日报|邮件|汇报|方案|需求|上线|发版|代码|评审|客户|面试|offer|deadline|meeting|report|email|review|deploy|code|standup/i],
  ["life",   /买菜|做饭|洗衣|打扫|缴费|水电|房租|快递|取件|理发|购物|囤货|接|送|办证|银行|保险|买菜|垃圾/i],
];

// ---------------------------------------------------------------------------
// 规则解析：一句话 → 任务草稿
// ---------------------------------------------------------------------------
const PRIORITY_HIGH = /紧急|马上|立刻|尽快|重要|优先|asap|urgent|important/i;
const PRIORITY_LOW = /不急|有空|顺便|低优先|不着急|有空再|someday|low priority|whenever/i;

/** 生成任务草稿（可多条，逗号/换行分隔）。LLM 不可用时的兜底。 */
export function parseRules(text, now = new Date()) {
  const raw = String(text || "").trim();
  if (!raw) return { drafts: [], engine: "rules" };
  // 无日期词时才按标点拆多条；含日期词整体一条（日期词可能被标点打断）
  const parts = /[，,；;\n]+/.test(raw) && !resolveDate(raw, now)
    ? raw.split(/[，,；;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
    : [raw];
  const drafts = [];
  for (const seg of parts) {
    const due = resolveDate(seg, now);
    const timeNote = extractTime(seg);
    let title = seg
      .replace(/^(帮我|请|记得|提醒我|我要?|需要|添加任务|新增任务|加个?任务|记一笔|然后|接着|还有|再|add task|remind me to|please)\s*/i, "")
      .replace(/^(把|将)\s*/, "");
    if (due) {
      title = title
        .replace(/(大)?后天|今天|今日|明天|明日|昨天|昨日/g, "")
        .replace(/(下{1,2}|本)?(周|星期|礼拜)[一二三四五六日天]/g, "")
        .replace(/\d{1,2}\s*(?:月|[\/])\s*\d{1,2}\s*[日号]?/g, "")
        .replace(/\d{4}-\d{1,2}-\d{1,2}/g, "");
    }
    if (timeNote) title = title.replace(TIME_CN_RE_G, "").replace(/\d{1,2}\s*[:：]\s*\d{2}/g, "");
    title = title
      .replace(/(紧急|重要|优先|不急|不着急|有空再|顺便|asap|urgent|important)/gi, "")
      .replace(/(加上?任务|安排(一下)?|加上?|的?任务)$/g, "")
      .replace(/^[，,、。.\s]+|[，,、。.\s]+$/g, "")
      .trim();
    if (!title) title = seg.trim().slice(0, 80);
    let categoryId = "other";
    for (const [cat, re] of CAT_HINTS) { if (re.test(seg)) { categoryId = cat; break; } }
    const priority = PRIORITY_HIGH.test(seg) ? "high" : PRIORITY_LOW.test(seg) ? "low" : "normal";
    const signal = (due ? 1 : 0) + (categoryId !== "other" ? 1 : 0) + (priority !== "normal" ? 1 : 0);
    drafts.push({
      title: title.slice(0, 80),
      categoryId,
      priority,
      due: due || null,
      note: timeNote ? (zhOrEn(seg) ? `${timeNote} 提醒` : `remind at ${timeNote}`) : null,
      confidence: signal === 0 ? 0.5 : signal === 1 ? 0.65 : 0.8,
    });
  }
  return { drafts, engine: "rules" };
}
function zhOrEn(s) { return /[\u4e00-\u9fff]/.test(s); }

// ---------------------------------------------------------------------------
// 宠物机制
// ---------------------------------------------------------------------------
export function xpFor(task) {
  const base = task.priority === "high" ? 15 : task.priority === "low" ? 5 : 10;
  const onTime = task.due && task.completedAt
    ? dateToStr(new Date(task.completedAt)) <= task.due
    : false;
  return base + (onTime ? 5 : 0);
}

/** 等级：升到下一级需要 50*level XP（累计）。 */
export function levelInfo(xp) {
  let level = 1, acc = 0;
  while (xp >= acc + 50 * level) { acc += 50 * level; level += 1; }
  const into = xp - acc;
  const need = 50 * level;
  const stage = level <= 2 ? "kitten" : level <= 5 ? "junior" : level <= 9 ? "cat" : "legend";
  return { level, into, need, stage, progress: Math.min(1, into / need) };
}
export const STAGE_META = {
  kitten: { zh: "奶猫", en: "Kitten" },
  junior: { zh: "少年猫", en: "Junior" },
  cat:    { zh: "成猫", en: "Cat" },
  legend: { zh: "传奇猫", en: "Legend" },
};

export function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00").getTime();
  const b = new Date(toStr + "T00:00:00").getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** 连续有完成任务的天数（含今天或昨天才算连续中）。 */
export function streakOf(doneDates, today) {
  const set = new Set(doneDates);
  if (!set.size) return 0;
  let start = set.has(today) ? today : shiftDays(today, -1);
  if (!set.has(start)) return 0;
  let streak = 0, cur = start;
  while (set.has(cur)) { streak += 1; cur = shiftDays(cur, -1); }
  return streak;
}

/** 心情与状态汇总。tasks: 全部任务数组；pet: {xp, createdAt}; meta: {petName, createdAt} */
export function derivePet(tasks, pet, meta, now = new Date()) {
  const today = todayStr();
  const todo = tasks.filter((t) => t.status === "todo");
  const doneDates = tasks.filter((t) => t.status === "done" && t.completedAt)
    .map((t) => dateToStr(new Date(t.completedAt)));
  const todayDone = doneDates.filter((d) => d === today).length;
  const todayTotal = tasks.filter((t) => {
    if (t.status === "done") return t.completedAt && dateToStr(new Date(t.completedAt)) === today;
    return !t.due || t.due <= today; // 今日到期 + 逾期 + 无日期待办
  }).length;
  const overdue = todo.filter((t) => t.due && t.due < today).length;
  const lastActive = doneDates.length ? doneDates.sort().slice(-1)[0]
    : meta?.createdAt ? dateToStr(new Date(meta.createdAt)) : today;
  const idleDays = daysBetween(lastActive, today);
  const streak = streakOf(doneDates, today);

  let score = 30
    + Math.min(45, todayDone * 15)
    + Math.min(30, streak * 4)
    - Math.min(48, overdue * 12)
    - Math.min(40, idleDays * 8);
  score = Math.max(0, Math.min(100, score));

  let mood;
  if (idleDays >= 3 && todayDone === 0 && overdue === 0) mood = "sleeping";
  else if (score >= 80) mood = "excited";
  else if (score >= 55) mood = "happy";
  else if (score >= 30) mood = "ok";
  else mood = "sad";

  const xp = Math.max(0, pet?.xp ?? 0);
  return {
    xp, ...levelInfo(xp),
    petName: meta?.petName || "Mochi",
    mood, score, overdue, todayDone, todayTotal, streak, idleDays, lastActive,
  };
}

// ---------------------------------------------------------------------------
// 统计聚合（周 / 月 / 年）
// ---------------------------------------------------------------------------
/**
 * @param {Array} tasks 全部任务
 * @param {'week'|'month'|'year'} period
 * @param {string} anchor 锚点日期 YYYY-MM-DD（默认今天）
 * @returns {{label, rangeStart, rangeEnd, buckets:[{key,label,total,done}], byCategory:{catId:{total,done}}, totals:{total,done,rate}}}
 */
export function computeStats(tasks, period, anchor) {
  const base = isValidDate(anchor) ? anchor : todayStr();
  let start, end, bucketKey;
  if (period === "week") {
    start = mondayOf(base); end = shiftDays(start, 6);
    bucketKey = (d) => d; // 每天一格
  } else if (period === "month") {
    const [y, m] = base.split("-").map(Number);
    start = `${y}-${pad2(m)}-01`;
    end = dateToStr(new Date(y, m, 0)); // 当月最后一天
    bucketKey = (d) => d;
  } else {
    const y = Number(base.slice(0, 4));
    start = `${y}-01-01`; end = `${y}-12-31`;
    bucketKey = (d) => d.slice(0, 7); // 每月一格
  }

  const inRange = tasks.filter((t) => {
    const d = t.status === "done" && t.completedAt
      ? dateToStr(new Date(t.completedAt))
      : (t.due || t.createdAt?.slice(0, 10) || base);
    return d >= start && d <= end;
  });

  // buckets
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
      done: items.filter((t) => t.status === "done" && dateToStr(new Date(t.completedAt)) <= key).length,
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
    period, anchor: base,
    rangeStart: start, rangeEnd: end,
    label: period === "week" ? `${start} ~ ${end}`
      : period === "month" ? start.slice(0, 7)
      : start.slice(0, 4),
    buckets, byCategory,
    totals: { total, done, rate: total ? done / total : 0 },
  };
}
/** 任务在统计里归属的日期（完成日优先，其次到期日，再其次创建日） */
function bucketDateOf(t, base) {
  if (t.status === "done" && t.completedAt) return dateToStr(new Date(t.completedAt));
  if (t.due) return t.due;
  return t.createdAt ? String(t.createdAt).slice(0, 10) : base;
}

// ---------------------------------------------------------------------------
// 规则版周期文案（LLM 不可用时 summarize_period 的兜底）
// ---------------------------------------------------------------------------
export function fallbackSummary(stats, lang = "zh") {
  const zh = lang !== "en";
  const cats = Object.entries(stats.byCategory)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 3)
    .map(([id, v]) => {
      const m = categoryMeta(id, zh ? "zh" : "en");
      const name = zh ? m.zh : m.en;
      const rate = v.total ? Math.round((v.done / v.total) * 100) : 0;
      return zh ? `${m.emoji}${name} ${v.total} 项（完成 ${rate}%）` : `${m.emoji}${name} ${v.total} (${rate}% done)`;
    });
  const rate = Math.round(stats.totals.rate * 100);
  if (zh) {
    return `本期共 ${stats.totals.total} 项任务，完成 ${stats.totals.done} 项，完成率 ${rate}%。`
      + (cats.length ? `任务最多的是：${cats.join("、")}。` : "")
      + (rate >= 80 ? "效率很棒，小猫为你骄傲！" : rate >= 50 ? "进展不错，继续保持节奏。" : "还有不少没完成，明天和小猫一起加油吧。");
  }
  return `${stats.totals.total} tasks this period, ${stats.totals.done} done (${rate}% completion).`
    + (cats.length ? ` Top areas: ${cats.join(", ")}.` : "")
    + (rate >= 80 ? " Great job — your cat is proud!" : rate >= 50 ? " Solid progress, keep the rhythm." : " Quite a few left — let's catch up with your cat tomorrow.");
}

// 小型 uuid（无依赖）
export function uid() {
  return "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
