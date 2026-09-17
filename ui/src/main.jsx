import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { createPlatform } from "./platform.js";

// 独立预览模式才需要 viewport meta（Anna 移动壳会自己注入，manifest/HTML 里不写）
if (!new URLSearchParams(location.search).has("wid")) {
  const meta = document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1, viewport-fit=cover";
  document.head.appendChild(meta);
}

createPlatform().then((platform) => {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App platform={platform} />
    </React.StrictMode>
  );
});
