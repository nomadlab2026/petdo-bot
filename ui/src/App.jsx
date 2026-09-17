/**
 * App.jsx —— PetDo · 待办小宠 主组件
 * 3 个 Tab：宠物（默认）/ 任务 / 报告
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import * as Core from "../../shared/petdo-core.js";
import { makeT } from "./i18n.js";
import { Donut, Bars, Bar } from "./charts.jsx";
import "./styles.css";

export default function App({ platform }) {
  // ---- 全局状态 ----
  const [tab, setTab] = useState("pet");
  const [lang, setLang] = useState("zh");
  const [tasks, setTasks] = useState([]);
  const [pet, setPet] = useState(null);
  const [meta, setMeta] = useState(null);
  const [today, setToday] = useState(Core.todayStr());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const t = makeT(lang);

  // ---- 宠物 Tab ----
  const [parseInput, setParseInput] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const [patMsg, setPatMsg] = useState("");

  // ---- 任务 Tab ----
  const [addForm, setAddForm] = useState({
    title: "", categoryId: "work", priority: "normal", due: "",
  });

  // ---- 报告 Tab ----
  const [reportPeriod, setReportPeriod] = useState("week");
  const [reportAnchor, setReportAnchor] = useState(Core.todayStr());
  const [reportStats, setReportStats] = useState(null);
  const [reportSummary, setReportSummary] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  // ---- 初始化 ----
  const refresh = useCallback(async () => {
    try {
      const st = await platform.getState();
      setTasks(st.tasks || []);
      setPet(st.pet);
      setMeta(st.meta);
      setToday(st.today || Core.todayStr());
      setError(null);
    } catch (e) {
      setError(t("common.failed"));
    }
  }, [platform]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const p = await platform.prefs.get();
      if (p.lang) setLang(p.lang);
      if (p.tab) setTab(p.tab);
      await refresh();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- prefs 持久化 ----
  useEffect(() => {
    if (!loading) platform.prefs.set({ lang, tab });
  }, [lang, tab, loading, platform]);

  // ---- 报告数据加载 ----
  useEffect(() => {
    if (tab !== "report") return;
    (async () => {
      setReportLoading(true);
      try {
        const [stats, summary] = await Promise.all([
          platform.getStats(reportPeriod, reportAnchor),
          platform.summarizePeriod(reportPeriod, lang),
        ]);
        setReportStats(stats);
        setReportSummary(summary);
      } catch {
        /* non-fatal */
      }
      setReportLoading(false);
    })();
  }, [tab, reportPeriod, reportAnchor, lang, platform]);

  // ---- 提醒气泡 ----
  const bubbleMsg = (() => {
    if (!pet) return null;
    if (pet.overdue > 0) return `${t("pet.overdue")}（${pet.overdue}）`;
    if (pet.todayTotal > pet.todayDone) return `${t("pet.dueToday")}（${pet.todayDone}/${pet.todayTotal}）`;
    return null;
  })();

  // ---- 窗口标题更新 ----
  useEffect(() => {
    if (pet) {
      const prefix = pet.overdue > 0 ? `⚠️ ` : "";
      platform.setTitle(`${prefix}PetDo · ${pet.petName} L${pet.level}`);
    }
  }, [pet, platform]);

  // ---- 解析自然语言 ----
  const handleParse = async () => {
    const text = parseInput.trim();
    if (!text) return;
    setParsing(true);
    try {
      const r = await platform.parseText(text);
      setDrafts(r.drafts || []);
      if (!r.drafts || r.drafts.length === 0) {
        setVoiceHint(t("pet.noDrafts"));
      }
    } catch {
      setError(t("common.failed"));
    }
    setParsing(false);
  };

  // ---- 添加草稿任务 ----
  const handleAddDraft = async (draft, index) => {
    try {
      await platform.addTask({ ...draft, source: "voice" });
      setDrafts((prev) => prev.filter((_, i) => i !== index));
      await refresh();
    } catch {
      setError(t("common.failed"));
    }
  };

  const handleAddAllDrafts = async () => {
    for (const draft of drafts) {
      try {
        await platform.addTask({ ...draft, source: "voice" });
      } catch { /* continue */ }
    }
    setDrafts([]);
    await refresh();
  };

  // ---- 任务 Tab 表单提交 ----
  const handleAddForm = async (e) => {
    e?.preventDefault();
    const title = addForm.title.trim();
    if (!title) return;
    try {
      await platform.addTask({
        title,
        categoryId: addForm.categoryId,
        priority: addForm.priority,
        due: addForm.due || null,
        source: "manual",
      });
      setAddForm({ title: "", categoryId: "work", priority: "normal", due: "" });
      await refresh();
    } catch {
      setError(t("common.failed"));
    }
  };

  // ---- 任务完成 / 撤销 / 删除 ----
  const handleComplete = async (id) => {
    try {
      await platform.completeTask(id);
      await refresh();
    } catch { setError(t("common.failed")); }
  };
  const handleUncomplete = async (id) => {
    try {
      await platform.uncompleteTask(id);
      await refresh();
    } catch { setError(t("common.failed")); }
  };
  const handleDelete = async (id) => {
    try {
      await platform.deleteTask(id);
      await refresh();
    } catch { setError(t("common.failed")); }
  };

  // ---- 摸猫 ----
  const handlePat = async () => {
    try {
      const r = await platform.patPet();
      setPatMsg(lang === "en" ? r._en : r._zh);
    } catch { /* noop */ }
  };

  // ---- 语音 ----
  const handleVoice = () => {
    if (!platform.voiceSupported) {
      setVoiceHint(t("voice.unsupported"));
      return;
    }
    setVoiceListening(true);
    setVoiceHint(t("voice.listening"));
    platform.startVoice(
      (text) => setParseInput(text),
      (err) => {
        setVoiceListening(false);
        if (err) setVoiceHint(t("voice.unsupported"));
        else {
          setVoiceHint("");
          // 自动解析
          if (parseInput.trim()) handleParse();
        }
      },
      lang
    );
  };

  // ---- 报告翻页 ----
  const shiftAnchor = (dir) => {
    const a = reportAnchor;
    if (reportPeriod === "week") {
      setReportAnchor(Core.shiftDays(a, dir * 7));
    } else if (reportPeriod === "month") {
      const [y, m] = a.split("-").map(Number);
      const d = new Date(y, m - 1 + dir, 1);
      setReportAnchor(Core.dateToStr(d));
    } else {
      const y = Number(a.slice(0, 4)) + dir;
      setReportAnchor(`${y}-${a.slice(5)}`);
    }
  };

  if (loading) return <div className="app"><div className="loading">{t("common.loading")}</div></div>;

  return (
    <div className="app">
      <button className="lang-toggle" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
        {lang === "zh" ? "EN" : "中文"}
      </button>

      {error && <div className="error">{error}</div>}

      <div className="tab-content">
        {tab === "pet" && (
          <PetTab
            t={t} lang={lang} pet={pet} meta={meta} today={today}
            bubbleMsg={bubbleMsg}
            parseInput={parseInput} setParseInput={setParseInput}
            parsing={parsing} onParse={handleParse}
            drafts={drafts} onAddDraft={handleAddDraft} onAddAll={handleAddAllDrafts}
            onDismissDraft={(i) => setDrafts((p) => p.filter((_, x) => x !== i))}
            voiceListening={voiceListening} voiceHint={voiceHint} onVoice={handleVoice}
            patMsg={patMsg} onPat={handlePat}
          />
        )}
        {tab === "tasks" && (
          <TasksTab
            t={t} lang={lang} tasks={tasks} today={today}
            addForm={addForm} setAddForm={setAddForm} onAdd={handleAddForm}
            onComplete={handleComplete} onUncomplete={handleUncomplete} onDelete={handleDelete}
          />
        )}
        {tab === "report" && (
          <ReportTab
            t={t} lang={lang}
            period={reportPeriod} setPeriod={setReportPeriod}
            anchor={reportAnchor} shiftAnchor={shiftAnchor}
            stats={reportStats} summary={reportSummary} loading={reportLoading}
          />
        )}
      </div>

      <nav className="tab-bar">
        <button className={`tab-btn ${tab === "pet" ? "active" : ""}`} onClick={() => setTab("pet")}>
          <span className="tab-icon">🐱</span>{t("tab.pet")}
        </button>
        <button className={`tab-btn ${tab === "tasks" ? "active" : ""}`} onClick={() => setTab("tasks")}>
          <span className="tab-icon">📋</span>{t("tab.tasks")}
        </button>
        <button className={`tab-btn ${tab === "report" ? "active" : ""}`} onClick={() => setTab("report")}>
          <span className="tab-icon">📊</span>{t("tab.report")}
        </button>
      </nav>
    </div>
  );
}

// ===========================================================================
// Pet Tab
// ===========================================================================
function PetTab({ t, lang, pet, meta, bubbleMsg, parseInput, setParseInput, parsing,
  onParse, drafts, onAddDraft, onAddAll, onDismissDraft, voiceListening, voiceHint, onVoice, patMsg, onPat }) {
  if (!pet) return null;
  const stage = Core.STAGE_META[pet.stage] || Core.STAGE_META.kitten;
  const stageLabel = lang === "en" ? stage.en : stage.zh;

  return (
    <>
      <div className="pet-scene">
        {bubbleMsg && <div className="pet-bubble">{bubbleMsg}</div>}
        <CatScene mood={pet.mood} />
        <div className="pet-name">{pet.petName}</div>
        <div className="pet-mood-tag">L{pet.level} · {stageLabel} · {t(`pet.mood.${pet.mood}`)}</div>

        <div className="xp-section">
          <div className="xp-head">
            <span>{t("pet.xp")} {pet.xp}</span>
            <span>{pet.into}/{pet.need}</span>
          </div>
          <div className="xp-bar">
            <div className="xp-fill" style={{ width: `${pet.progress * 100}%` }} />
          </div>
        </div>

        <div className="pet-stats">
          <div className="pet-stat">
            <div className="pet-stat-val">{pet.todayDone}</div>
            <div className="pet-stat-lbl">{t("pet.todayDone")}</div>
          </div>
          <div className="pet-stat">
            <div className="pet-stat-val">{pet.todayTotal}</div>
            <div className="pet-stat-lbl">{t("pet.todayTotal")}</div>
          </div>
          <div className="pet-stat">
            <div className="pet-stat-val">{pet.streak}</div>
            <div className="pet-stat-lbl">{t("pet.streak")}</div>
          </div>
        </div>

        <button className="pat-btn" onClick={onPat}>{t("pet.pat")} 🐾</button>
        {patMsg && <div className="pat-msg">{patMsg}</div>}
      </div>

      <div className="card">
        <div className="quick-add">
          <input
            className="quick-input"
            type="text"
            value={parseInput}
            onChange={(e) => setParseInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onParse(); }}
            placeholder={t("pet.quickAdd")}
            disabled={parsing}
          />
          <button className="voice-btn" onClick={onVoice} disabled={voiceListening}>
            {voiceListening ? "🔴" : "🎙"}
          </button>
          <button className="btn" onClick={onParse} disabled={parsing}>
            {parsing ? "…" : t("pet.parse")}
          </button>
        </div>
        {voiceHint && <div className="voice-hint">{voiceHint}</div>}
      </div>

      {drafts.length > 0 && (
        <div className="draft-list">
          {drafts.length > 1 && (
            <button className="btn secondary" style={{ width: "100%", marginBottom: 8 }} onClick={onAddAll}>
              {t("common.confirm")}（{drafts.length}）
            </button>
          )}
          {drafts.map((d, i) => {
            const cat = Core.categoryMeta(d.categoryId, lang);
            return (
              <div className="draft-card" key={i}>
                <div className="draft-title">{d.title}</div>
                <div className="draft-meta">
                  <span className="chip">{cat.emoji} {lang === "en" ? cat.en : cat.zh}</span>
                  <span className="chip">{t(`tasks.priority.${d.priority}`)}</span>
                  {d.due && <span className="chip">📅 {d.due}</span>}
                  {d.note && <span className="chip">⏰ {d.note}</span>}
                  {d.confidence != null && (
                    <span className="chip">{t("ai.confidence")} {Math.round(d.confidence * 100)}%</span>
                  )}
                </div>
                <div className="draft-actions">
                  <button className="btn sm" onClick={() => onAddDraft(d, i)}>✓ {t("common.confirm")}</button>
                  <button className="btn ghost sm" onClick={() => onDismissDraft(i)}>✕ {t("common.cancel")}</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ===========================================================================
// Cat SVG Scene —— 根据心情渲染小猫
// ===========================================================================
function CatScene({ mood }) {
  // 眼睛/嘴/耳/装饰随 mood 变化
  const eyeShape = {
    excited: <ellipse cx="0" cy="0" rx="8" ry="11" />,
    happy: <ellipse cx="0" cy="0" rx="7" ry="9" />,
    ok: <ellipse cx="0" cy="0" rx="6" ry="8" />,
    sad: <ellipse cx="0" cy="2" rx="6" ry="6" />,
    sleeping: <path d="M-6 0 Q0 -3 6 0" stroke="#3D2E2A" strokeWidth="3" fill="none" strokeLinecap="round" />,
  };

  const mouthShape = {
    excited: <path d="M-8 8 Q0 18 8 8" stroke="#3D2E2A" strokeWidth="3" fill="#FF6F60" strokeLinecap="round" />,
    happy: <path d="M-6 8 Q0 14 6 8" stroke="#3D2E2A" strokeWidth="2.5" fill="none" strokeLinecap="round" />,
    ok: <path d="M-5 8 Q0 10 5 8" stroke="#3D2E2A" strokeWidth="2.5" fill="none" strokeLinecap="round" />,
    sad: <path d="M-6 10 Q0 6 6 10" stroke="#3D2E2A" strokeWidth="2.5" fill="none" strokeLinecap="round" />,
    sleeping: <path d="M-4 9 L4 9" stroke="#3D2E2A" strokeWidth="2.5" fill="none" strokeLinecap="round" />,
  };

  const earTilt = mood === "sad" ? -8 : mood === "sleeping" ? -12 : 0;
  const cheekColor = mood === "excited" ? "#FF6F60" : mood === "happy" ? "#FFAB91" : "#FFD4C4";

  return (
    <svg className="pet-svg" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
      {/* 身体 */}
      <ellipse cx="70" cy="105" rx="38" ry="28" fill="#FF8A65" stroke="#3D2E2A" strokeWidth="2" />
      {/* 左耳 */}
      <g transform={`rotate(${earTilt} 48 38)`}>
        <path d="M48 38 L36 16 L60 30 Z" fill="#FF8A65" stroke="#3D2E2A" strokeWidth="2" strokeLinejoin="round" />
        <path d="M48 34 L42 22 L54 30 Z" fill="#FFD4C4" />
      </g>
      {/* 右耳 */}
      <g transform={`rotate(${-earTilt} 92 38)`}>
        <path d="M92 38 L104 16 L80 30 Z" fill="#FF8A65" stroke="#3D2E2A" strokeWidth="2" strokeLinejoin="round" />
        <path d="M92 34 L98 22 L86 30 Z" fill="#FFD4C4" />
      </g>
      {/* 脸 */}
      <ellipse cx="70" cy="65" rx="38" ry="36" fill="#FF8A65" stroke="#3D2E2A" strokeWidth="2" />
      {/* 脸颊 */}
      <ellipse cx="42" cy="76" rx="8" ry="6" fill={cheekColor} opacity="0.7" />
      <ellipse cx="98" cy="76" rx="8" ry="6" fill={cheekColor} opacity="0.7" />
      {/* 左眼 */}
      <g transform="translate(56 60)">
        {eyeShape[mood]}
        {mood !== "sleeping" && <circle cx="2" cy="-3" r="3" fill="#fff" />}
      </g>
      {/* 右眼 */}
      <g transform="translate(84 60)">
        {eyeShape[mood]}
        {mood !== "sleeping" && <circle cx="2" cy="-3" r="3" fill="#fff" />}
      </g>
      {/* 鼻子 */}
      <path d="M70 72 L64 68 Q70 65 76 68 Z" fill="#3D2E2A" />
      {/* 嘴 */}
      <g transform="translate(70 72)">{mouthShape[mood]}</g>
      {/* 胡须 */}
      <line x1="28" y1="68" x2="44" y2="70" stroke="#3D2E2A" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="28" y1="76" x2="44" y2="76" stroke="#3D2E2A" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="112" y1="68" x2="96" y2="70" stroke="#3D2E2A" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="112" y1="76" x2="96" y2="76" stroke="#3D2E2A" strokeWidth="1.5" strokeLinecap="round" />
      {/* 睡眠 Z */}
      {mood === "sleeping" && (
        <text x="100" y="30" fontSize="14" fill="#8A7A76" fontWeight="bold">Z</text>
      )}
      {/* 兴奋星星 */}
      {mood === "excited" && (
        <>
          <text x="20" y="25" fontSize="12">✨</text>
          <text x="110" y="25" fontSize="12">✨</text>
        </>
      )}
    </svg>
  );
}

// ===========================================================================
// Tasks Tab
// ===========================================================================
function TasksTab({ t, lang, tasks, today, addForm, setAddForm, onAdd, onComplete, onUncomplete, onDelete }) {
  // 分组
  const groups = groupTasks(tasks, today);
  const catMeta = (id) => Core.categoryMeta(id, lang);

  return (
    <>
      <form className="card task-form" onSubmit={onAdd}>
        <div className="form-field">
          <label>{t("tasks.add.title")}</label>
          <input
            type="text"
            value={addForm.title}
            onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
            placeholder={t("tasks.add.title")}
          />
        </div>
        <div className="form-row">
          <div className="form-field">
            <label>{t("tasks.add.category")}</label>
            <select value={addForm.categoryId}
              onChange={(e) => setAddForm({ ...addForm, categoryId: e.target.value })}>
              {Core.CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.emoji} {lang === "en" ? c.en : c.zh}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>{t("tasks.add.priority")}</label>
            <select value={addForm.priority}
              onChange={(e) => setAddForm({ ...addForm, priority: e.target.value })}>
              <option value="high">{t("tasks.priority.high")}</option>
              <option value="normal">{t("tasks.priority.normal")}</option>
              <option value="low">{t("tasks.priority.low")}</option>
            </select>
          </div>
          <div className="form-field">
            <label>{t("tasks.add.due")}</label>
            <input type="date" value={addForm.due}
              onChange={(e) => setAddForm({ ...addForm, due: e.target.value })} />
          </div>
        </div>
        <button type="submit" className="btn">+ {t("tasks.add.save")}</button>
      </form>

      {groups.length === 0 && <div className="task-empty">{t("tasks.empty")}</div>}

      {groups.map((g) => (
        <div className="task-group" key={g.key}>
          <div className="task-group-head">
            {g.label} <span className="task-group-count">{g.tasks.length}</span>
          </div>
          {g.tasks.map((task) => {
            const cm = catMeta(task.categoryId);
            return (
              <div key={task.id} className={`task-item ${task.status === "done" ? "done" : ""}`}>
                <button
                  type="button"
                  className={`task-check ${task.status === "done" ? "done" : ""}`}
                  onClick={() => task.status === "done" ? onUncomplete(task.id) : onComplete(task.id)}
                  aria-label={task.status === "done" ? t("common.done") : t("common.done")}
                >
                  {task.status === "done" ? "✓" : ""}
                </button>
                <div className="task-body">
                  <div className="task-title">{task.title}</div>
                  <div className="task-meta">
                    <span className="task-cat-dot" style={{ background: cm.color }} />
                    {lang === "en" ? cm.en : cm.zh}
                    {task.priority === "high" && <span className="task-priority-high">⚑ {t("tasks.priority.high")}</span>}
                    {task.due && <span>📅 {task.due}</span>}
                  </div>
                </div>
                <div className="task-actions">
                  <button onClick={() => onDelete(task.id)} title={t("common.delete")}>🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** 任务分组 */
function groupTasks(tasks, today) {
  const tomorrow = Core.shiftDays(today, 1);
  const monday = Core.mondayOf(today);
  const weekEnd = Core.shiftDays(monday, 6);
  const groups = [
    { key: "overdue", label: "overdue", filter: (t) => t.status === "todo" && t.due && t.due < today },
    { key: "today", label: "today", filter: (t) => t.due === today || (t.status === "done" && t.completedAt && Core.dateToStr(new Date(t.completedAt)) === today) },
    { key: "tomorrow", label: "tomorrow", filter: (t) => t.due === tomorrow },
    { key: "thisWeek", label: "thisWeek", filter: (t) => t.due && t.due >= tomorrow && t.due <= weekEnd && t.due !== today },
    { key: "later", label: "later", filter: (t) => t.due && t.due > weekEnd },
    { key: "undated", label: "undated", filter: (t) => !t.due && t.status === "todo" },
  ];
  return groups
    .map((g) => ({ ...g, tasks: tasks.filter(g.filter) }))
    .filter((g) => g.tasks.length > 0)
    .map((g) => ({
      key: g.key,
      label: i18nGroupLabel(g.key),
      tasks: g.tasks.sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999"))),
    }));
}

function i18nGroupLabel(key) {
  const labels = {
    overdue: "⚠️ 逾期 / Overdue",
    today: "📍 今天 / Today",
    tomorrow: "明天 / Tomorrow",
    thisWeek: "本周 / This Week",
    later: "以后 / Later",
    undated: "无日期 / No date",
  };
  return labels[key] || key;
}

// ===========================================================================
// Report Tab
// ===========================================================================
function ReportTab({ t, lang, period, setPeriod, anchor, shiftAnchor, stats, summary, loading }) {
  if (loading || !stats) return <div className="loading">{t("common.loading")}</div>;
  if (stats.totals.total === 0) {
    return (
      <>
        <PeriodSelector period={period} setPeriod={setPeriod} t={t} />
        <div className="task-empty">{t("report.empty")}</div>
      </>
    );
  }

  // 分类环图数据
  const donutData = Object.entries(stats.byCategory).map(([id, v]) => {
    const m = Core.categoryMeta(id, lang);
    return { label: `${m.emoji} ${lang === "en" ? m.en : m.zh}`, value: v.total, color: m.color };
  }).sort((a, b) => b.value - a.value);

  // 进度条数据
  const catBars = Object.entries(stats.byCategory).map(([id, v]) => {
    const m = Core.categoryMeta(id, lang);
    return {
      label: `${m.emoji}${lang === "en" ? m.en : m.zh}`,
      value: v.done,
      max: v.total,
      color: m.color,
    };
  }).sort((a, b) => b.max - a.max);

  // 柱状图标签
  const barsData = stats.buckets.map((b, i) => {
    let label;
    if (period === "year") {
      const m = i + 1;
      label = `${m}月`;
    } else if (period === "month") {
      label = String(i + 1);
    } else {
      const d = new Date(b.key + "T00:00:00");
      label = `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return { key: b.key, label, total: b.total, done: b.done };
  }).filter((b) => b.total > 0 || period !== "year");

  const engineLabel = summary?.engine === "rules" ? t("report.rulesSummary") : t("report.aiSummary");
  const engineIcon = summary?.engine === "rules" ? "📐" : "✨";

  return (
    <>
      <PeriodSelector period={period} setPeriod={setPeriod} t={t} />

      <div className="report-nav">
        <button className="nav-btn" onClick={() => shiftAnchor(-1)}>‹</button>
        <div className="report-range">{stats.label}</div>
        <button className="nav-btn" onClick={() => shiftAnchor(1)}>›</button>
      </div>

      {/* 总完成率 */}
      <div className="card">
        <div className="report-section-title">{t("report.completion")}</div>
        <Bar
          value={stats.totals.done}
          max={stats.totals.total}
          label={lang === "en" ? "Overall" : "总体"}
          color="var(--primary)"
        />
        <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-sub)" }}>
          {stats.totals.done} / {stats.totals.total}
        </div>
      </div>

      {/* 分类占比环图 */}
      <div className="card">
        <div className="report-section-title">{t("report.categoryBreakdown")}</div>
        <Donut data={donutData} />
      </div>

      {/* 分分类完成率 */}
      <div className="card">
        <div className="report-section-title">{t("report.completion")} · {lang === "en" ? "by category" : "分分类"}</div>
        {catBars.map((c, i) => (
          <Bar key={i} value={c.value} max={c.max} label={c.label} color={c.color} />
        ))}
      </div>

      {/* 趋势柱状图 */}
      <div className="card">
        <div className="report-section-title">{t("report.trend")}</div>
        <Bars data={barsData} mode={period === "year" ? "month" : "day"} />
      </div>

      {/* AI/规则总结 */}
      {summary?.text && (
        <div className="summary-card">
          <div className="summary-engine">{engineIcon} {engineLabel}</div>
          <div className="summary-text">{summary.text}</div>
        </div>
      )}
    </>
  );
}

function PeriodSelector({ period, setPeriod, t }) {
  return (
    <div className="report-period">
      {["week", "month", "year"].map((p) => (
        <button
          key={p}
          className={`period-btn ${period === p ? "active" : ""}`}
          onClick={() => setPeriod(p)}
        >
          {t(`report.${p}`)}
        </button>
      ))}
    </div>
  );
}
