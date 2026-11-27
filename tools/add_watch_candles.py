#!/usr/bin/env python3
"""관심 목록 종목의 봉을 봉 파일에 더한다.

`make_market_snapshot.py` 는 시가총액 상위 종목만 봉을 담기 때문에, 관심 목록에 담은
ETF(TQQQ·SOXL 등)·중소형 종목은 종목 상세에서 차트가 비었다. 이 스크립트는
`data/watchlist.json` 과 `data/live.json` 의 심볼 중 봉이 없는 종목만 공개 시세 창구
(미장=나스닥, 국장=네이버)에서 받아 더한다. 받은 봉이 없으면 그 심볼만 빠진다(지어내지 않는다).

담는 기간은 candle_periods 규칙 — 일봉 최근 1년(약 252거래일) + 주봉 5년.
파일은 data/candles.json(종목) / data/candles-index.json(지수·대표 ETF)으로 나뉘어 쓰인다.

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
from datetime import datetime, timezone


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
    import candle_periods as cp
    syms = cp.load_pairs(ROOT)
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
            syms[base(s)] = cp.slim(bars)   # 국장은 스냅샷과 같은 6자리 키로 담는다
            added += 1
            print("  봉", s, "일", len(syms[base(s)][0]), "· 주", len(syms[base(s)][1]))
        else:
            print("  봉 없음", s)
        time.sleep(0.35)
    print("추가 %d 심볼" % added)
    if args.dry_run or not added:
        return 0
    now = datetime.now(tz=timezone.utc)
    info = cp.write_files(ROOT, syms, now.strftime("%Y-%m-%d"), now.isoformat(timespec="seconds"))
    print("candles.json", info["full"][1], "심볼", info["full"][2] // 1024, "KB",
          "· candles-index.json", info["index"][1], "심볼", info["index"][2] // 1024, "KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
