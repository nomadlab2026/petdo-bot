# PetDo · 待办小宠

Anna App Builder Program 黑客松参赛项目。

一只住在任务清单里的电子小猫——记下每天的事，AI 把一句话变成任务；完成任务喂猫升级，拖延让猫难过。周/月/年报告用饼图（分类占比）+ 进度条（完成率）+ AI 洞察。

## 目录结构

```
.
├── manifest.json          # Anna App 清单（schema 2）
├── app.json               # App 元数据 + bundled_executas
├── skills/
│   └── petdo-coach/
│       └── SKILL.md       # Agent 行为指引（英文）
├── shared/
│   └── petdo-core.js      # 领域核心（ESM，零依赖：日期/分类/规则解析/宠物/统计）
├── executas/
│   └── petdo-node/
│       ├── plugin.js      # JSON-RPC 插件（stdio，零第三方依赖）
│       ├── executa.json   # Executa 配置
│       ├── package.json    # npm 发布配置
│       └── manifest.json  # describe 副本（publish 同步用）
├── ui/
│   ├── index.html         # SPA 入口（不写 viewport meta）
│   ├── vite.config.js     # Vite 构建配置（outDir=../bundle）
│   ├── package.json       # React 18 + Vite 5
│   ├── public/
│   │   └── icon.svg       # 应用图标（小猫）
│   └── src/
│       ├── main.jsx       # React 入口（独立模式注入 viewport）
│       ├── App.jsx        # 主组件（3 Tab：宠物/任务/报告）
│       ├── platform.js    # 运行时适配层（Anna SDK / standalone）
│       ├── charts.jsx     # 手写 SVG 图表（Donut/Bars/Bar）
│       ├── i18n.js       # 双语字典（zh/en）
│       └── styles.css     # 视觉系统
├── tests/
│   └── plugin-harness.js  # 插件协议测试（48 断言）
└── bundle/                # 构建产物（git-ignored）
```

## 本地开发

### 环境要求
- Node.js 22+
- npm 10+
- `@anna-ai/cli` 全局安装（`npm i -g @anna-ai/cli`）

### 安装依赖
```bash
cd ui
npm install
```

### 构建前端
```bash
npm run build
# 产物输出到 ../bundle/（index.html + assets/ + icon.svg）
```

### 运行测试
```bash
# 插件协议测试（48 断言）
node tests/plugin-harness.js
```

### 严格校验
```bash
# Anna App schema 校验
anna-app validate --strict
```

### 本地预览
```bash
cd ui
npm run preview
# 打开 http://localhost:4173/
```

## 关键约定

- **CSP**：bundle 零外链（无 CDN/字体/图片外链），script-src 'self'
- **存储**：APS KV，key 前缀 `petdo/`，按月分片（`petdo/tasks/YYYY-MM`）
- **LLM**：插件反向 RPC `sampling/createMessage`，不可用时降级为规则解析
- **双语**：zh/en，默认 zh；审核可见外围文案全英文
- **移动端**：不自带 viewport meta（Anna 移动壳注入），safe-area CSS 变量，触控 ≥44px
