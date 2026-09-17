#!/usr/bin/env node
/**
 * plugin-harness.js — PetDo 插件协议冒烟测试
 * 模拟宿主：spawn 插件子进程，stdin 喂 JSON-RPC 请求；
 * 对插件的反向 RPC（storage/*、sampling/createMessage）用内存桩应答。
 * 期望输出末尾 ALL TESTS PASSED (N assertions)，退出码 0。
 */
"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const PLUGIN = path.join(__dirname, "..", "executas", "petdo-node", "plugin.js");
const MANIFEST_COPY = path.join(__dirname, "..", "executas", "petdo-node", "manifest.json");

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}
function eq(a, b, label) { ok(a === b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ---------------------------------------------------------------------------
// 模拟 APS KV（etag 乐观锁）
// ---------------------------------------------------------------------------
const store = new Map(); // key -> {value, etag}
let etagSeq = 1;
let injectConflictOnce = false; // 下一次 set 若带 if_match 则先拒一次 -32023

function kvGet({ key }) {
  const e = store.get(key);
  return { value: e ? e.value : null, etag: e ? e.etag : null };
}
function kvSet({ key, value, if_match }) {
  const e = store.get(key);
  const cur = e ? e.etag : null;
  if (if_match != null && if_match !== cur) {
    if (injectConflictOnce && if_match === "stale") {
      injectConflictOnce = false;
      return { __error: { code: -32023, message: "precondition failed (injected)" } };
    }
    return { __error: { code: -32023, message: "precondition failed" } };
  }
  if (injectConflictOnce) {
    // 无条件注入：下一次对 tasks/ 的写入先失败一次
    injectConflictOnce = false;
    return { __error: { code: -32023, message: "precondition failed (injected)" } };
  }
  const etag = "e" + etagSeq++;
  store.set(key, { value, etag });
  return { etag };
}
function kvList({ prefix }) {
  return { items: [...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, etag: store.get(k).etag })) };
}

// 模拟 sampling
let samplingMode = "ok"; // ok | reject | none
let llmCalls = 0;
function samplingCreate(params) {
  llmCalls++;
  if (samplingMode === "none") return { __error: { code: -32008, message: "not negotiated" } };
  if (samplingMode === "reject") return { __error: { code: -32009, message: "user denied" } };
  const text = params?.messages?.[0]?.content?.text || "";
  if (/task parser|Message:/i.test(text) || /"tasks"/.test(text)) {
    const m = /Today is (\d{4}-\d{2}-\d{2})/.exec(text);
    const today = m ? m[1] : "2026-09-15";
    return {
      content: { type: "text", text: JSON.stringify({
        tasks: [
          { title: "Write weekly report", category: "work", priority: "high", due: today, note: "15:00", confidence: 0.95 },
          { title: "Buy milk", category: "life", priority: "normal", due: null, note: null, confidence: 0.9 },
        ],
      }) },
      model: "mock", stopReason: "endTurn",
    };
  }
  if (/report writer|Statistics JSON/i.test(text) || /"text"/.test(text)) {
    return { content: { type: "text", text: JSON.stringify({ text: "AI MOCK: You finished 2 of 3 tasks this week. Work dominated. Your cat is proud!" }) }, model: "mock" };
  }
  return { content: { type: "text", text: JSON.stringify({ tasks: [] }) }, model: "mock" };
}

// ---------------------------------------------------------------------------
// 子进程与 RPC 泵
// ---------------------------------------------------------------------------
const child = spawn(process.execPath, [PLUGIN], { stdio: ["pipe", "pipe", "pipe"] });
let stderrBuf = "";
child.stderr.on("data", (d) => { stderrBuf += d.toString(); });

const waiters = []; // {id, resolve}
const reverseQueue = []; // 待处理的反向 RPC（顺序处理）
let rpcSeq = 1;

function pump() {
  if (!reverseQueue.length) return;
  const frame = reverseQueue.shift();
  if (frame.method === "storage/get") replyReverse(frame, kvGet(frame.params || {}));
  else if (frame.method === "storage/set") {
    const r = kvSet(frame.params || {});
    if (r.__error) replyReverseError(frame, r.__error.code, r.__error.message);
    else replyReverse(frame, r);
  } else if (frame.method === "storage/list") replyReverse(frame, kvList(frame.params || {}));
  else if (frame.method === "storage/delete") replyReverse(frame, { deleted: true });
  else if (frame.method === "sampling/createMessage") {
    const r = samplingCreate(frame.params || {});
    if (r.__error) replyReverseError(frame, r.__error.code, r.__error.message);
    else replyReverse(frame, r);
  } else {
    replyReverseError(frame, -32601, `unknown reverse method: ${frame.method}`);
  }
}

function replyReverse(frame, result) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }) + "\n");
  setImmediate(pump);
}
function replyReverseError(frame, code, message) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code, message } }) + "\n");
  setImmediate(pump);
}

let outBuf = "";
child.stdout.on("data", (chunk) => {
  outBuf += chunk.toString();
  let idx;
  while ((idx = outBuf.indexOf("\n")) >= 0) {
    const line = outBuf.slice(0, idx).trim();
    outBuf = outBuf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method) { reverseQueue.push(msg); pump(); }
    else {
      const w = waiters.find((x) => x.id === msg.id);
      if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
    }
  }
});

function request(method, params, timeoutMs = 10000) {
  const id = "req-" + rpcSeq++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${method} id=${id}\nstderr: ${stderrBuf}`)), timeoutMs);
    waiters.push({ id, resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function invoke(tool, args, ctx) {
  return request("invoke", { tool, arguments: args || {}, context: Object.assign({ invoke_id: "inv-" + rpcSeq }, ctx || {}) });
}
function unwrap(res, label) {
  if (res.error) throw new Error(`${label}: ${JSON.stringify(res.error)}`);
  if (!res.result || res.result.success !== true) throw new Error(`${label}: not success: ${JSON.stringify(res.result)}`);
  return res.result.data;
}

// ---------------------------------------------------------------------------
// 测试场景
// ---------------------------------------------------------------------------
const TODAY = new Date();
const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = dateStr(TODAY);
const yesterday = dateStr(new Date(TODAY.getTime() - 86400000));
const tomorrow = dateStr(new Date(TODAY.getTime() + 86400000));

(async () => {
  console.log("场景 A：协议四方法");
  const init = await request("initialize", { protocolVersion: "2.0", clientInfo: { name: "harness", version: "1" }, capabilities: { sampling: {}, fileTransport: false } });
  eq(init.result?.protocolVersion, "2.0", "initialize protocolVersion 2.0");
  ok(init.result?.capabilities?.sampling, "initialize declares sampling capability");

  const desc = await request("describe", {});
  const manifest = desc.result;
  ok(Array.isArray(manifest?.tools) && manifest.tools.length === 11, `describe 11 tools (got ${manifest?.tools?.length})`);
  ok(manifest.host_capabilities?.includes("aps.kv") && manifest.host_capabilities?.includes("llm.sample"), "host_capabilities aps.kv + llm.sample");
  const manifestFile = JSON.parse(fs.readFileSync(MANIFEST_COPY, "utf8"));
  ok(JSON.stringify(manifestFile) === JSON.stringify(manifest), "manifest.json 副本与 describe 完全一致（publish 同步）");

  const health = await request("health", {});
  eq(health.result?.status, "ready", "health ready");

  console.log("场景 B：任务 CRUD + 宠物 XP");
  const add1 = unwrap(await invoke("add_task", { title: "写周报", category: "work", priority: "high", due: today, source: "chat" }), "add_task 1");
  ok(add1.task?.id, "add_task returns id");
  eq(add1.task.priority, "high", "priority high");
  eq(add1.task.due, today, "due today");
  ok(add1.pet && typeof add1.pet.xp === "number", "pet snapshot included");
  ok(Array.isArray(add1.today) && add1.today.length === 1, "today list contains new task");

  const add2 = unwrap(await invoke("add_task", { title: "遛狗", category: "health", due: yesterday }), "add_task 2");
  const add3 = unwrap(await invoke("add_task", { title: "买牛奶", category: "life" }), "add_task 3");

  let lst = unwrap(await invoke("list_tasks", { filter: "today" }), "list today");
  eq(lst.tasks.length, 3, "today = due today + overdue + undated");
  eq(lst.pet.overdue, 1, "overdue count = 1");

  const done = unwrap(await invoke("complete_task", { id: add1.task.id }), "complete high on-time");
  eq(done.task.status, "done", "status done");
  eq(done.pet.gained, 20, "XP = 15(high) + 5(on-time)");
  eq(done.pet.leveledUp, false, "20xp stays level 1 (need 50)");

  // 撤销 → XP 扣回 → 再完成
  const undo = unwrap(await invoke("uncomplete_task", { id: add1.task.id }), "uncomplete");
  eq(undo.pet.xp, 0, "xp deducted to 0");
  const done2 = unwrap(await invoke("complete_task", { id: add1.task.id }), "complete again");
  eq(done2.pet.xp, 20, "xp re-awarded");
  ok(done2.pet.leveledUp === false, "no double level-up on re-complete");

  const upd = unwrap(await invoke("update_task", { id: add3.task.id, title: "买两瓶牛奶", priority: "low" }), "update_task");
  eq(upd.task.title, "买两瓶牛奶", "title updated");
  eq(upd.task.priority, "low", "priority updated");

  console.log("场景 C：规则解析（无 LLM）");
  samplingMode = "none";
  const pr = unwrap(await invoke("parse_text", { text: "明天写周报" }, {}), "parse rules");
  eq(pr.engine, "rules", "engine=rules when sampling unavailable");
  eq(pr.drafts.length, 1, "one draft");
  eq(pr.drafts[0].due, tomorrow, "明天 → tomorrow");
  eq(pr.drafts[0].categoryId, "work", "周报 → work");
  const pr2 = unwrap(await invoke("parse_text", { text: "紧急修好服务器，然后买菜" }, {}), "parse multi");
  ok(pr2.drafts.length >= 2, "multi-task split");

  console.log("场景 D：LLM 采样解析 + 拒绝降级");
  samplingMode = "ok";
  const prl = unwrap(await invoke("parse_text", { text: "meeting with design team at 3pm tomorrow" }, { sampling_token: "tok-123" }), "parse llm");
  eq(prl.engine, "llm", "engine=llm with sampling");
  eq(prl.drafts.length, 2, "llm returns 2 drafts");
  eq(prl.drafts[0].priority, "high", "llm priority");
  eq(llmCalls >= 1, true, "sampling called");
  samplingMode = "reject";
  const prf = unwrap(await invoke("parse_text", { text: "明天交作业" }, { sampling_token: "tok-123" }), "parse fallback");
  eq(prf.engine, "rules", "sampling rejected → rules fallback");

  console.log("场景 E：统计与报告");
  samplingMode = "none";
  const st = unwrap(await invoke("get_stats", { period: "week" }), "get_stats");
  eq(st.stats.totals.total, 3, "3 tasks in this week's range");
  ok(st.stats.byCategory.work && st.stats.byCategory.work.total === 1, "work category counted");
  ok(st.stats.buckets.length === 7, "week has 7 daily buckets");
  const sty = unwrap(await invoke("get_stats", { period: "year" }), "get_stats year");
  eq(sty.stats.buckets.length, 12, "year has 12 monthly buckets");
  const sum = unwrap(await invoke("summarize_period", { period: "week" }), "summarize fallback");
  eq(sum.engine, "rules", "summarize engine=rules without sampling");
  ok(sum.text && sum.text.length > 10, "fallback text generated");
  samplingMode = "ok";
  const suml = unwrap(await invoke("summarize_period", { period: "week", lang: "en" }, { sampling_token: "tok" }), "summarize llm");
  eq(suml.engine, "llm", "summarize engine=llm");
  ok(/AI MOCK/.test(suml.text), "llm report text used");

  console.log("场景 F：etag 冲突重放 + 删除 + pet_pat");
  const st1 = unwrap(await invoke("add_task", { title: "冲突测试" }), "add before conflict");
  // 注入：下一次带 if_match 的写入先拒绝一次 → mutateMonth 应重读重放
  injectConflictOnce = true;
  const addAfter = unwrap(await invoke("add_task", { title: "冲突后任务" }), "add_task under conflict");
  ok(addAfter.task?.id, "add_task succeeded after conflict retry");
  const lst2 = unwrap(await invoke("list_tasks", { filter: "all" }), "list all");
  ok(lst2.tasks.some((t) => t.title === "冲突后任务"), "conflict-retried task persisted");

  const del = unwrap(await invoke("delete_task", { id: st1.task.id }), "delete_task");
  eq(del.deleted.id, st1.task.id, "deleted correct task");
  const nf = await invoke("complete_task", { id: st1.task.id });
  ok(nf.error || nf.result?.success === false, "complete on deleted task errors");

  const pat = unwrap(await invoke("pet_pat", {}), "pet_pat");
  ok(pat.pet && pat._zh && pat._en, "pet_pat returns pet + bilingual messages");

  console.log("场景 G：get_state + 进程长驻");
  const gs = unwrap(await invoke("get_state", {}), "get_state");
  ok(Array.isArray(gs.tasks) && gs.tasks.length >= 4, "get_state returns tasks");
  ok(gs.meta?.schema === 1, "meta initialized");
  ok(typeof gs.pet.level === "number", "pet level present");
  ok(!stderrBuf.includes("fatal"), "no fatal errors in stderr");

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  child.kill();
  if (failed > 0) process.exit(1);
  console.log("ALL TESTS PASSED");
  process.exit(0);
})().catch((e) => {
  console.error("HARNESS FAILED:", e.message);
  child.kill();
  process.exit(1);
});
