# PetDo · Pet Task Buddy — DoraHacks Submission

**Hackathon:** Anna AI App Builder Program (#2349)
**Team:** Solo developer
**Anna App ID:** 285 · Slug: `petdo`
**Version:** 1.0.0
**Status:** pending_review

---

## What is PetDo?

PetDo is a desktop task-management app where a virtual cat lives in your to-do list. The cat grows, levels up, and changes mood based on your productivity — turning task management from a chore into a companion experience.

**The problem:** Most to-do apps are abandoned within days because a lifeless checklist gives nothing back. PetDo fixes this by making task completion emotionally rewarding: your cat earns XP, levels up from kitten to legend, and cheers you on. Procrastinate, and it gets sad — then sleepy.

**Who it's for:** Anyone who struggles with task consistency — students, professionals, freelancers, and especially people who find gamification motivating but don't want another bloated productivity suite.

---

## Key Features

### 1. Natural-Language Task Capture
Type or speak a sentence like "remind me to send the report tomorrow morning" — AI extracts the title, category, priority, and due date automatically. No forms, no fiddling with dropdowns.

### 2. Virtual Pet Companion
- **5 mood states:** excited, happy, ok, sad, sleeping — driven by your task activity
- **XP & leveling:** high-priority tasks = 15 XP, normal = 10, low = 5, on-time bonus = +5
- **4 growth stages:** Kitten → Junior → Cat → Legend (L1→L10+)
- **Streak tracking:** consecutive days with completed tasks
- **Pet interaction:** pat the cat for mood-appropriate responses

### 3. Three-Tab Interface
- **Pet tab:** Cat scene, mood bubble (overdue/due-today alerts), XP progress bar, today's stats, quick-add input
- **Tasks tab:** Form-based add, grouped list (overdue/today/tomorrow/this week/later/undated), one-tap complete/undo/delete
- **Report tab:** Weekly/monthly/yearly periods with prev/next navigation, category donut chart, per-category completion bars, daily/monthly trend bars, AI-written summary

### 4. Weekly / Monthly / Yearly Reports
- **Category pie chart (donut):** Visual breakdown of where your effort goes across 5 categories (Work, Study, Life, Health, Other)
- **Completion-rate progress bars:** Overall and per-category
- **Trend bar chart:** Daily (week/month) or monthly (year) task volume with done/total stacking
- **AI summary:** LLM-generated period review with encouragement and one actionable suggestion; falls back to rule-based summary when LLM is unavailable

### 5. Bilingual (Chinese / English)
Full UI bilingual with one-tap language toggle. Default is Chinese (the developer's primary language); all Anna-facing review text is in English.

### 6. Voice Input
Standalone preview mode uses Web Speech API. In Anna host mode (where iframe microphone access may be restricted), the UI guides users to use Anna's chat for voice.

---

## How AI Is Used

### LLM Sampling (via Anna's `sampling/createMessage` reverse RPC)
1. **Task parsing:** The Executa plugin sends the user's natural-language input to the LLM with a structured system prompt and `responseFormat: { type: "json_object" }`. The LLM returns structured JSON with title, category, priority, due date, note, and confidence score. Multiple tasks can be extracted from a single message (split by commas or "然后").

2. **Period summaries:** After computing statistics, the plugin sends the aggregated data to the LLM to generate a natural-language report with encouragement and one actionable suggestion.

### Rule-Based Fallback
Both LLM features degrade gracefully:
- Task parsing falls back to a regex-based parser that handles Chinese date words (今天/明天/后天/下周X/X月X号), time extraction, category keyword matching, and priority signals.
- Summaries fall back to a template-based generator that highlights top categories and gives mood-appropriate advice.

### AI Integration Architecture
```
User input → Anna chat (#petdo) or UI input
    ↓
Executa plugin (Node.js, stdio JSON-RPC)
    ↓
sampling/createMessage (reverse RPC to Anna host)
    ↓
JSON response parsed → task drafts / summary text
    ↓
If sampling unavailable → rule-based fallback
```

---

## How It Integrates with Anna

### Anna App Builder Platform
- **Manifest (schema 2):** Declares the app with `required_executas`, `host_api.tools: ["required:*"]`, CSP overrides, and a system prompt addendum that teaches Anna's Agent how to use PetDo.
- **Executa plugin (Node.js):** Zero-dependency stdio JSON-RPC plugin implementing 11 tools: `parse_text`, `add_task`, `complete_task`, `uncomplete_task`, `update_task`, `delete_task`, `list_tasks`, `get_state`, `get_stats`, `summarize_period`, `pet_pat`.
- **APS Cloud Storage:** All task data is stored in Anna's KV store (key prefix `petdo/`), auto-syncing across devices. No account setup, no server, no API keys.
- **SKILL.md:** A coaching skill that teaches Anna's Agent the PetDo workflow: parse → confirm → add, then complete → report XP, and summarize on request.
- **Anna Chat Integration:** When users mention `#petdo` in Anna chat, the Agent uses the plugin tools to capture tasks, and results are appended as chat artifacts.

### Technical Stack
- **Frontend:** React 18 + Vite 5, zero-dependency hand-drawn SVG charts (donut, bars, progress bars)
- **Backend:** Node.js Executa plugin (CJS, zero third-party dependencies)
- **Shared core:** ESM module (`petdo-core.js`) used by both the plugin and the UI for date parsing, category management, pet mechanics, and statistics aggregation
- **CSP-compliant:** Bundle has zero external links (no CDN, no web fonts, no external images)

---

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│  Anna Host (iframe + SDK + Agent)       │
│  ┌───────────────────────────────────┐  │
│  │  PetDo UI (React SPA bundle)      │  │
│  │  ┌─────┐ ┌──────┐ ┌──────┐       │  │
│  │  │ Pet │ │Tasks │ │Report│       │  │
│  │  └──┬──┘ └──┬───┘ └──┬───┘       │  │
│  │     │       │        │            │  │
│  │     └───────┴────────┘            │  │
│  │            │ platform.js          │  │
│  └────────────┼──────────────────────┘  │
│               │ tools.invoke()           │
│  ┌────────────▼──────────────────────┐  │
│  │  Executa Plugin (petdo-task-pet)   │  │
│  │  11 tools · stdio JSON-RPC        │  │
│  │  ┌─────────┐  ┌───────────────┐   │  │
│  │  │ storage │  │ sampling      │   │  │
│  │  │ (KV)    │  │ (LLM)         │   │  │
│  │  └─────────┘  └───────────────┘   │  │
│  └───────────────────────────────────┘  │
│           ↑ reverse RPC                  │
│  ┌────────┴──────────────────────────┐  │
│  │  APS Cloud KV  ·  LLM Provider    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

---

## Demo Script (60–90 seconds)

**[0–10s] Opening — Pet tab**
"Meet your PetDo cat. She lives in your task list and grows when you get things done. Right now she's happy — I finished a task today."

**[10–25s] Natural-language capture**
"Instead of filling out a form, I just type: '明天下午3点开会，然后写周报'. The AI parses this into two tasks with the right dates, categories, and priorities. I confirm, and they're added."

**[25–40s] Task completion & XP**
"I tap to complete the meeting task. My cat earns 20 XP — 15 for high priority, 5 bonus for on-time. The XP bar fills, and she's now excited."

**[40–60s] Reports tab**
"Switch to Reports. This week's donut chart shows my time split across Work, Study, and Life. The progress bars show completion rates per category. The bar chart shows daily task volume. And here's an AI-written summary with a suggestion."

**[60–75s] Period navigation & closing**
"I can navigate to last month or last year for long-term trends. PetDo turns your to-do list into a companion that celebrates your wins and nudges you when you slip. Built on Anna's cloud — no server, no setup."

---

## Avoiding Previous Rejection Pitfalls

This submission addresses three issues identified from a previous app's rejection:
1. **All review-visible text is in English** (app name, tagline, description, changelog, SKILL.md, manifest system prompt addendum)
2. **Zero payment elements** — no Pro tier, no paywall, no simulated checkout
3. **Sampling grant enabled** — the plugin properly declares `sampling/createMessage` in host_capabilities and uses it with `responseFormat: { type: "json_object" }` + `onUnsupported: "json_object"`

---

## Links

- **Anna App URL:** https://anna.partners/apps/petdo (pending review)
- **DoraHacks BUIDL:** https://dorahacks.io/hackathon/2349/buidl
- **App ID:** 285
- **Formal tool_id:** `tool-airamuse-petdo-etxhvhta`
- **Version:** 1.0.0
