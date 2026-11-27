#!/usr/bin/env python3
"""봉 파일의 담는 기간 규칙 — 일봉 최근 1년(약 252거래일) + 주봉 5년.

무아 님 결정(2026-11-28): 일봉은 최근 1년치만 담고, 5년 기간 탭은 주봉으로 그린다.
화면의 기간·집계 규칙은 js/market-candles.js 가 그대로 맡는다 — 여기서는 **담는 기간**만 줄인다.

주봉 규칙은 브라우저의 fold 와 같다(시가=그 주 첫 봉 시가, 고가=최대, 저가=최소,
종가=그 주 마지막 종가, 거래량=합, 주 시작=월요일). 그래서 브라우저가 이 주봉을
다시 묶어도(fold) 같은 봉이 나온다 — 5년 탭이 잘리지 않고 그대로 그려진다.

파일은 둘로 나눈다.
  data/candles-index.json — 지수 카드 미니차트가 쓰는 지수·대표 ETF 9종(^NDX·^VIX 포함)
  data/candles.json       — 그 밖의 종목 봉(종목 상세·큰 차트를 열 때만 받는다)
두 파일 모두 {"symbols": {키: 일봉}, "weekly": {키: 주봉}} 모양이다.
"""
import datetime
import json
import os

DAILY_KEEP = 252          # 일봉 최근 1년(거래일)
WEEKLY_YEARS = 5          # 주봉 5년

# 증시 탭 첫 화면(지수 카드)이 미니차트를 그리는 심볼 — 지수·대표 ETF 대체.
# 이 심볼들은 작은 파일(candles-index.json)에 담아 첫 진입에서 큰 파일을 받지 않게 한다.
INDEX_KEYS = ("^NDX", "^VIX", "QQQ", "SPY", "DIA", "IWM", "SOXX", "KOSPI", "KOSDAQ")

NOTE = ("일봉 최근 1년(약 252거래일) · 주봉 5년. 일봉 [날짜, 시가, 고가, 저가, 종가, 거래량]. "
        "월·연봉은 브라우저가 묶는다. 5년 기간 탭은 주봉으로 그린다.")


def _px(v):
    """값은 화면에 보이는 자릿수까지만 남긴다(fmtVal: 10 이상 2자리, 1 이상 3자리, 그 아래 4자리)."""
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    a = abs(v)
    x = round(v, 2 if a >= 10 else (3 if a >= 1 else 4))
    return int(x) if x == int(x) else x


def _vol(v):
    if v is None:
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def norm(rows):
    """[날짜, 시, 고, 저, 종, 거래량] 으로 맞추고 값이 빠진 봉은 뺀다(지어내지 않는다)."""
    out = []
    for r in rows or []:
        if not r or len(r) < 5:
            continue
        d = str(r[0])[:10]
        try:
            datetime.date.fromisoformat(d)
        except ValueError:
            continue
        c = _px(r[4])
        if c is None:
            continue
        o = _px(r[1])
        h = _px(r[2])
        l = _px(r[3])
        o = c if o is None else o
        h = max(o, c) if h is None else h
        l = min(o, c) if l is None else l
        out.append([d, o, h, l, c, _vol(r[5]) if len(r) > 5 else None])
    out.sort(key=lambda x: x[0])
    # 같은 날짜가 두 번 오면 마지막 값만 남긴다(합치지 않는다 — 봉이 두 배가 되지 않게).
    dedup = []
    for row in out:
        if dedup and dedup[-1][0] == row[0]:
            dedup[-1] = row
        else:
            dedup.append(row)
    return dedup


def fold_weekly(rows):
    """일봉 → 주봉. js/market-candles.js 의 fold(span='week') 와 같은 규칙."""
    out, cur, curk = [], None, None
    for r in rows:
        dt = datetime.date.fromisoformat(str(r[0])[:10])
        k = (dt - datetime.timedelta(days=dt.weekday())).isoformat()   # 그 주 월요일
        if curk != k:
            if cur:
                out.append(cur)
            cur = [k, r[1], r[2], r[3], r[4], r[5]]
            curk = k
        else:
            cur[2] = max(cur[2], r[2])
            cur[3] = min(cur[3], r[3])
            cur[4] = r[4]
            cur[5] = None if cur[5] is None or r[5] is None else cur[5] + r[5]
    if cur:
        out.append(cur)
    return out


def _within_years(rows, years):
    if not rows:
        return rows
    last = datetime.date.fromisoformat(str(rows[-1][0])[:10])
    try:
        cut = last.replace(year=last.year - years)
    except ValueError:                      # 2월 29일
        cut = last - datetime.timedelta(days=365 * years + 1)
    return [r for r in rows if str(r[0])[:10] >= cut.isoformat()]


def slim(rows):
    """일봉 전부 → (최근 1년 일봉, 5년 주봉)."""
    rows = norm(rows)
    daily = rows[-DAILY_KEEP:] if len(rows) > DAILY_KEEP else rows
    weekly = _within_years(fold_weekly(rows), WEEKLY_YEARS)
    return daily, weekly


def paths(root):
    d = os.path.join(root, "data")
    return os.path.join(d, "candles.json"), os.path.join(d, "candles-index.json")


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def load_pairs(root):
    """이미 있는 두 봉 파일 → {키: (일봉, 주봉)}. 받지 못한 심볼을 그대로 두는 데 쓴다."""
    pairs = {}
    for path in paths(root):
        doc = read_json(path)
        syms = doc.get("symbols") if isinstance(doc.get("symbols"), dict) else {}
        week = doc.get("weekly") if isinstance(doc.get("weekly"), dict) else {}
        for k, v in syms.items():
            if isinstance(v, list) and v:
                pairs[k] = (v, week.get(k) or [])
    return pairs


def _write(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp, path)


def write_files(root, pairs, as_of=None, generated_at=None):
    """{키: (일봉, 주봉)} → data/candles.json + data/candles-index.json.

    지수·대표 ETF(INDEX_KEYS)는 작은 파일로, 나머지 종목은 큰 파일로 나눠 쓴다.
    두 파일은 같은 asOf·generatedAt 을 쓴다.
    """
    small, big = {}, {}
    for k, val in (pairs or {}).items():
        daily, weekly = val if isinstance(val, tuple) else (val, [])
        if not daily:
            continue
        bucket = small if k in INDEX_KEYS else big
        bucket[k] = (daily, weekly)

    def doc_of(bucket):
        return {
            "asOf": as_of, "generatedAt": generated_at, "note": NOTE,
            "symbols": {k: v[0] for k, v in bucket.items()},
            "weekly": {k: v[1] for k, v in bucket.items() if v[1]},
        }

    p_full, p_idx = paths(root)
    _write(p_idx, doc_of(small))
    _write(p_full, doc_of(big))
    return {
        "full": (p_full, len(big), os.path.getsize(p_full)),
        "index": (p_idx, len(small), os.path.getsize(p_idx)),
    }
