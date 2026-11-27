#!/usr/bin/env python3
"""증시 탭 자료 만들기 — `data/market.json` 과 `data/candles.json`.

원본 앱(v2.7.0) `MarketScreen.kt` 의 증시 홈은 네 섹션이다: 지수 · 관심 종목 · 마켓맵 · 순위.
웹에서는 브라우저가 공개 API 를 직접 부르면 CORS 로 막히는 곳이 많아, **정적 스냅샷**을 미리 만들어
브라우저는 그리기만 한다(값을 지어내지 않는다 — 못 받은 칸은 null).

쓰는 곳(모두 키가 필요 없다):
  · 트레이딩뷰 스캐너  https://scanner.tradingview.com/{america|korea}/scan
      — 시가총액·등락률·거래량·PER·RSI·이동평균·52주 고저·업종. 앱과 같은 창구다(15분 지연).
  · 나스닥 지난 종가    https://api.nasdaq.com/api/quote/{SYM}/historical  — 미국 일봉 OHLC.
  · 네이버 일봉         https://api.finance.naver.com/siseJson.naver        — 국내 일봉 OHLC.

  python3 tools/make_market_snapshot.py            # data/market.json + data/candles.json
  python3 tools/make_market_snapshot.py --no-candles
"""
import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", ".cache")
TV = "https://scanner.tradingview.com/%s/scan"

# 스캐너 열 — 원본 StockDetail 의 항목과 이름을 맞춘다.
COLS = [
    "name", "description", "close", "change", "volume", "market_cap_basic",
    "sector", "industry", "exchange", "type",
    "price_earnings_ttm", "price_earnings_forward", "price_sales_ratio", "price_book_ratio",
    "earnings_per_share_diluted_ttm",
    "RSI", "RSI|1W", "SMA20", "SMA50", "SMA200",
    "High.All", "price_52_week_high", "price_52_week_low",
    "Volatility.D", "ATR", "beta_1_year",
    "recommend_all", "target_price_average",
    "relative_volume_10d_calc", "average_volume_10d_calc", "total_shares_outstanding",
    "Perf.W", "Perf.1M", "Perf.Y", "Perf.YTD",
    "debt_to_equity", "return_on_equity", "gross_margin", "net_margin",
    "free_cash_flow", "dividend_yield_recent", "earnings_release_next_date",
]

US_INDEX = [("QQQ", "나스닥100", "ETF 대체"), ("SPY", "S&P500", "ETF 대체"),
            ("DIA", "다우존스", "ETF 대체"), ("IWM", "러셀2000", "ETF 대체"),
            ("SOXX", "필라델피아 반도체", "ETF 대체")]
US_TV = {"QQQ": "NASDAQ:QQQ", "SPY": "AMEX:SPY", "DIA": "AMEX:DIA",
         "IWM": "AMEX:IWM", "SOXX": "NASDAQ:SOXX"}
KR_INDEX = [("KOSPI", "코스피", ""), ("KOSDAQ", "코스닥", "")]

US_LIMIT = 300
# 지수 ETF·레버리지 ETF — type=stock 이 아니라 상위 목록에 안 들어온다. 관심 종목 기본값(TQQQ·SOXL)이
# 값 없이 뜨지 않도록 따로 담는다.
EXTRA_US = [("NASDAQ:TQQQ", "TQQQ"), ("AMEX:SOXL", "SOXL")]
KR_LIMIT = 220


def cache_path(name):
    os.makedirs(CACHE, exist_ok=True)
    return os.path.join(CACHE, name)


def fetch(url, data=None, tries=3, timeout=30):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={
                "User-Agent": UA,
                "Accept": "application/json,text/plain,*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Content-Type": "application/json",
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.2 * (i + 1))
    raise last


def scan(market, tickers=None, limit=0, sort_by="market_cap_basic"):
    body = {
        "options": {"lang": "en"},
        "markets": [market],
        "symbols": {"query": {"types": []}, "tickers": tickers or []},
        "columns": COLS,
    }
    if tickers:
        # 지수·ETF 는 type=stock 이 아니다 — 심볼을 지정할 때는 거르지 않는다.
        pass
    else:
        body["filter"] = [{"left": "type", "operation": "equal", "right": "stock"}]
        body["sort"] = {"sortBy": sort_by, "sortOrder": "desc"}
        body["range"] = [0, limit]
    raw = fetch(TV % market, data=json.dumps(body).encode())
    js = json.loads(raw)
    rows = []
    for item in js.get("data") or []:
        full = item.get("s", "")
        d = dict(zip(COLS, item.get("d") or []))
        d["_full"] = full
        d["_exch"] = full.split(":")[0] if ":" in full else ""
        rows.append(d)
    return rows


def scan_indices(market, pairs):
    """지수 칸 — 미국은 ETF 대체, 국내는 KRX 지수. 스캐너 심볼을 그대로 지정한다."""
    tickers = []
    for sym, _, _ in pairs:
        if market == "america":
            tickers.append(US_TV[sym])
        else:
            tickers.append("KRX:" + sym)
    rows = scan(market, tickers=tickers)
    by = {}
    for r in rows:
        by[r.get("name") or ""] = r
    out = []
    for sym, name, proxy in pairs:
        r = by.get(sym) or {}
        out.append({
            "sym": sym, "name": name, "proxy": proxy,
            "price": num(r.get("close")), "chg": num(r.get("change")),
            "volume": num(r.get("volume")), "mcap": num(r.get("market_cap_basic")),
            "sector": r.get("sector") or "", "industry": r.get("industry") or "",
        })
    return out


def num(v):
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


def is_preferred(name, sym, market):
    n = (name or "").lower()
    if "preferred" in n or "pfd" in n or "depositary" in n:
        return True
    if market == "korea" and re.search(r"(우|우B|우C|1우|2우)$", name or ""):
        return True
    if market == "korea" and re.match(r"^\d{6}$", sym or "") and (sym[-1] in "579"):
        return True
    return False


def row_out(d, market):
    cur = "KRW" if market == "korea" else "USD"
    price = num(d.get("close"))
    vol = num(d.get("volume"))
    return {
        "sym": d.get("name") or "",
        "desc": d.get("description") or "",
        "exch": d.get("exchange") or d.get("_exch") or "",
        "market": "kr" if market == "korea" else "us",
        "cur": cur,
        "price": price,
        "chg": num(d.get("change")),
        "vol": vol,
        "val": (price * vol) if (price is not None and vol is not None) else None,
        "mcap": num(d.get("market_cap_basic")),
        "sector": d.get("sector") or "",
        "industry": d.get("industry") or "",
        "per": num(d.get("price_earnings_ttm")),
        "perF": num(d.get("price_earnings_forward")),
        "psr": num(d.get("price_sales_ratio")),
        "pbr": num(d.get("price_book_ratio")),
        "eps": num(d.get("earnings_per_share_diluted_ttm")),
        "rsi": num(d.get("RSI")),
        "rsiW": num(d.get("RSI|1W")),
        "sma20": num(d.get("SMA20")),
        "sma50": num(d.get("SMA50")),
        "sma200": num(d.get("SMA200")),
        "highAll": num(d.get("High.All")),
        "high52": num(d.get("price_52_week_high")),
        "low52": num(d.get("price_52_week_low")),
        "volD": num(d.get("Volatility.D")),
        "atr": num(d.get("ATR")),
        "beta": num(d.get("beta_1_year")),
        "reco": num(d.get("recommend_all")),
        "target": num(d.get("target_price_average")),
        "relVol": num(d.get("relative_volume_10d_calc")),
        "avgVol10": num(d.get("average_volume_10d_calc")),
        "shares": num(d.get("total_shares_outstanding")),
        "perfW": num(d.get("Perf.W")),
        "perfM": num(d.get("Perf.1M")),
        "perfY": num(d.get("Perf.Y")),
        "perfYtd": num(d.get("Perf.YTD")),
        "de": num(d.get("debt_to_equity")),
        "roe": num(d.get("return_on_equity")),
        "gm": num(d.get("gross_margin")),
        "nm": num(d.get("net_margin")),
        "fcf": num(d.get("free_cash_flow")),
        "div": num(d.get("dividend_yield_recent")),
        "earnNext": num(d.get("earnings_release_next_date")),
    }


def naver_list(market, pages=4, size=100):
    """네이버 종목 목록 — 한글 이름·시가총액(억원)·거래대금·장 상태. 국내 시세의 기준으로 쓴다."""
    out = []
    for page in range(1, pages + 1):
        url = ("https://m.stock.naver.com/api/stocks/marketValue/%s?page=%d&pageSize=%d"
               % (market, page, size))
        try:
            js = json.loads(fetch(url, tries=2, timeout=20))
        except Exception as e:  # noqa: BLE001
            print("  네이버 목록 실패", market, page, str(e)[:60])
            break
        rows = js.get("stocks") or []
        if not rows:
            break
        out.extend(rows)
        if len(rows) < size:
            break
    return out


def fx_rate():
    body = {"symbols": {"tickers": ["FX_IDC:USDKRW"], "query": {"types": []}},
            "columns": ["name", "close", "change"]}
    try:
        js = json.loads(fetch("https://scanner.tradingview.com/forex/scan",
                              data=json.dumps(body).encode(), tries=2, timeout=20))
        rows = js.get("data") or []
        if rows:
            return num(rows[0]["d"][1])
    except Exception as e:  # noqa: BLE001
        print("  환율 실패", str(e)[:60])
    return None


def won_num(s):
    """'10,494,070' → 104940700000.0 (네이버 목록의 시가총액 단위는 억원)."""
    if s is None:
        return None
    t = str(s).replace(",", "").strip()
    try:
        return float(t) * 1e8
    except ValueError:
        return None



def nasdaq_bars(sym, assetclass, days=400):
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days)
    url = ("https://api.nasdaq.com/api/quote/%s/historical?assetclass=%s&fromdate=%s&todate=%s&limit=%d"
           % (urllib.parse.quote(sym), assetclass, start.isoformat(), today.isoformat(), days + 20))
    raw = fetch(url, tries=2)
    js = json.loads(raw)
    rows = (((js.get("data") or {}).get("tradesTable") or {}).get("rows") or [])
    out = []
    for r in rows:
        try:
            d = datetime.strptime(r["date"], "%m/%d/%Y").date().isoformat()
        except Exception:
            continue
        def f(k):
            s = str(r.get(k) or "").replace("$", "").replace(",", "").strip()
            try:
                return float(s)
            except ValueError:
                return None
        o, h, l, c = f("open"), f("high"), f("low"), f("close")
        v = f("volume")
        if c is None:
            continue
        out.append([d, o, h, l, c, v])
    out.sort(key=lambda x: x[0])
    return out


def naver_bars(sym, days=400):
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days)
    url = ("https://api.finance.naver.com/siseJson.naver?symbol=%s&requestType=1&startTime=%s&endTime=%s&timeframe=day"
           % (urllib.parse.quote(sym), start.strftime("%Y%m%d"), today.strftime("%Y%m%d")))
    raw = fetch(url, tries=2)
    raw = raw.replace("'", '"')
    try:
        arr = json.loads(raw)
    except Exception:
        return []
    out = []
    for r in arr:
        if not isinstance(r, list) or len(r) < 6 or not re.match(r"^\d{8}$", str(r[0])):
            continue
        d = str(r[0])
        out.append([d[:4] + "-" + d[4:6] + "-" + d[6:], num(r[1]), num(r[2]), num(r[3]), num(r[4]), num(r[5])])
    out.sort(key=lambda x: x[0])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-candles", action="store_true")
    ap.add_argument("--candles-us", type=int, default=60)
    ap.add_argument("--candles-kr", type=int, default=40)
    args = ap.parse_args()

    print("스캐너: 미국 상위", US_LIMIT)
    us = scan("america", limit=US_LIMIT)
    print("  받음", len(us))
    print("스캐너: 국내 상위", KR_LIMIT)
    kr = scan("korea", limit=KR_LIMIT)
    print("  받음", len(kr))

    def build(rows, market):
        out, seen = [], set()
        for d in rows:
            sym = (d.get("name") or "").strip()
            if not sym or sym in seen:
                continue
            if is_preferred(d.get("description"), sym, market):
                continue
            seen.add(sym)
            out.append(row_out(d, market))
        return out

    us_rows = build(us, "america")
    kr_rows = build(kr, "korea")

    # 국내는 네이버 목록(한글 이름·시가총액·거래대금·장 상태)을 기준값으로 덮는다.
    nav = {}
    for board in ("KOSPI", "KOSDAQ"):
        rows = naver_list(board, pages=4, size=100)
        print("  네이버", board, len(rows))
        for r in rows:
            code = (r.get("itemCode") or "").strip()
            if not re.match(r"^\d{6}$", code):
                continue
            if code in nav:
                continue
            nav[code] = {
                "name": r.get("stockName") or code,
                "board": board,
                "price": num(str(r.get("closePrice") or "").replace(",", "")),
                "chg": num(r.get("fluctuationsRatio")),
                "vol": num(str(r.get("accumulatedTradingVolume") or "").replace(",", "")),
                "val": won_num(r.get("accumulatedTradingValue")),
                "mcap": won_num(r.get("marketValue")),
                "status": r.get("marketStatus") or "",
            }
    for r in kr_rows:
        n = nav.get(r["sym"])
        if not n:
            continue
        r["name"] = n["name"]
        r["board"] = n["board"]
        r["price"] = n["price"] if n["price"] is not None else r["price"]
        r["chg"] = n["chg"] if n["chg"] is not None else r["chg"]
        r["vol"] = n["vol"] if n["vol"] is not None else r["vol"]
        r["val"] = n["val"] if n["val"] is not None else r["val"]
        r["mcap"] = n["mcap"] if n["mcap"] is not None else r["mcap"]
        r["status"] = n["status"]
        r["src"] = "naver"
    have = set(r["sym"] for r in kr_rows)
    extra = []
    for code, n in sorted(nav.items(), key=lambda kv: -(kv[1]["mcap"] or 0)):
        if code in have or n["price"] is None:
            continue
        if is_preferred(n["name"], code, "korea"):
            continue
        extra.append({
            "sym": code, "name": n["name"], "desc": "", "exch": n["board"],
            "market": "kr", "cur": "KRW", "price": n["price"], "chg": n["chg"],
            "vol": n["vol"], "val": n["val"], "mcap": n["mcap"], "sector": "", "industry": "",
            "per": None, "perF": None, "psr": None, "pbr": None, "eps": None,
            "rsi": None, "rsiW": None, "sma20": None, "sma50": None, "sma200": None,
            "highAll": None, "high52": None, "low52": None, "volD": None, "atr": None,
            "beta": None, "reco": None, "target": None, "relVol": None, "avgVol10": None,
            "shares": None, "perfW": None, "perfM": None, "perfY": None, "perfYtd": None,
            "de": None, "roe": None, "gm": None, "nm": None, "fcf": None, "div": None,
            "earnNext": None, "board": n["board"], "status": n["status"], "src": "naver",
        })
    kr_rows = kr_rows + extra[:260]
    for r in us_rows:
        r["src"] = "tradingview"

    # ETF 두 개 — 관심 종목 기본값
    try:
        extra_rows = scan("america", tickers=[t for t, _ in EXTRA_US])
        for d in extra_rows:
            r = row_out(d, "america")
            if r["sym"]:
                r["kind"] = "etf"
                us_rows.append(r)
    except Exception as e:  # noqa: BLE001
        print("  ETF 실패", str(e)[:60])

    us_idx = scan_indices("america", US_INDEX)
    kr_idx = scan_indices("korea", KR_INDEX)

    now = datetime.now(timezone.utc)
    doc = {
        "asOf": now.strftime("%Y-%m-%d"),
        "generatedAt": now.isoformat(timespec="seconds"),
        "fx": {"usdkrw": fx_rate()},
        "delayNote": "트레이딩뷰 스캐너 값(15분 지연). 봉은 나스닥·네이버 일봉.",
        "sources": [
            "tradingview scanner /america /korea — 가격·시가총액·PER·RSI·이동평균·업종",
            "nasdaq api — 미국 일봉",
            "naver siseJson — 국내 일봉",
        ],
        "markets": {
            "us": {"label": "미국", "currency": "USD", "indices": us_idx},
            "kr": {"label": "국내", "currency": "KRW", "indices": kr_idx},
        },
        "symbols": {},
    }
    for r in us_rows + kr_rows:
        doc["symbols"][r["sym"]] = r
    # 지수 칸의 ETF·국내 지수도 종목처럼 조회할 수 있게 넣는다(관심 종목에 담을 수 있다).
    for mk, arr in (("us", us_idx), ("kr", kr_idx)):
        for x in arr:
            if x["sym"] in doc["symbols"]:
                continue
            doc["symbols"][x["sym"]] = {
                "sym": x["sym"], "desc": x["name"], "exch": "", "market": mk,
                "cur": "USD" if mk == "us" else "KRW", "price": x["price"], "chg": x["chg"],
                "vol": x["volume"], "val": None, "mcap": x["mcap"], "sector": "", "industry": "",
                "kind": "index", "src": "tradingview",
            }

    # 캔들 — 지수·상위 종목. 값이 없으면 그 심볼만 빠진다(지어내지 않는다).
    if not args.no_candles:
        candles = {}
        targets = []
        for r in us_idx:
            targets.append((r["sym"], "etf", r["sym"]))
        for r in kr_idx:
            targets.append((r["sym"], "kr-index", r["sym"]))
        for r in us_rows[:args.candles_us]:
            targets.append((r["sym"], "us", r["sym"]))
        for r in kr_rows[:args.candles_kr]:
            targets.append((r["sym"], "kr", r["sym"]))
        seen = set()
        for sym, kind, key in targets:
            if key in seen:
                continue
            seen.add(key)
            try:
                if kind == "kr":
                    bars = naver_bars(sym)
                elif kind == "kr-index":
                    bars = naver_bars(sym)
                elif kind == "etf":
                    bars = nasdaq_bars(sym, "etf")
                else:
                    bars = nasdaq_bars(sym, "stocks")
                if bars:
                    candles[key] = bars
                    print("  봉", key, len(bars))
                else:
                    print("  봉 없음", key)
            except Exception as e:  # noqa: BLE001
                print("  봉 실패", key, str(e)[:80])
                continue
            time.sleep(0.35)
        cd = {"asOf": doc["asOf"], "generatedAt": doc["generatedAt"],
              "note": "일봉 [날짜, 시가, 고가, 저가, 종가, 거래량]. 주·월·연봉은 브라우저가 묶는다.",
              "symbols": candles}
        out = os.path.join(ROOT, "data", "candles.json")
        with open(out + ".tmp", "w", encoding="utf-8") as f:
            json.dump(cd, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        os.replace(out + ".tmp", out)
        print("candles.json", len(candles), "심볼", os.path.getsize(out) // 1024, "KB")

    out = os.path.join(ROOT, "data", "market.json")
    with open(out + ".tmp", "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(out + ".tmp", out)
    print("market.json", len(doc["symbols"]), "심볼", os.path.getsize(out) // 1024, "KB")
    print("미국 지수", [(i["sym"], i["price"], i["chg"]) for i in us_idx])
    print("국내 지수", [(i["sym"], i["price"], i["chg"]) for i in kr_idx])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
