#!/usr/bin/env python3
"""관심 목록 종목의 일봉을 data/candles.json 에 더한다.

`make_market_snapshot.py` 는 시가총액 상위 종목만 봉을 담기 때문에, 관심 목록에 담은
ETF(TQQQ·SOXL 등)·중소형 종목은 종목 상세에서 차트가 비었다. 이 스크립트는
`data/watchlist.json` 과 `data/live.json` 의 심볼 중 봉이 없는 종목만 공개 시세 창구
(미장=나스닥, 국장=네이버)에서 받아 더한다. 받은 봉이 없으면 그 심볼만 빠진다(지어내지 않는다).

  python3 tools/add_watch_candles.py              # 빠진 종목만 받아 더한다
  python3 tools/add_watch_candles.py --dry-run    # 파일 쓰지 않고 결과만
"""
import argparse
import importlib.util
import json
import os
import re
import sys
import time


def _load_snapshot_tools():
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("mksnap", os.path.join(here, "make_market_snapshot.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.argv = [sys.argv[0]]
    spec.loader.exec_module(mod)
    return mod


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUIRED = ("TQQQ", "SOXL")


def base(sym):
    m = re.match(r"^(\d{6})\.(KS|KQ)$", sym.upper())
    return m.group(1) if m else sym.upper()


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def wanted_symbols():
    out = []
    doc = read_json(os.path.join(ROOT, "data", "watchlist.json"), {})
    syms = doc.get("symbols") if isinstance(doc, dict) else doc
    if not isinstance(syms, list):
        syms = []
    candidates = list(syms)
    live = read_json(os.path.join(ROOT, "data", "live.json"), {}).get("symbols") or {}
    candidates += list(live.keys()) + list(REQUIRED)
    for s in candidates:
        if s and not s.startswith("^") and s not in out:
            out.append(s)
    live = read_json(os.path.join(ROOT, "data", "live.json"), {}).get("symbols") or {}
    for s in list(live.keys()) + list(REQUIRED):
        s = str(s).strip().upper()
        if s and not s.startswith("^") and s not in out:
            out.append(s)
    return out


def fetch_bars(mk, sym):
    b = base(sym)
    if re.match(r"^\d{6}$", b):
        return mk.naver_bars(b)
    for asset in ("stocks", "etf"):
        try:
            bars = mk.nasdaq_bars(sym, asset)
        except Exception as e:  # noqa: BLE001
            print("  실패", sym, asset, str(e)[:80])
            continue
        if bars:
            return bars
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    path = os.path.join(ROOT, "data", "candles.json")
    doc = read_json(path, {"symbols": {}})
    syms = doc.get("symbols") or {}
    keys = {k.upper() for k in syms}
    want = wanted_symbols()
    missing = [s for s in want if s.upper() not in keys and base(s).upper() not in keys]
    print("봉 파일 %d 심볼 · 관심 대상 %d · 빠진 %d" % (len(syms), len(want), len(missing)))
    mk = _load_snapshot_tools()
    added = 0
    for s in missing:
        try:
            bars = fetch_bars(mk, s)
        except Exception as e:  # noqa: BLE001
            print("  봉 실패", s, str(e)[:100])
            bars = []
        if bars:
            syms[base(s)] = bars          # 국장은 스냅샷과 같은 6자리 키로 담는다
            added += 1
            print("  봉", s, len(bars), bars[-1][0])
        else:
            print("  봉 없음", s)
        time.sleep(0.35)
    print("추가 %d 심볼" % added)
    if args.dry_run or not added:
        return 0
    doc["symbols"] = syms
    doc["note"] = "일봉 [날짜, 시가, 고가, 저가, 종가, 거래량]. 주·월·연봉은 브라우저가 묶는다."
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)
    print("candles.json", len(syms), "심볼", os.path.getsize(path) // 1024, "KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
