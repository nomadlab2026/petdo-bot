/**
 * charts.jsx —— 零依赖手写 SVG 图表
 * Donut：环图（分类占比）
 * Bars：柱状图（每日/每月趋势）
 * Bar：单进度条（完成率）
 */
import React from "react";

/** 环图（饼图变体）。data: [{label, value, color}]，total=总和 */
export function Donut({ data, size = 180, thickness = 28 }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value || 0), 0);
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const segs = total > 0
    ? data.filter((d) => d.value > 0).map((d) => {
        const frac = d.value / total;
        const len = frac * circ;
        const seg = {
          color: d.color,
          label: d.label,
          value: d.value,
          dash: `${len} ${circ - len}`,
          offset: -offset,
          pct: Math.round(frac * 100),
        };
        offset += len;
        return seg;
      })
    : [];

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* 背景环 */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--chart-bg)" strokeWidth={thickness} />
        {total > 0 && segs.map((s, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={s.dash}
            strokeDashoffset={s.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" className="donut-center-num">
          {total > 0 ? total : "—"}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="donut-center-label">
          {total > 0 ? "tasks" : ""}
        </text>
      </svg>
      {total > 0 && (
        <ul className="donut-legend">
          {segs.map((s, i) => (
            <li key={i}>
              <span className="legend-dot" style={{ background: s.color }} />
              <span className="legend-label">{s.label}</span>
              <span className="legend-val">{s.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 柱状图。data: [{key, label, total, done}]，mode: 'day'|'month' */
export function Bars({ data, mode = "day" }) {
  const maxTotal = Math.max(1, ...data.map((d) => d.total || 0));
  return (
    <div className="bars-wrap">
      <div className="bars-track">
        {data.map((d, i) => {
          const hPct = (d.total || 0) / maxTotal;
          const donePct = d.total > 0 ? (d.done || 0) / d.total : 0;
          const label = mode === "month"
            ? d.label
            : (d.label || "").slice(5);
          return (
            <div className="bar-col" key={i}>
              <div className="bar-stack">
                <div className="bar-total" style={{ height: `${hPct * 100}%` }}>
                  <div className="bar-done" style={{ height: `${donePct * 100}%` }} />
                </div>
              </div>
              <div className="bar-label">{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 单进度条。value/max 0-1，label，color */
export function Bar({ value = 0, max = 1, label, color = "var(--accent)" }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div className="bar-row">
      {label != null && <span className="bar-row-label">{label}</span>}
      <div className="bar-row-track">
        <div className="bar-row-fill" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <span className="bar-row-pct">{Math.round(pct * 100)}%</span>
    </div>
  );
}
