// config.js
window.APP_CONFIG = {
  API_BASE: localStorage.getItem("API_BASE") || "http://127.0.0.1:3001",
};
window.setApiBase = function (v) {
  const val = String(v || "").trim();
  if (!val) return;
  localStorage.setItem("API_BASE", val);
  window.APP_CONFIG.API_BASE = val;
};
