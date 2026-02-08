// layout.js - inject header/footer, handle role-based nav and language
async function renderLayout(){
  const userStr = localStorage.getItem("user");
  let user = null;
  try{ user = userStr ? JSON.parse(userStr) : null; }catch{ user=null; }

  // if token exists but no cached user, fetch /api/me
  if (!user && localStorage.getItem("token")){
    try{
      user = await loadMe();
      if (user) localStorage.setItem("user", JSON.stringify(user));
    }catch{}
  }

  const path = (location.pathname.split("/").pop() || "home.html").toLowerCase();
  const active = (file)=> path === file;

  const topbar = `
    <div class="topbar">
      <div class="container">
        <div class="inner">
          <div class="left">
            <span class="pill"><span class="icon">📍</span> <span data-i18n="project_sub"></span></span>
          </div>
          <div class="right">
            <span class="social">
              <a href="#" aria-label="Facebook">f</a>
              <a href="#" aria-label="X">x</a>
              <a href="#" aria-label="Instagram">ig</a>
            </span>
          </div>
        </div>
      </div>
    </div>
  `;

  const navLinks = [
    {href:"home.html", key:"nav_home", icon:"🏠", show:true},
    {href:"map.html", key:"nav_map", icon:"🗺️", show:true},
    {href:"colleges.html", key:"nav_colleges", icon:"🏛️", show:true},
    {href:"student.html", key:"nav_student", icon:"🎓", show: user?.role === "student"},
    {href:"admin.html", key:"nav_admin", icon:"🛡️", show: user?.role === "admin"},
  ].filter(x=>x.show);

  const authLinks = !user ? `
    <a class="btn soft" href="login.html">🔑 <span data-i18n="nav_login"></span></a>
    <a class="btn primary" href="register.html">➕ <span data-i18n="nav_register"></span></a>
  ` : `
    <button class="btn danger" id="btnLogout">⎋ <span data-i18n="nav_logout"></span></button>
  `;

  const header = `
    ${topbar}
    <header class="header">
      <div class="container">
        <div class="inner">
          <a class="brand" href="home.html">
            <div class="badge">🎓</div>
            <div class="title">
              <strong data-i18n="project_title"></strong>
              <span data-i18n="project_sub"></span>
            </div>
          </a>

          <nav class="nav" aria-label="Primary">
            ${navLinks.map(l=>`
              <a href="${l.href}" class="${active(l.href) ? "active":""}">
                <span>${l.icon}</span>
                <span data-i18n="${l.key}"></span>
              </a>
            `).join("")}
            <a class="cta" href="map.html">⭐ <span data-i18n="cta_start"></span></a>
          </nav>

          <div class="actions">
            <button class="btn lang-toggle" id="btnLang">AR / EN</button>
            ${authLinks}
          </div>
        </div>
      </div>
    </header>
  `;

  const footer = `
    <footer class="footer">
      <div class="container">
        <div class="inner">
          <div>
            <div style="font-weight:800; color:var(--navy)" data-i18n="project_title"></div>
            <div class="muted" data-i18n="footer_about"></div>
          </div>
          <div class="links">
            <span class="muted" data-i18n="footer_rights"></span>
            <a href="home.html" data-i18n="nav_home"></a>
            <a href="map.html" data-i18n="nav_map"></a>
            <a href="colleges.html" data-i18n="nav_colleges"></a>
          </div>
        </div>
      </div>
    </footer>
  `;

  document.body.insertAdjacentHTML("afterbegin", header);
  document.body.insertAdjacentHTML("beforeend", footer);

  document.getElementById("btnLang")?.addEventListener("click", ()=>{
    const cur = I18N_getLang();
    I18N_setLang(cur === "ar" ? "en" : "ar");
  });

  document.getElementById("btnLogout")?.addEventListener("click", ()=>{
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    location.href = "login.html";
  });

  applyI18n();
}
document.addEventListener("DOMContentLoaded", renderLayout);
