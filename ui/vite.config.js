import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 构建产物直接输出到 Anna App 的 bundle/ 目录（静态 SPA）。
// base: './' —— bundle 以相对路径加载，兼容 Anna 宿主 /anna-apps/<slug>/... 与独立预览。
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../bundle",
    emptyOutDir: true,
    target: "es2020",
  },
});
