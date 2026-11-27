#!/usr/bin/env python3
"""일정 자료 만들기 — `data/calendar.json`.

원본 앱의 일정 탭(`CalendarPane.kt` + `net/CalendarFeed.kt` + `core/UsCalendar.kt`)은
  ① 나스닥 공개 캘린더(경제지표·실적, 키 없음)를 날짜별로 받고
  ② 앱에 든 손글 일정(`assets/us_calendar.json` — 설명·출처·왜 중요한지)을 함께 보여 준다.
웹은 정적 사이트라 날짜별 실시간 호출 대신 **앞뒤 범위를 미리 받아** 한 파일로 둔다.

  python3 tools/make_calendar.py              # 오늘-10일 ~ 오늘+40일
  python3 tools/make_calendar.py --back 14 --ahead 60
"""
import argparse
import json
import os
import re
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KST = timezone(timedelta(hours=9))
APP = "/workspace/scratch/st18-src/st18-rb25/app/src/main/assets"

US_ONLY = False
HIGH = ["fomc", "interest rate", "rate decision", "cpi", "ppi", "pce",
        "nonfarm", "payrolls", "unemployment rate", "고용보고서"]
MID = ["housing", "retail sales", "consumer confidence", "sentiment", "gdp", "pmi", "inflation"]


def fetch(url, tries=2):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "application/json,text/plain,*/*"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.8 * (i + 1))
    raise last


def clean(s):
    if s is None:
        return ""
    t = str(s).replace("&nbsp;", " ").strip()
    return "" if t in ("", "N/A", "--") else t


def strip_html(s):
    return re.sub(r"<[^>]+>", " ", clean(s)).strip()


def kst_from_gmt(gmt):
    m = re.match(r"^(\d{1,2}):(\d{2})$", clean(gmt))
    if not m:
        return ""
    h, mi = int(m.group(1)), int(m.group(2))
    if not (0 <= h <= 23 and 0 <= mi <= 59):
        return ""
    total = (h * 60 + mi + 9 * 60) % (24 * 60)
    return "%02d:%02d KST" % (total // 60, total % 60)


def importance_of(name):
    t = (name or "").lower()
    if any(k in t for k in HIGH):
        return 3
    if any(k in t for k in MID):
        return 2
    return 1


COUNTRY = [("United States", "미국"), ("United Kingdom", "영국"), ("Euro", "유로"),
           ("Japan", "일본"), ("China", "중국"), ("Germany", "독일"), ("France", "프랑스"),
           ("Canada", "캐나다"), ("Australia", "호주"), ("Korea", "한국")]


def country_ko(raw):
    for k, v in COUNTRY:
        if k in (raw or ""):
            return v
    return clean(raw)


def econ(day):
    js = fetch("https://api.nasdaq.com/api/calendar/economicevents?date=" + day)
    rows = ((js.get("data") or {}).get("rows") or [])
    out = []
    for r in rows:
        name = clean(r.get("eventName"))
        if not name:
            continue
        ctry = country_ko(r.get("country"))
        imp = importance_of(name)
        # 미국 지표는 모두, 다른 나라는 ★★★(FOMC·CPI·고용 같은 큰 것)만 남긴다(파일 무게).
        if ctry != "미국" and imp < 3 and not US_ONLY:
            continue
        out.append({
            "date": day, "kind": "지표", "time": kst_from_gmt(r.get("gmt")),
            "country": ctry, "title": name, "symbol": "",
            "forecast": clean(r.get("consensus")), "previous": clean(r.get("previous")),
            "actual": clean(r.get("actual")), "importance": imp,
            "desc": "", "source": "나스닥 경제지표 캘린더",
            "note": strip_html(r.get("description"))[:220],
        })
    return out


def earnings(day, keep):
    js = fetch("https://api.nasdaq.com/api/calendar/earnings?date=" + day)
    rows = ((js.get("data") or {}).get("rows") or [])
    out = []
    for r in rows:
        sym = clean(r.get("symbol")).upper()
        name = clean(r.get("name"))
        if not sym and not name:
            continue
        if keep and sym and sym not in keep:
            continue
        when = {"time-pre-market": "장전", "time-after-hours": "장후"}.get(clean(r.get("time")), "")
        out.append({
            "date": day, "kind": "실적", "time": when, "country": "미국",
            "title": name or sym, "symbol": sym,
            "forecast": clean(r.get("epsForecast")), "previous": clean(r.get("lastYearEPS")),
            "actual": "", "importance": 2, "desc": "", "source": "나스닥 실적 캘린더",
            "mcap": clean(r.get("marketCap")),
        })
    return out


def curated():
    path = os.path.join(APP, "us_calendar.json")
    if not os.path.exists(path):
        return []
    js = json.load(open(path, encoding="utf-8"))
    out = []
    for e in js.get("events") or []:
        cat = e.get("category") or "일정"
        lvl = e.get("level") or 0
        if not lvl:
            lvl = 3 if cat in ("연준·FOMC", "상장·IPO") else (1 if cat == "휴장·시간" else 2)
        kst = clean(e.get("kst"))
        tm = ""
        m = re.search(r"(\d{2}):(\d{2})", kst)
        if m:
            tm = m.group(1) + ":" + m.group(2) + " KST"
        desc = []
        if e.get("desc"):
            desc.append(clean(e.get("desc")))
        if e.get("et"):
            desc.append("미국 동부 " + clean(e.get("et")))
        if e.get("source"):
            desc.append("출처 · " + clean(e.get("source")))
        out.append({
            "date": clean(e.get("date")), "kind": cat, "time": tm, "country": "미국",
            "title": clean(e.get("title")), "symbol": clean(e.get("ticker")),
            "forecast": "", "previous": "", "actual": "",
            "importance": lvl, "desc": "\n".join(desc), "source": clean(e.get("source")),
            "why": clean(e.get("why")), "note": "", "curated": True,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--back", type=int, default=10)
    ap.add_argument("--ahead", type=int, default=40)
    ap.add_argument("--no-earnings", action="store_true")
    ap.add_argument("--all-countries", action="store_true")
    args = ap.parse_args()
    global US_ONLY
    US_ONLY = bool(args.all_countries)

    today = datetime.now(KST).date()
    days = [(today + timedelta(days=d)).isoformat() for d in range(-args.back, args.ahead + 1)]

    keep = set()
    try:
        mk = json.load(open(os.path.join(ROOT, "data", "market.json"), encoding="utf-8"))
        keep = set(k for k, v in (mk.get("symbols") or {}).items() if v.get("market") == "us")
    except Exception:
        pass

    events, failed = [], []
    for d in days:
        try:
            events.extend(econ(d))
        except Exception as e:  # noqa: BLE001
            failed.append("econ " + d + " " + str(e)[:50])
        if not args.no_earnings:
            try:
                events.extend(earnings(d, keep))
            except Exception as e:  # noqa: BLE001
                failed.append("earn " + d + " " + str(e)[:50])
        time.sleep(0.12)

    events.extend(curated())

    # 같은 날 같은 제목은 한 번만 (손글 일정이 있으면 그쪽을 남긴다)
    seen, merged = {}, []
    for e in events:
        k = (e["date"], e["title"], e["kind"])
        if k in seen:
            if e.get("curated"):
                merged[seen[k]] = e
            continue
        seen[k] = len(merged)
        merged.append(e)

    merged.sort(key=lambda e: (e["date"], e.get("time") or "99:99", -int(e.get("importance") or 0)))

    doc = {
        "asOf": today.isoformat(),
        "range": [days[0], days[-1]],
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": ["나스닥 경제지표 캘린더", "나스닥 실적 캘린더", "앱 내장 손글 일정(us_calendar.json)"],
        "note": "시각은 KST. 실적은 시가총액 상위 종목(증시 스냅샷 대상)만 담았다.",
        "failed": failed[:20],
        "counts": {
            "total": len(merged),
            "지표": sum(1 for e in merged if e["kind"] == "지표"),
            "실적": sum(1 for e in merged if e["kind"] == "실적"),
            "손글": sum(1 for e in merged if e.get("curated")),
        },
        "events": merged,
    }
    out = os.path.join(ROOT, "data", "calendar.json")
    with open(out + ".tmp", "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(out + ".tmp", out)
    print("calendar.json", len(merged), "건", os.path.getsize(out) // 1024, "KB",
          "실패", len(failed), doc["counts"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
