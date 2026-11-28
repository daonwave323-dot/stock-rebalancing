#!/usr/bin/env python3
"""시세 일관성 점검 — 화면이 쓰는 세 자료(스냅샷·5분 갱신·봉 파일)의 같은 심볼 값을 나란히 놓고 어긋남을 찾는다.

  python3 tools/check_price_consistency.py            # 표를 찍고, 어긋나면 종료코드 1
  python3 tools/check_price_consistency.py --json     # 기계가 읽는 형태

무엇을 '같아야 하는 것'으로 보는가 (js/market-data.js · js/views-market.js 의 실제 규칙 그대로)

  · 증시 홈 지수 카드의 숫자 = Mkt.indices() 가 고르는 값
      - 스냅샷(data/market.json markets[].indices)의 price
      - live.json 에 그 심볼이 있고 regularClose 가 있으면 그 값이 이긴다
      - 미국은 ^NDX·^VIX 를 live 값으로 앞뒤에 덧붙인다(스냅샷에 없는 실제 지수)
  · 카드 미니차트의 끝점 = 봉 파일(candles-index.json, 없으면 candles.json) 마지막 봉 종가
      - live.json 에 dayBars 가 있으면 날짜로 합쳐 더 새 봉을 쓴다(^NDX·^VIX·TQQQ·SOXL)
  · 큰 캔들 차트의 마지막 봉도 같은 봉 파일이다 → 카드 숫자와 같아야 한다

그래서 (카드 숫자) == (미니차트 끝점) 이고, 모든 자료의 마지막 확정 봉 날짜가 같아야 한다.
같은 종가를 서로 다른 자릿수로 반올림해 0.01% 안쪽으로 어긋나는 것은 '같음'으로 본다
(예: ^NDX 26726.389 vs 26726.39).
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

INDEX_SYMBOLS = ["^NDX", "^VIX", "QQQ", "SPY", "DIA", "IWM", "SOXX", "KOSPI", "KOSDAQ"]
EXTRA_SYMBOLS = ["TQQQ", "SOXL"]


def load(name):
    path = os.path.join(DATA, name)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def live_sym(live, sym):
    syms = (live or {}).get("symbols") or {}
    s = str(sym or "").strip()
    return syms.get(s) or syms.get(s + ".KS") or syms.get(s + ".KQ")


def snapshot_index(snap, market, sym):
    mk = ((snap.get("markets") or {}).get(market) or {})
    for x in mk.get("indices") or []:
        if x.get("sym") == sym:
            return x
    return None


def card_value(snap, live, market, sym):
    """js/market-data.js M.indices() 와 같은 순서로 카드에 적히는 값."""
    x = snapshot_index(snap, market, sym)
    price = x.get("price") if x else None
    chg = x.get("chg") if x else None
    at = snap.get("generatedAt")
    note = "스냅샷" if x else "없음"
    if market == "us":
        l = live_sym(live, sym)
    else:
        l = (((live or {}).get("kr") or {}).get("indexes") or {}).get(sym)
    if l and l.get("regularClose") is not None:
        price = l.get("regularClose")
        chg = l.get("regularChangePct")
        if chg is None:
            chg = l.get("changePct")
        at = l.get("regularCloseTime") or l.get("regularCloseKst")
        note = "5분 갱신"
    return {"price": price, "chg": chg, "at": at, "note": note}


def bars_of(doc, sym):
    syms = (doc or {}).get("symbols") or {}
    s = str(sym or "").strip()
    b = syms.get(s) or syms.get(s.upper())
    return b if isinstance(b, list) else []


def chart_end(cand_index, cand_full, live, sym):
    """js/views-market.js sparkPoints() 와 같은 규칙 — 봉 파일 + live dayBars 를 날짜로 합친 마지막 점."""
    by_date = {}
    for doc in (cand_index, cand_full):
        for b in bars_of(doc, sym):
            if len(b) > 4 and b[4] is not None:
                by_date[str(b[0])[:10]] = float(b[4])
    l = live_sym(live, sym)
    if l and isinstance(l.get("dayBars"), list):
        for b in l["dayBars"]:
            if isinstance(b, dict) and b.get("d") and b.get("c") is not None:
                by_date[str(b["d"])[:10]] = float(b["c"])
    if not by_date:
        return None, None
    last = max(by_date)
    return last, by_date[last]


def same(a, b):
    if a is None or b is None:
        return False
    a, b = float(a), float(b)
    if a == b:
        return True
    base = max(abs(a), abs(b), 1e-9)
    return abs(a - b) / base <= 0.0001


def fmt(v):
    if v is None:
        return "—"
    return f"{v:,.2f}" if abs(v) < 100000 else f"{v:,.2f}"


def run(as_json=False):
    snap = load("market.json")
    live = load("live.json")
    ci = load("candles-index.json")
    cf = load("candles.json")

    rows = []
    for market, syms in (("us", ["^NDX", "QQQ", "SPY", "DIA", "IWM", "SOXX", "^VIX"]),
                         ("kr", ["KOSPI", "KOSDAQ"]),
                         ("us", EXTRA_SYMBOLS),
                         ("us", ["AAPL", "NVDA"]),
                         ("kr", ["005930", "000660"])):
        for sym in syms:
            if sym in INDEX_SYMBOLS or sym in EXTRA_SYMBOLS:
                card = card_value(snap, live, market, sym)
            else:
                # 종목 — js/market-data.js quote().regPrice / look('regular').price 와 같은 순서
                l = live_sym(live, sym)
                s = (snap.get("symbols") or {}).get(sym) or {}
                price = (l.get("regularClose") if l and l.get("regularClose") is not None
                         else ((l.get("last") if l and l.get("last") is not None else s.get("price"))))
                card = {"price": price, "chg": None, "at": None,
                        "note": "5분 갱신" if (l and l.get("regularClose") is not None) else "스냅샷"}
            cdate, cclose = chart_end(ci, cf, live, sym)
            snapx = snapshot_index(snap, market, sym)
            l = live_sym(live, sym)
            rows.append({
                "market": market,
                "sym": sym,
                "snap": snapx.get("price") if snapx else ((snap.get("symbols") or {}).get(sym) or {}).get("price"),
                "snap_at": snap.get("asOf"),
                "live": (l.get("regularClose") if l else None),
                "live_at": (l.get("regularCloseDate") or (l.get("regularCloseTime") or "")[:10]) if l else None,
                "card": card["price"],
                "card_note": card["note"],
                "bar_date": cdate,
                "bar_close": cclose,
                "ok": same(card["price"], cclose),
            })

    if as_json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
    else:
        print(f"{'시장':4} {'심볼':8} {'스냅샷':>12} {'5분':>12} {'화면 카드':>12} {'봉 마지막':>12} {'봉 날짜':11} 판정")
        for r in rows:
            mark = "OK" if r["ok"] else "어긋남"
            print(f"{r['market']:4} {r['sym']:8} {fmt(r['snap']):>12} {fmt(r['live']):>12} "
                  f"{fmt(r['card']):>12} {fmt(r['bar_close']):>12} {str(r['bar_date']):11} {mark}")

    bad = [r for r in rows if not r["ok"]]
    # 마지막 확정 봉 날짜가 자료마다 다른지도 본다(모든 지수·ETF 가 같은 세션에서 끝나야 한다).
    dates = sorted({r["bar_date"] for r in rows if r["bar_date"]})
    if not as_json:
        print()
        print("마지막 확정 봉 날짜:", ", ".join(dates) if dates else "—")
        if len(dates) > 1:
            print("  → 봉 파일의 마지막 날짜가 갈립니다. 같은 세션(마지막 확정 종가)으로 맞춰야 합니다.")
        print("판정:", "모두 같음" if not bad else f"{len(bad)}건 어긋남")
    return 0 if (not bad and len(dates) <= 1) else 1


def main():
    ap = argparse.ArgumentParser(description="화면 카드 숫자·미니차트 끝점·봉 마지막 종가 일치 점검")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    return run(args.json)


if __name__ == "__main__":
    sys.exit(main())
