"""Find grants related to Shepherd and write them to data/grants.json.

Uses the public Grants.gov and SBIR.gov APIs (standard library only, no installs).
Edit KEYWORDS to widen or narrow the search.
"""
import json, sys, urllib.request, datetime, pathlib
from urllib.parse import quote

KEYWORDS = ["livestock", "precision agriculture", "agricultural drone", "unmanned aircraft",
            "animal detection", "computer vision agriculture", "predator", "rancher"]
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "grants.json"
HEADERS = {"User-Agent": "shepherd-grant-finder/1.0", "Content-Type": "application/json"}


def call(url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def iso(s):
    """Turn MM/DD/YYYY or YYYY-MM-DD into YYYY-MM-DD, or '' if unknown."""
    s = (s or "").strip()[:10]
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return ""


def grants_gov(kw):
    res = call("https://api.grants.gov/v1/api/search2",
               {"keyword": kw, "oppStatuses": "forecasted|posted", "rows": 20})
    for h in (res.get("data") or {}).get("oppHits", []):
        yield {"title": h.get("title", ""), "agency": h.get("agency", ""),
               "url": "https://www.grants.gov/search-results-detail/" + str(h.get("id", "")),
               "deadline": iso(h.get("closeDate")), "source": "Grants.gov"}


def sbir_gov(kw):
    res = call("https://api.www.sbir.gov/public/api/solicitations?rows=25&open=1&keyword=" + quote(kw))
    for h in res if isinstance(res, list) else res.get("results", []):
        yield {"title": h.get("solicitation_title", ""), "agency": h.get("agency", ""),
               "url": h.get("sbir_solicitation_link", ""),
               "deadline": iso(h.get("close_date")), "source": "SBIR.gov"}


def main():
    found, ok = {}, 0
    today = datetime.date.today().isoformat()
    for fetch in (grants_gov, sbir_gov):
        for kw in KEYWORDS:
            try:
                for g in fetch(kw):
                    if not g["title"] or not g["url"]:
                        continue
                    if g["deadline"] and g["deadline"] < today:
                        continue
                    item = found.setdefault(g["url"], {**g, "matched": []})
                    if kw not in item["matched"]:
                        item["matched"].append(kw)
                ok += 1
            except Exception as e:
                print(f"{fetch.__name__} '{kw}' failed: {e}", file=sys.stderr)
    if ok == 0:
        sys.exit("Every request failed; leaving grants.json unchanged.")
    grants = sorted(found.values(), key=lambda g: (-len(g["matched"]), g["deadline"] or "9999"))
    for g in grants:
        g["notes"] = "Matched: " + ", ".join(g.pop("matched"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"fetched_at": datetime.datetime.utcnow().isoformat() + "Z",
                               "grants": grants}, indent=2))
    print(f"Wrote {len(grants)} grants to {OUT}")


if __name__ == "__main__":
    main()
