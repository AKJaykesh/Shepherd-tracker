renderNav("grants");
let auto = [], team = [], signedIn = false;

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  kids.forEach(k => n.append(k));
  return n;
}
const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";

function render() {
  const q = $("q").value.toLowerCase(), src = $("src").value;
  const today = new Date().toISOString().slice(0, 10);
  const rows = [...team.map(g => ({ ...g, kind: "team" })), ...auto.map(g => ({ ...g, kind: "auto" }))]
    .filter(g => (!src || g.kind === src) && (!q || JSON.stringify(g).toLowerCase().includes(q)))
    .sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  $("count").textContent = rows.length + " grants";
  const list = $("list");
  list.replaceChildren();
  if (!rows.length) list.append(el("p", { className: "note", textContent: "No grants yet. Add one above, or run the scraper to fill the automatic list." }));
  rows.forEach(g => {
    const d = g.deadline ? new Date(g.deadline + "T00:00") : null;
    const days = d ? Math.ceil((d - new Date(today + "T00:00")) / 864e5) : null;
    const url = safeUrl(g.url);
    const title = url ? el("a", { href: url, target: "_blank", rel: "noopener", textContent: g.title }) : g.title;
    const when = el("div", { className: "when" + (days !== null && days <= 14 ? " soon" : ""),
      textContent: d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "No deadline listed" });
    const meta = [g.agency, g.amount].filter(Boolean).join(" | ");
    const card = el("div", { className: "g " + g.kind },
      el("h3", {}, title), when,
      el("div", { className: "meta", textContent: meta }),
      el("div", { className: "meta" }, g.kind === "team" ? el("span", { className: "tag", textContent: g.status || "found" }) : document.createTextNode("")));
    if (g.notes) card.append(el("p", { textContent: g.notes }));
    if (g.kind === "team" && signedIn) {
      card.append(el("button", { className: "btn quiet", textContent: "Remove", onclick: async () => {
        if (!confirm("Remove this grant?")) return;
        const { error } = await sb.from("team_grants").delete().eq("id", g.id);
        if (error) return alert("Could not remove: " + error.message);
        team = team.filter(t => t.id !== g.id); render();
      } }));
    }
    list.append(card);
  });
}

async function load() {
  try {
    const r = await fetch("data/grants.json", { cache: "no-store" });
    auto = (await r.json()).grants || [];
  } catch (e) { auto = []; }
  if (sb) {
    signedIn = await isEditor();
    $("signedOut").classList.toggle("hidden", signedIn);
    $("signedIn").classList.toggle("hidden", !signedIn);
    const { data, error } = await sb.from("team_grants").select("*");
    if (!error) team = data;
  }
  render();
}

$("addForm").addEventListener("submit", async e => {
  e.preventDefault();
  const row = { title: $("f-title").value.trim(), agency: $("f-agency").value.trim(), url: safeUrl($("f-url").value),
    deadline: $("f-deadline").value || null, amount: $("f-amount").value.trim(), status: $("f-status").value, notes: $("f-notes").value.trim() };
  const { data, error } = await sb.from("team_grants").insert(row).select().single();
  $("addMsg").textContent = error ? "Could not save: " + error.message : "Saved.";
  if (!error) { team.push(data); e.target.reset(); render(); }
});
$("q").addEventListener("input", render);
$("src").addEventListener("change", render);
load();
