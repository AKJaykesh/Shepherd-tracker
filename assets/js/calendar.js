renderNav("calendar");

const START_H = 7, END_H = 23, PX = 48;   // grid shows 7am to 11pm
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const pad = n => String(n).padStart(2, "0");
const dateVal = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const timeVal = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
const fmtT = d => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const nameOf = email => email.split("@")[0];
const colorOf = email => "var(--p" + ([...email].reduce((h, c) => h + c.charCodeAt(0), 0) % 5) + ")";
const make = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); kids.forEach(k => n.append(k)); return n; };

let me = null, myEmail = "", weekStart = mondayOf(new Date()), events = [], hidden = new Set(), editing = null;

async function fetchRange(from, to) {
  const { data, error } = await sb.rpc("team_events", { from_ts: from.toISOString(), to_ts: to.toISOString() });
  if (error) { $("msg").textContent = "Could not load events: " + error.message; return []; }
  return data;
}
// Does a repeating event that first happens on day `first` also happen on day `d`?
function occursOn(rec, first, d) {
  if (d < first) return false;
  const n = Math.round((d - first) / 864e5);
  return rec === "daily" || (rec === "weekdays" && d.getDay() % 6 !== 0) || (rec === "weekly" && n % 7 === 0) ||
    (rec === "biweekly" && n % 14 === 0) || (rec === "monthly" && d.getDate() === first.getDate());
}
// Turn repeating events into one entry per occurrence inside [from, to).
function expand(rows, from, to) {
  const out = [];
  rows.forEach(r => {
    if (r.recurrence === "none") { out.push(r); return; }
    const s0 = new Date(r.start_time), dur = new Date(r.end_time) - s0;
    const first = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate());
    const until = r.repeat_until ? new Date(r.repeat_until + "T23:59:59") : null;
    for (let d = new Date(Math.max(first, new Date(from.getFullYear(), from.getMonth(), from.getDate()))); d < to; d = addDays(d, 1)) {
      if (until && d > until) break;
      if (!occursOn(r.recurrence, first, d) || (r.skip_dates || []).includes(dateVal(d))) continue;
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), s0.getHours(), s0.getMinutes());
      out.push({ ...r, start_time: s.toISOString(), end_time: new Date(+s + dur).toISOString(),
        occ_date: dateVal(d), series_start: r.start_time, series_end: r.end_time });
    }
  });
  return out;
}
async function loadWeek() { const to = addDays(weekStart, 7); events = expand(await fetchRange(weekStart, to), weekStart, to); render(); }

function render() {
  const end = addDays(weekStart, 6);
  $("label").textContent = weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " to " +
    end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const owners = [...new Set([myEmail, ...events.map(e => e.owner_email)])].sort();
  const legend = $("legend"); legend.replaceChildren();
  owners.forEach(o => {
    const cb = make("input", { type: "checkbox", checked: !hidden.has(o), onchange: () => { cb.checked ? hidden.delete(o) : hidden.add(o); render(); } });
    legend.append(make("label", {}, cb, make("span", { className: "sw", style: "background:" + colorOf(o) }), nameOf(o) + (o === myEmail ? " (you)" : "")));
  });
  const shown = owners.filter(o => !hidden.has(o));

  const cal = $("cal"); cal.replaceChildren();
  cal.style.setProperty("--hrs", END_H - START_H);
  const todayKey = dateVal(new Date());
  cal.append(make("div", { className: "corner" }));
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    cal.append(make("div", { className: "dayhead" + (dateVal(d) === todayKey ? " today" : ""),
      textContent: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) }));
  }
  const times = make("div", { className: "times" });
  for (let h = START_H; h < END_H; h++) times.append(make("div", { textContent: new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" }) }));
  cal.append(times);

  for (let i = 0; i < 7; i++) {
    const dayStart = addDays(weekStart, i), dayEnd = addDays(weekStart, i + 1);
    const col = make("div", { className: "col" + (dateVal(dayStart) === todayKey ? " today" : "") });
    if ($("freeToggle").checked && shown.length) {
      for (let m = 8 * 60; m < 22 * 60; m += 30) {          // free time is shown from 8am to 10pm
        const s = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, m), en = new Date(+s + 18e5);
        if (en < new Date()) continue;
        const busy = shown.filter(o => events.some(e => e.owner_email === o && new Date(e.start_time) < en && new Date(e.end_time) > s)).length;
        const free = shown.length - busy;
        if (!free) continue;
        const band = make("div", { className: "free" + (busy ? "" : " all"), title: free + " of " + shown.length + " free" });
        band.style.cssText = "top:" + (m - START_H * 60) / 60 * PX + "px;height:" + PX / 2 + "px" +
          (busy ? ";background:color-mix(in srgb,var(--green) " + Math.round(free / shown.length * 14) + "%,transparent)" : "");
        const prev = col.lastChild;
        if (!busy && !(prev && prev.classList.contains("all") && prev.dataset.end === String(m))) band.append(make("span", { textContent: "Everyone free" }));
        band.dataset.end = String(m + 30);
        col.append(band);
      }
    }
    events.filter(e => shown.includes(e.owner_email)).forEach(e => {
      const s = new Date(e.start_time), en = new Date(e.end_time);
      const a = Math.max(s, dayStart), b = Math.min(en, dayEnd);
      const top = Math.max(0, (a - dayStart) / 6e4 - START_H * 60);
      const h = Math.min((END_H - START_H) * 60, (b - dayStart) / 6e4 - START_H * 60) - top;
      if (a >= b || h <= 0) return;
      const w = 100 / shown.length, lane = shown.indexOf(e.owner_email);
      const blk = make("button", { className: "ev", type: "button", title: nameOf(e.owner_email) + ": " + e.title + " " + fmtT(s) + " to " + fmtT(en),
        onclick: () => openDialog(e) }, make("b", { textContent: e.title }), make("span", { textContent: fmtT(s) }));
      blk.style.cssText = "top:" + top / 60 * PX + "px;height:" + Math.max(18, h / 60 * PX) + "px;left:calc(" + lane * w + "% + 1px);width:calc(" + w + "% - 2px);background:" + colorOf(e.owner_email);
      col.append(blk);
    });
    cal.append(col);
  }
}

// ----- add, edit, delete -----
function openDialog(e, prefill) {
  editing = e && e.id ? e : null;
  const mine = !e || !e.id || e.owner_id === me;
  const s = e && e.start_time ? new Date(e.series_start || e.start_time) : (prefill ? prefill.start : new Date());
  const en = e && e.end_time ? new Date(e.series_end || e.end_time) : (prefill ? prefill.end : new Date(+s + 36e5));
  const rep = editing && editing.recurrence !== "none";
  $("dtitle").textContent = !editing ? "New event" : mine ? (rep ? "Edit repeating event" : "Edit event") : nameOf(e.owner_email) + "\u2019s event";
  $("d-title").value = e && e.title || ""; $("d-date").value = dateVal(s);
  $("d-start").value = timeVal(s); $("d-end").value = timeVal(en);
  $("d-notes").value = e && e.notes || ""; $("d-private").checked = !!(e && e.is_private);
  $("d-repeat").value = (e && e.recurrence) || "none"; $("d-until").value = (e && e.repeat_until) || ""; toggleUntil();
  $("dmsg").textContent = rep && mine ? "Changes apply to every event in the series." : "";
  ["d-title", "d-date", "d-start", "d-end", "d-notes", "d-private", "d-repeat", "d-until"].forEach(id => $(id).disabled = !mine);
  $("dsave").classList.toggle("hidden", !mine); $("ddel").classList.toggle("hidden", !editing || !mine);
  $("ddel").textContent = rep ? "Delete series" : "Delete"; $("dskip").classList.toggle("hidden", !(rep && mine));
  $("dlg").showModal();
}

$("dform").addEventListener("submit", async ev => {
  ev.preventDefault();
  const s = new Date($("d-date").value + "T" + $("d-start").value), en = new Date($("d-date").value + "T" + $("d-end").value);
  if (!(en > s)) { $("dmsg").textContent = "End time must be after the start time."; return; }
  const rep = $("d-repeat").value, until = $("d-until").value;
  if (rep !== "none" && until && until < $("d-date").value) { $("dmsg").textContent = "The repeat end date is before the start date."; return; }
  const row = { title: $("d-title").value.trim(), start_time: s.toISOString(), end_time: en.toISOString(),
    notes: $("d-notes").value.trim() || null, is_private: $("d-private").checked,
    recurrence: rep, repeat_until: rep === "none" ? null : (until || null) };
  const q = editing ? sb.from("calendar_events").update(row).eq("id", editing.id) : sb.from("calendar_events").insert(row);
  const { error } = await q;
  if (error) { $("dmsg").textContent = "Could not save: " + error.message; return; }
  $("dlg").close(); weekStart = mondayOf(s); loadWeek();
});
$("ddel").onclick = async () => {
  if (!confirm(editing.recurrence !== "none" ? "Delete the whole series?" : "Delete this event?")) return;
  const { error } = await sb.from("calendar_events").delete().eq("id", editing.id);
  if (error) { $("dmsg").textContent = "Could not delete: " + error.message; return; }
  $("dlg").close(); loadWeek();
};
$("dskip").onclick = async () => {   // hide just this occurrence of a repeating event
  const { error } = await sb.from("calendar_events").update({ skip_dates: [...(editing.skip_dates || []), editing.occ_date] }).eq("id", editing.id);
  if (error) { $("dmsg").textContent = "Could not skip: " + error.message; return; }
  $("dlg").close(); loadWeek();
};
const toggleUntil = () => $("d-until-wrap").classList.toggle("hidden", $("d-repeat").value === "none");
$("d-repeat").onchange = toggleUntil;
$("freeToggle").onchange = render;
$("dclose").onclick = () => $("dlg").close();
$("new").onclick = () => openDialog(null);

// ----- week navigation -----
$("prev").onclick = () => { weekStart = addDays(weekStart, -7); loadWeek(); };
$("next").onclick = () => { weekStart = addDays(weekStart, 7); loadWeek(); };
$("today").onclick = () => { weekStart = mondayOf(new Date()); loadWeek(); };

// ----- find a time everyone checked is free (next 8 days, 8am to 10pm) -----
$("findBtn").onclick = async () => {
  const dur = +$("dur").value, from = new Date();
  const busy = expand(await fetchRange(from, addDays(from, 9)), from, addDays(from, 9)).filter(e => !hidden.has(e.owner_email));
  const out = [];
  for (let d = 0; d < 8 && out.length < 8; d++) {
    const day = addDays(from, d);
    for (let m = 8 * 60; m + dur <= 22 * 60 && out.length < 8; m += 30) {
      const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m), en = new Date(+s + dur * 6e4);
      if (s < from) continue;
      if (!busy.some(e => new Date(e.start_time) < en && new Date(e.end_time) > s)) out.push({ start: s, end: en });
    }
  }
  const box = $("found"); box.replaceChildren();
  if (!out.length) box.append(make("p", { className: "meta", textContent: "No shared free time in the next 8 days." }));
  out.forEach(o => box.append(make("button", { className: "chip", type: "button",
    textContent: o.start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " " + fmtT(o.start),
    onclick: () => openDialog(null, o) })));
};

(async () => {
  if (!(await isEditor())) { $("gate").classList.remove("hidden"); return; }
  const { data } = await sb.auth.getSession();
  me = data.session.user.id; myEmail = data.session.user.email.toLowerCase();
  $("app").classList.remove("hidden");
  loadWeek();
})();
