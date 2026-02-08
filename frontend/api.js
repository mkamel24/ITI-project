// api.js - unified fetch (supports both {ok:true,data} and raw JSON)
function apiUrl(path){
  const base = (window.APP_CONFIG?.API_BASE || "http://127.0.0.1:3001").replace(/\/+$/,"");
  return base + path;
}
function unwrap(json){
  // supports {ok:true,data:...} and plain values
  if (json && typeof json === "object" && "ok" in json){
    if (json.ok === true && "data" in json) return json.data;
    if (json.ok === false && json.error?.message) throw new Error(json.error.message);
  }
  return json;
}
function getToken(){ return localStorage.getItem("token") || ""; }

async function apiFetch(path, opts={}){
  const headers = Object.assign({"Content-Type":"application/json"}, opts.headers||{});
  const t = getToken();
  if (t) headers["Authorization"] = "Bearer " + t;
  const res = await fetch(apiUrl(path), Object.assign({}, opts, {headers}));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok){
    // try unwrap error
    try{ unwrap(json); } catch(e){ throw e; }
    const msg = (json && json.error && (json.error.message||json.error)) || text || ("HTTP "+res.status);
    throw new Error(msg);
  }
  return unwrap(json);
}
async function loadMe(){
  const t = getToken();
  if (!t) return null;
  try{
    const data = await apiFetch("/api/me");
    return data?.user || data?.data?.user || data?.user || null;
  }catch{
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    return null;
  }
}
