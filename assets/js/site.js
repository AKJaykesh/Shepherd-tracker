// Shared by every new page: Supabase connection, editor check, and the top navigation.
const SUPABASE_URL = "https://yleqavphwzydsifqffpy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_S1xW7Ht60NUUej5mH9etrA_ktDt4F1h"; // publishable key, safe in the browser
const configured = !SUPABASE_URL.includes("YOUR-PROJECT");
const sb = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);

// True only for signed-in people listed in the tracker's `editors` table.
async function isEditor() {
  if (!sb) return false;
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return false;
  const r = await sb.rpc("is_editor");
  return r.data === true;
}

// Add a page here to put it in the top bar of every page.
const PAGES = [["index.html", "Tracker", "tracker"], ["calendar.html", "Calendar", "calendar"], ["grants.html", "Grants", "grants"]];
function renderNav(current) {
  const bar = $("top");
  bar.replaceChildren();
  const brand = Object.assign(document.createElement("a"), { className: "brand", href: "index.html", textContent: "Shepherd" });
  bar.append(brand);
  PAGES.forEach(([href, label, key]) => {
    const a = Object.assign(document.createElement("a"), { className: "nav", href, textContent: label });
    if (key === current) a.setAttribute("aria-current", "page");
    bar.append(a);
  });
}
