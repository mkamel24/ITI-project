// i18n.js - simple bilingual AR/EN + RTL/LTR
const I18N = {
  ar: {
    project_title: "منصة اختيار كلية الهندسة",
    project_sub: "اختيار أنسب كلية هندسة لطلاب الثانوية العامة داخل مصر",
    nav_home: "الرئيسية",
    nav_map: "الخريطة",
    nav_colleges: "الكليات",
    nav_student: "لوحة الطالب",
    nav_admin: "لوحة الإدارة",
    nav_login: "تسجيل الدخول",
    nav_register: "تسجيل جديد",
    nav_logout: "تسجيل خروج",
    cta_start: "ابدأ الآن",
    footer_rights: "© جميع الحقوق محفوظة",
    footer_about: "مشروع نظم المعلومات الجغرافية لاختيار كلية الهندسة",
    home_title: "اختيار أنسب كلية هندسة أصبح أسهل",
    home_desc: "قارن بين كليات الهندسة، اعرف الحدود الدنيا، واحسب المسافات والزمن من موقعك إلى الكلية باستخدام الخرائط.",
    feat_1_t: "مقارنة الكليات",
    feat_1_d: "عرض تفاصيل الكليات والحد الأدنى والمصاريف والسعة.",
    feat_2_t: "خريطة تفاعلية",
    feat_2_d: "اختيار الكلية ومحطة الباص ورسم المسار وقياس الوقت.",
    feat_3_t: "حفظ اختياراتك",
    feat_3_d: "احتفظ باختياراتك في لوحة الطالب وراجعها لاحقًا.",
    auth_login: "تسجيل الدخول",
    auth_register: "إنشاء حساب",
    auth_forgot: "نسيت كلمة المرور",
    auth_reset: "إعادة تعيين كلمة المرور",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    password2: "تأكيد كلمة المرور",
    full_name: "الاسم الكامل",
    role: "النوع",
    role_student: "طالب",
    role_admin: "إدارة",
    btn_submit: "إرسال",
    btn_login: "دخول",
    btn_google: "الدخول باستخدام Google",
    btn_send_code: "إرسال كود",
    code: "الكود",
    new_password: "كلمة مرور جديدة",
    map_title: "الخريطة والاختيار",
    map_desc: "اختر الكلية ومحطة الباص، احسب المسار واحفظ اختيارك.",
    backend_url: "Backend URL",
    quick_search: "بحث سريع",
    choose_college: "اختر الكلية",
    choose_hub: "اختر محطة الباص",
    speed: "السرعة (كم/س)",
    btn_zoom: "تكبير على المختار",
    btn_nearest: "اقتراح أقرب محطة",
    btn_route: "إظهار المسار",
    btn_clear: "مسح المسار",
    btn_refresh: "تحديث",
    btn_save: "حفظ الاختيار",
    selected_college: "الكلية المختارة",
    selected_hub: "المحطة المختارة",
    distance_km: "المسافة (كم)",
    time_min: "الوقت (دقيقة)",
  },
  en: {
    project_title: "Engineering College Finder",
    project_sub: "Web application to choose the best engineering college in Egypt",
    nav_home: "Home",
    nav_map: "Map",
    nav_colleges: "Colleges",
    nav_student: "Student Dashboard",
    nav_admin: "Admin Dashboard",
    nav_login: "Login",
    nav_register: "Register",
    nav_logout: "Logout",
    cta_start: "Get Started",
    footer_rights: "© All rights reserved",
    footer_about: "GIS project for selecting an engineering college",
    home_title: "Choosing the right engineering college is now easier",
    home_desc: "Compare colleges, check minimum scores, and calculate distance & time to your chosen college using maps.",
    feat_1_t: "Compare Colleges",
    feat_1_d: "View details, minimum score, fees, and capacity.",
    feat_2_t: "Interactive Map",
    feat_2_d: "Pick a college and a bus hub, draw the route and time.",
    feat_3_t: "Save Your Choices",
    feat_3_d: "Keep choices in your dashboard and review anytime.",
    auth_login: "Login",
    auth_register: "Create Account",
    auth_forgot: "Forgot Password",
    auth_reset: "Reset Password",
    email: "Email",
    password: "Password",
    password2: "Confirm Password",
    full_name: "Full Name",
    role: "Role",
    role_student: "Student",
    role_admin: "Admin",
    btn_submit: "Submit",
    btn_login: "Login",
    btn_google: "Continue with Google",
    btn_send_code: "Send Code",
    code: "Code",
    new_password: "New Password",
    map_title: "Map & Selection",
    map_desc: "Pick a college and bus hub, compute route, and save your choice.",
    backend_url: "Backend URL",
    quick_search: "Quick search",
    choose_college: "Choose College",
    choose_hub: "Choose Bus Hub",
    speed: "Speed (km/h)",
    btn_zoom: "Zoom to selected",
    btn_nearest: "Suggest nearest hub",
    btn_route: "Show route",
    btn_clear: "Clear route",
    btn_refresh: "Refresh",
    btn_save: "Save choice",
    selected_college: "Selected college",
    selected_hub: "Selected hub",
    distance_km: "Distance (km)",
    time_min: "Time (min)",
  }
};

function getLang(){
  return localStorage.getItem("lang") || "ar";
}
function setLang(lang){
  const l = (lang === "en") ? "en" : "ar";
  localStorage.setItem("lang", l);
  document.documentElement.lang = l;
  document.documentElement.dir = (l === "ar") ? "rtl" : "ltr";
  applyI18n();
}
function t(key){
  const lang = getLang();
  return (I18N[lang] && I18N[lang][key]) || I18N.ar[key] || key;
}
function applyI18n(){
  const lang = getLang();
  document.documentElement.lang = lang;
  document.documentElement.dir = (lang === "ar") ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.getAttribute("data-i18n");
    const val = t(key);
    if (el.hasAttribute("data-i18n-placeholder")){
      el.setAttribute("placeholder", val);
    }else{
      el.textContent = val;
    }
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el=>{
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
}
document.addEventListener("DOMContentLoaded", ()=>applyI18n());
window.I18N_T = t;
window.I18N_setLang = setLang;
window.I18N_getLang = getLang;
