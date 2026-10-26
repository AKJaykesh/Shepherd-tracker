// Import events from an .ics file (Google Calendar, Apple Calendar and Outlook all export this format).
// Needs calendar.js loaded first (it provides dateVal, addDays, occursOn, mondayOf, loadWeek).
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const dayOnly = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const unesc = s => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

// Wall-clock time in a named time zone (like America/Chicago) to a real moment. Returns null if the zone is unknown.
function zonedToUtc(y, mo, d, h, mi, tz) {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    const off = t => { const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, +x.value])); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t; };
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    return guess - off(guess - off(guess));
  } catch (e) { return null; }
}
function dateInTz(date, tz) {   // YYYY-MM-DD of a moment as seen in the event's own time zone
  try { if (tz) return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date); } catch (e) { /* fall through */ }
  return dateVal(date);
}
function parseLine(line) {
  let q = false, i = -1;
  for (let k = 0; k < line.length; k++) { if (line[k] === '"') q = !q; else if (line[k] === ":" && !q) { i = k; break; } }
  if (i < 0) return null;
  const [name, ...ps] = line.slice(0, i).split(";"), params = {};
  ps.forEach(x => { const [k, ...v] = x.split("="); params[k.toUpperCase()] = v.join("=").replace(/"/g, ""); });
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}
function icsDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { allDay: true, date: new Date(+y, +mo - 1, +d) };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))) };
  if (params && params.TZID) {
    const u = zonedToUtc(+y, +mo, +d, +h, +mi, params.TZID);
    if (u !== null) return { date: new Date(u) };
    return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)), badTz: true };
  }
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)) };
}

function parseICS(text) {
  const blocks = []; let cur = null;
  text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/).forEach(l => {
    if (l === "BEGIN:VEVENT") cur = [];
    else if (l === "END:VEVENT") { if (cur) blocks.push(cur); cur = null; }
    else if (cur && l) { const p = parseLine(l); if (p) cur.push(p); }
  });
  const stats = { found: blocks.length, allDay: 0, cancelled: 0, badTz: 0 }, events = [];
  blocks.forEach(b => {
    const get = n => b.find(x => x.name === n), val = n => (get(n) || { value: "" }).value;
    if (val("STATUS").trim().toUpperCase() === "CANCELLED") { stats.cancelled++; return; }
    const ds = get("DTSTART"), st = ds && icsDate(ds.value, ds.params);
    if (!st) return;
    if (st.allDay) { stats.allDay++; return; }          // the grid shows timed events only
    if (st.badTz) stats.badTz++;
    const de = get("DTEND"), du = get("DURATION");
    let end = de && icsDate(de.value, de.params); end = end && end.date;
    if (!end && du) {
      const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(du.value.trim());
      if (m) end = new Date(+st.date + ((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 6e4);
    }
    if (!end || end <= st.date) end = new Date(+st.date + 36e5);
    const rid = get("RECURRENCE-ID");
    events.push({
      uid: val("UID") || ("e" + events.length + "-" + st.date.getTime()), title: unesc(val("SUMMARY")),
      notes: unesc(val("DESCRIPTION")).slice(0, 500) || null, start: st.date, end, tz: ds.params.TZID || "",
      rrule: get("RRULE") ? get("RRULE").value : null,
      exdates: b.filter(x => x.name === "EXDATE").flatMap(x => x.value.split(",").map(v => icsDate(v, x.params)).filter(Boolean).map(r => r.date)),
      recId: rid ? (icsDate(rid.value, rid.params) || {}).date || null : null,
    });
  });
  return { events, stats };
}

// Map an iCalendar rule onto our repeat options. Returns null when the rule is too complex.
function planSeries(r, start) {
  const n = +(r.INTERVAL || 1), by = r.BYDAY ? r.BYDAY.split(",") : [], first = dayOnly(start);
  if (by.some(x => !DAYS.includes(x)) || r.BYSETPOS || r.BYMONTH || (r.BYMONTHDAY && r.BYMONTHDAY.includes(","))) return null;
  if (r.FREQ === "DAILY" && n === 1 && !by.length) return [{ rec: "daily", first }];
  if (r.FREQ === "WEEKLY" && (n === 1 || n === 2)) {
    if (n === 1 && by.length === 5 && ["MO", "TU", "WE", "TH", "FR"].every(x => by.includes(x))) {
      let f = first; while (f.getDay() % 6 === 0) f = addDays(f, 1);
      return [{ rec: "weekdays", first: f }];
    }
    const monday = addDays(first, -((first.getDay() + 6) % 7));
    return (by.length ? by : [DAYS[first.getDay()]]).map(c => {   // one series per weekday, like Mon/Wed/Fri classes
      let f = addDays(monday, (DAYS.indexOf(c) + 6) % 7); if (f < first) f = addDays(f, 7 * n);
      return { rec: n === 1 ? "weekly" : "biweekly", first: f };
    });
  }
  if (r.FREQ === "MONTHLY" && n === 1 && !by.length && (!r.BYMONTHDAY || +r.BYMONTHDAY === first.getDate())) return [{ rec: "monthly", first }];
  return null;
}

function toRows(events, priv) {
  const cutoff = addDays(dayOnly(new Date()), -30), cutKey = dateVal(cutoff), rows = [], st = { old: 0, simplified: 0, repeating: 0 };
  const overrides = {};
  events.filter(e => e.recId).forEach(e => (overrides[e.uid] = overrides[e.uid] || []).push(e));
  const row = (e, uid, rec, firstDate, until, skip) => {
    const s = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate(), e.start.getHours(), e.start.getMinutes());
    return { ical_uid: uid, title: e.title || "(no title)", notes: e.notes, is_private: priv, start_time: s.toISOString(),
      end_time: new Date(+s + (e.end - e.start)).toISOString(), recurrence: rec, repeat_until: until, skip_dates: skip };
  };
  events.forEach(e => {
    if (e.recId) {                                           // a single changed occurrence of a repeating event
      if (e.end < cutoff) { st.old++; return; }
      rows.push(row(e, e.uid + "#" + e.recId.toISOString(), "none", dayOnly(e.start), null, [])); return;
    }
    const key = d => dateInTz(d, e.tz);
    const skip = [...e.exdates, ...(overrides[e.uid] || []).map(o => o.recId).filter(Boolean)].map(key);
    const rule = e.rrule && Object.fromEntries(e.rrule.split(";").map(p => p.split("=")).filter(p => p[0] && p[1]).map(([k, ...v]) => [k.toUpperCase(), v.join("=")]));
    const plans = rule && planSeries(rule, e.start);
    if (!rule || !plans) {
      if (rule) st.simplified++;
      if (e.end < cutoff) { if (!rule) st.old++; return; }
      rows.push(row(e, e.uid, "none", dayOnly(e.start), null, [])); return;
    }
    let until = null;
    if (rule.UNTIL) { const u = icsDate(rule.UNTIL, {}); until = u ? key(u.date) : null; }
    else if (rule.COUNT) {
      let total = 0;
      for (let d = plans.reduce((m, p) => p.first < m ? p.first : m, plans[0].first), i = 0; i < 3650 && total < +rule.COUNT; d = addDays(d, 1), i++) {
        total += plans.filter(p => occursOn(p.rec, p.first, d)).length;
        if (total >= +rule.COUNT) until = dateVal(d);
      }
    }
    if (until && until < cutKey) { st.old++; return; }
    st.repeating++;
    plans.forEach((p, i) => rows.push(row(e, plans.length > 1 ? e.uid + "#" + i : e.uid, p.rec, p.first, until, skip)));
  });
  return { rows, stats: st };
}

// ----- dialog -----
let parsed = null;
const readText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });

function refreshImport() {
  const sum = $("impsum"); sum.classList.remove("hidden");
  if (!parsed) return;
  const { rows, stats } = toRows(parsed.events, $("imppriv").checked), s = parsed.stats;
  if (!s.found) { sum.textContent = "No events were found in that file. Make sure it is an .ics calendar file."; $("impgo").disabled = true; return; }
  const lines = ["Found " + s.found + " events in the file. " + rows.length + " are ready to import (" + stats.repeating + " repeating)."];
  const skipped = [];
  if (s.allDay) skipped.push(s.allDay + " all-day"); if (s.cancelled) skipped.push(s.cancelled + " cancelled"); if (stats.old) skipped.push(stats.old + " older than 30 days");
  if (skipped.length) lines.push("Skipped: " + skipped.join(", ") + ".");
  if (stats.simplified) lines.push(stats.simplified + " complex repeating events were imported as single events.");
  if (s.badTz) lines.push(s.badTz + " events use a time zone I don\u2019t recognize, so they use your computer\u2019s time zone.");
  sum.textContent = lines.join("\n");
  $("impgo").disabled = !rows.length;
}
$("imp").onclick = () => { parsed = null; $("impfile").value = ""; $("impsum").classList.add("hidden"); $("impgo").disabled = true; $("idlg").showModal(); };
$("impclose").onclick = () => $("idlg").close();
$("imppriv").onchange = refreshImport;
$("impfile").onchange = async () => {
  const f = $("impfile").files[0]; parsed = null; if (!f) return;
  $("impsum").classList.remove("hidden");
  if (f.size > 3e6) { $("impsum").textContent = "That file is over 3 MB. Export one calendar at a time."; $("impgo").disabled = true; return; }
  try { parsed = parseICS(await readText(f)); refreshImport(); }
  catch (e) { $("impsum").textContent = "Could not read that file. Make sure it is an .ics calendar file."; $("impgo").disabled = true; }
};
$("impgo").onclick = async () => {
  const rows = [...new Map(toRows(parsed.events, $("imppriv").checked).rows.map(r => [r.ical_uid, r])).values()];
  if (rows.length > 2000) { $("impsum").textContent = "That is more than 2,000 events. Export a smaller calendar."; return; }
  $("impgo").disabled = true;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from("calendar_events").upsert(rows.slice(i, i + 200), { onConflict: "owner_id,ical_uid" });
    if (error) { $("impsum").textContent = "Import stopped: " + error.message; $("impgo").disabled = false; return; }
  }
  $("idlg").close(); weekStart = mondayOf(new Date()); await loadWeek();
  $("msg").textContent = "Imported " + rows.length + " events.";
};
