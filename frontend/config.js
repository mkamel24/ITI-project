// config.js
(function () {
  const saved = localStorage.getItem("API_BASE");

  // default depends on where the site is running
  const defaultBase =
    location.hostname === "127.0.0.1" || location.hostname === "localhost"
      ? "http://127.0.0.1:3001"
      : "https://YOUR-BACKEND.onrender.com"; // <-- put your deployed backend here

  window.APP_CONFIG = {
    API_BASE: saved || defaultBase,
  };

  window.setApiBase = function (v) {
    const val = String(v || "").trim().replace(/\/+$/, "");
    if (!val) return;
    localStorage.setItem("API_BASE", val);
    window.APP_CONFIG.API_BASE = val;
  };
})();
