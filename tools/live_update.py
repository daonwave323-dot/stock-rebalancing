#!/usr/bin/env python3
"""스톡 리밸런싱 — 5분 자동 시세 갱신기.

야후 파이낸스의 **키가 필요 없는** 두 창구에서 값만 받아 `data/live.json` 한 파일로 쓴다.
  1) chart v8  — 일봉 5년(종가 이력). 특이점 여섯 지표의 재료.
  2) quote v7  — 지금 값(정규장·프리마켓·애프터마켓), 시가총액·거래량·전일 종가.
     v7 은 쿠키+crumb 를 먼저 받아야 하는데, 이것도 키가 아니라 브라우저가 늘 하는 절차다.

브라우저는 이 JSON 만 읽는다. 어떤 키도 저장소·화면·로그에 남지 않는다.

계산식은 원본 앱(v2.7.0)의 `Singularity.kt`·`ScoreLive.kt` 를 그대로 옮겼다.
  - 점수: 낙폭 .30 · 주간 RSI .20 · VIX/50일 .15 · 200일선 이격 .15 · 일간 RSI .10 · 공포 백분위 .10
  - 확정(종가) = 마지막으로 끝난 정규장 봉까지(장중이면 오늘 미완성 봉을 뺀다)
  - 실시간(추정) = 확정 일봉 + 지금 값(프리·애프터마켓 포함)을 '진행 중인 봉' 하나로 얹은 것
  - 공포 백분위 = 최근 252개 VIX 종가 중 오늘 값 이하인 날의 비율

실패 규칙: 필수 심볼(TQQQ·SOXL·^VIX) 중 하나라도 못 받으면 **기존 파일을 그대로 두고**
0이 아닌 코드로 끝난다. 관심 종목이 일부 실패하면 그 심볼만 이전 값을 이어 쓰고 `partial` 에 적는다.

  python3 tools/live_update.py                 # data/live.json 갱신
  python3 tools/live_update.py --dry-run       # 파일 쓰지 않고 결과만 출력
  python3 tools/live_update.py --now 2026-11-28T03:00:00Z   # 시각 고정(휴장일 점검용)
"""
import argparse
import http.cookiejar
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ET = timezone(timedelta(hours=-5))  # 미국 동부(겨울 표준시). 원본과 같은 고정 오프셋을 쓴다.
UA = "Mozilla/5.0"  # 짧은 UA 만 통과한다 — 긴 크롬 UA 는 야후가 429(과다 요청)로 막는 것을 확인했다
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/"
QUOTE = "https://query1.finance.yahoo.com/v7/finance/quote"
CRUMB = "https://query1.finance.yahoo.com/v1/test/getcrumb"

REQUIRED = ["TQQQ", "SOXL", "^NDX", "^VIX"]
SCORE_SYMBOLS = {"ndx": "TQQQ", "sox": "SOXL"}

# ---------------------------------------------------------------- 여섯 지표(원본 그대로)

INDICATORS = [
    ("dd", "고점 대비 낙폭", 0.30, "%"),
    ("wrsi", "주간 RSI(14주)", 0.20, ""),
    ("vixr", "VIX / 50일 평균", 0.15, "x"),
    ("gap", "200일선 이격", 0.15, "%"),
    ("drsi", "일간 RSI(14)", 0.10, ""),
    ("vixp", "공포 백분위", 0.10, ""),
]
WEIGHT = {k: w for k, _, w, _ in INDICATORS}


def js_round(x, nd=1):
    """JS Math.round 와 같은 반올림(0.5는 위로). Python round 는 짝수 반올림이라 쓰지 않는다."""
    m = 10 ** nd
    return math.floor(x * m + 0.5) / m


def clamp100(x):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return 0.0
    return max(0.0, min(100.0, x))


def convert(key, v, target):
    """Singularity.convert() 그대로."""
    if key == "dd":
        x = v / (12.0 if target == "ndx" else 20.0) * 100
    elif key == "wrsi":
        x = (70 - v) / 40 * 100
    elif key == "vixr":
        x = (v - 1) / 0.4 * 100
    elif key == "gap":
        x = -v / 30 * 100
    elif key == "drsi":
        x = (50 - v) / 20 * 100
    elif key == "vixp":
        x = v
    else:
        x = 0.0
    return clamp100(x)


def fmt_raw(key, v):
    """Singularity.format() 그대로 — 화면에 쓰는 표기."""
    if v is None:
        return "—"
    if key == "vixr":
        return "%.2f" % v
    if key == "dd":
        return "-%.1f" % v
    s = "%.1f" % v
    return s[:-2] if s.endswith(".0") else s


def singular_score(values, target):
    """Singularity.score(): 값이 없는 지표는 빼고 남은 가중치 합으로 나눈다."""
    total = 0.0
    wsum = 0.0
    rows = []
    for key, name, w, unit in INDICATORS:
        v = values.get(key)
        if v is None:
            rows.append({"key": key, "name": name, "weight": w, "unit": unit,
                         "raw": None, "raw_display": "—", "converted": None, "contribution": None})
            continue
        c = convert(key, v, target)
        total += c * w
        wsum += w
        rows.append({"key": key, "name": name, "weight": w, "unit": unit,
                     "raw": js_round(v, 2), "raw_display": fmt_raw(key, v),
                     "converted": js_round(c, 1), "contribution": js_round(c * w, 2)})
    score = js_round(total / wsum if wsum > 0 else 0.0, 1)
    return score, rows


def verdict(score):
    """원본 verdictOf 경계(90·80·70·50)."""
    if score >= 90:
        return {"label": "계획의 50% 투입", "sub": "1년에 한 번 수준으로 오는 자리입니다", "tone": "good", "level": 90}
    if score >= 80:
        return {"label": "계획의 25% 투입", "sub": "1차 진입 자리입니다", "tone": "blue", "level": 80}
    if score >= 70:
        return {"label": "계획의 25% 투입", "sub": "바닥의 시작 구간입니다", "tone": "purple", "level": 70}
    if score >= 50:
        return {"label": "관망", "sub": "조정은 맞지만 아직 아닙니다", "tone": "amber", "level": 50}
    return {"label": "신규 매수 아님", "sub": "아직 바닥 자리가 아닙니다", "tone": "grey", "level": 0}


# ---------------------------------------------------------------- 지표 계산(ScoreLive.kt 그대로)

def wilder_rsi(closes, n=14):
    if len(closes) < n + 1:
        return None
    gain = loss = 0.0
    for i in range(1, n + 1):
        ch = closes[i] - closes[i - 1]
        if ch > 0:
            gain += ch
        else:
            loss -= ch
    ag, al = gain / n, loss / n
    for i in range(n + 1, len(closes)):
        ch = closes[i] - closes[i - 1]
        ag = (ag * (n - 1) + max(ch, 0.0)) / n
        al = (al * (n - 1) + max(-ch, 0.0)) / n
    if al == 0.0:
        return 100.0
    return 100 - 100 / (1 + ag / al)


def weekly_closes(series):
    """ISO 주 단위 마지막 값 — 이번 주는 아직 진행 중인 값이 들어간다."""
    out = []
    key = None
    for d, c in series:
        y, w, _ = d.isocalendar()
        k = (y, w)
        if out and key == k:
            out[-1] = c
        else:
            out.append(c)
            key = k
    return out


def stats(series):
    if not series:
        return None
    c = [x for _, x in series]
    cur = c[-1]
    peak = max(c)
    n = min(200, len(c))
    ma200 = sum(c[-n:]) / n
    return {
        "close": cur, "peak": peak, "ma200": ma200,
        "dd": (cur / peak - 1) * 100 if peak > 0 else 0.0,
        "gap": (cur / ma200 - 1) * 100 if ma200 > 0 else 0.0,
        "date": series[-1][0].isoformat(),
    }


def vix_stats(closes):
    if not closes:
        return None
    cur = closes[-1]
    n = min(50, len(closes))
    ma50 = sum(closes[-n:]) / n
    win = closes[-252:]
    return {
        "last": cur, "ma50": ma50,
        "ratio": cur / ma50 if ma50 > 0 else 0.0,
        "pctile": sum(1 for x in win if x <= cur) / len(win) * 100,
        "samples": len(win),
    }


def session_close_minutes(meta, now_et, default=16 * 60):
    """그날 정규장 마감 시각(ET 분). 반나절 장이면 13:00 처럼 짧다.

    quote 메타의 currentTradingPeriod.regular 가 오늘 것이고 길이가 6시간 미만이면
    반나절 장으로 본다(추수감사절 다음 날 등). 없으면 16:00."""
    try:
        tp = ((meta or {}).get("currentTradingPeriod") or {}).get("regular") or {}
        start, end = int(tp.get("start") or 0), int(tp.get("end") or 0)
        if start and end:
            start_et = datetime.fromtimestamp(start, ET)
            end_et = datetime.fromtimestamp(end, ET)
            if start_et.date() == now_et.date() and 0 < (end - start) < 6 * 3600:
                return end_et.hour * 60 + end_et.minute
    except Exception:
        pass
    return default


def confirmed_series(series, now_et, close_minutes=16 * 60):
    """ScoreLive.confirmed(): 오늘 봉이 아직 안 끝났으면 뺀다.

    마감 5분 뒤부터 오늘 봉을 확정으로 쓴다. 반나절 장(13:00 마감)은 13:05 부터 —
    기존에는 늘 16:05 를 기준으로 해서 반나절 장 뒤 3시간 동안 확정 값이 하루 전에 머물렀다."""
    if not series:
        return series
    minutes = now_et.hour * 60 + now_et.minute
    if series[-1][0] == now_et.date() and minutes < close_minutes + 5:
        return series[:-1]
    return series


def fold(series, px, bar_date):
    """ScoreLive.fold(): 지금 값을 마지막 봉으로 얹는다. 없는 값을 지어내지 않는다."""
    if px is None or px <= 0 or bar_date is None:
        return series
    keep = [(d, c) for d, c in series if d < bar_date]
    keep.append((bar_date, px))
    keep.sort(key=lambda x: x[0])
    return keep


def clock_session(now_et):
    """MarketClock.of() 의 경계 — 주말은 닫힘."""
    wd = now_et.weekday()  # 0=월 … 6=일
    m = now_et.hour * 60 + now_et.minute
    if wd >= 5:
        return "closed"
    if 240 <= m <= 569:
        return "pre"
    if 570 <= m <= 959:
        return "regular"
    if 960 <= m <= 1199:
        return "post"
    return "closed"


SESSION_KO = {"pre": "프리마켓", "regular": "정규장", "post": "애프터마켓", "closed": "장 마감"}


# ---------------------------------------------------------------- 국장(한국) 시세
# 정적 사이트라 탭에서 넣은 종목이 이 갱신 목록에 자동으로 실리지는 못한다.
# 그래서 대표 종목을 미리 받아 두고, 목록에 없는 종목은 화면이 증시 스냅샷(data/market.json)
# 값으로 채운다(그 값도 없으면 '값 없음'으로 둔다 — 지어내지 않는다).
KR_SYMBOLS = [
    ("005930.KS", "삼성전자"), ("000660.KS", "SK하이닉스"), ("373220.KS", "LG에너지솔루션"),
    ("207940.KS", "삼성바이오로직스"), ("005380.KS", "현대차"), ("000270.KS", "기아"),
    ("068270.KS", "셀트리온"), ("035420.KS", "NAVER"), ("035720.KS", "카카오"),
    ("051910.KS", "LG화학"), ("006400.KS", "삼성SDI"), ("005490.KS", "POSCO홀딩스"),
    ("012330.KS", "현대모비스"), ("028260.KS", "삼성물산"), ("105560.KS", "KB금융"),
    ("055550.KS", "신한지주"), ("247540.KQ", "에코프로비엠"), ("086520.KQ", "에코프로"),
    ("196170.KQ", "알테오젠"), ("028300.KQ", "HLB"),
]
KST = timezone(timedelta(hours=9))
NAVER_KR = "https://polling.finance.naver.com/api/realtime/domestic/stock/"
KR_OPEN_MIN, KR_CLOSE_MIN = 9 * 60, 15 * 60 + 30


def kst_label(ts):
    """시각 → '11-27 15:30'(KST)."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts), KST).strftime("%m-%d %H:%M")
    except Exception:
        return None


def kr_clock(now_kst, state=""):
    """국내 정규장 세션 — 09:00~15:30 KST. 주말·휴장일은 장 마감.

    미국장(프리·정규·애프터)과 달리 국장은 정규장 하나만 다룬다. 야후가 알려 준
    marketState 가 CLOSED 인데 시계는 장중이면 휴장일로 본다.
    """
    if now_kst.weekday() >= 5:
        return "closed", "주말 휴장"
    m = now_kst.hour * 60 + now_kst.minute
    if KR_OPEN_MIN <= m <= KR_CLOSE_MIN:
        if state == "CLOSED":
            return "closed", "휴장일(장 마감)"
        return "regular", "국장 정규장"
    if m < KR_OPEN_MIN:
        return "closed", "국장 장전"
    return "closed", "국장 장 마감"


def naver_names(codes):
    """국내 종목 한글 이름 — 네이버 시세 응답(키 없음, 한 번에 여러 종목). 실패하면 빈 dict."""
    out = {}
    if not codes:
        return out
    try:
        req = urllib.request.Request(NAVER_KR + ",".join(codes),
                                     headers={"User-Agent": UA, "Accept": "application/json"})
        js = json.loads(urllib.request.urlopen(req, timeout=12).read())
        for d in js.get("datas") or []:
            code = str(d.get("itemCode") or "")
            if code:
                out[code] = {"name": d.get("stockName"),
                             "suffix": ((d.get("stockExchangeType") or {}).get("code") or "")}
    except Exception:
        return out
    return out


def kr_record(now_kst, sym, quote, meta, name_ko):
    """국장 한 종목 — 미국장 심볼과 같은 이름을 쓰되 통화는 KRW, 시각은 KST."""
    code = sym.split(".")[0]
    q = quote or {}
    m = meta or {}
    reg = q.get("regularMarketPrice") or m.get("regularMarketPrice")
    prev = q.get("regularMarketPreviousClose") or m.get("previousClose") or m.get("chartPreviousClose")
    ts = q.get("regularMarketTime") or m.get("regularMarketTime")
    state = str(q.get("marketState") or m.get("marketState") or "").upper()
    session, label = kr_clock(now_kst, state)
    chg = (float(reg) / float(prev) - 1) * 100 if (reg and prev) else None
    cap = q.get("marketCap")
    return {
        "symbol": sym, "code": code, "market": "kr",
        "name": name_ko or q.get("shortName") or m.get("shortName") or sym,
        "nameEn": q.get("longName") or q.get("shortName") or m.get("shortName"),
        "currency": "KRW",
        "last": round(float(reg), 2) if reg is not None else None,
        "lastTime": iso(ts), "lastTimeKst": kst_label(ts),
        "changePct": round(chg, 3) if chg is not None else None,
        "previousClose": round(float(prev), 2) if prev else None,
        "regularClose": round(float(reg), 2) if reg is not None else None,
        "regularCloseTime": iso(ts), "regularCloseKst": kst_label(ts),
        "session": session, "sessionLabel": label,
        "sessionPrice": round(float(reg), 2) if (reg is not None and session == "regular") else None,
        "sessionTime": iso(ts) if session == "regular" else None,
        "sessionKst": kst_label(ts) if session == "regular" else None,
        "exchangeTz": "Asia/Seoul",
        "sessionChangePct": round(chg, 3) if (chg is not None and session == "regular") else None,
        "sessionNote": "국장 09:00~15:30 KST · marketState=" + (state or "?"),
        "marketState": state or None,
        "volume": q.get("regularMarketVolume"),
        "dayHigh": q.get("regularMarketDayHigh"), "dayLow": q.get("regularMarketDayLow"),
        "fiftyTwoWeekHigh": q.get("fiftyTwoWeekHigh"), "fiftyTwoWeekLow": q.get("fiftyTwoWeekLow"),
        "marketCap": cap, "marketCapCurrency": "KRW" if cap is not None else None,
        "marketCapText": cap_text(cap, "KRW") if cap is not None else None,
        "marketCapAsOf": iso(ts) if cap is not None else None,
        "source": "yahoo-quote(국장 지연)",
    }


# ---------------------------------------------------------------- 받아오기

class Fetcher:
    def __init__(self, timeout=30, retries=3):
        self.timeout = timeout
        self.retries = retries
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
        self._crumb = None
        self.calls = 0

    def _get(self, url):
        last = None
        for attempt in range(self.retries + 1):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": UA,
                    "Accept": "application/json,text/plain,*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                })
                self.calls += 1
                return json.loads(self.opener.open(req, timeout=self.timeout).read())
            except Exception as e:  # noqa: BLE001 — 어떤 실패든 다음 시도로
                last = e
                if attempt < self.retries:
                    # 야후가 잠시 막으면(429) 더 길게 쉰다. 액션 러너는 시간이 넉넉하다.
                    wait = 12 * (attempt + 1) if "429" in str(e) else 1.5 * (attempt + 1)
                    time.sleep(wait)
        raise last

    def chart(self, symbol, rng="5y", interval="1d", include_prepost=False):
        q = {"range": rng, "interval": interval, "events": "div,split",
             "includePrePost": "true" if include_prepost else "false"}
        url = CHART + urllib.parse.quote(symbol, safe="") + "?" + urllib.parse.urlencode(q)
        return self._get(url)

    def crumb(self):
        if self._crumb:
            return self._crumb
        try:  # 쿠키를 먼저 심는다(fc.yahoo.com 이 404 여도 쿠키는 내려온다)
            self.opener.open(urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent": UA}),
                             timeout=self.timeout)
        except Exception:
            pass
        try:
            self.calls += 1
            self._crumb = self.opener.open(
                urllib.request.Request(CRUMB, headers={"User-Agent": UA}), timeout=self.timeout
            ).read().decode().strip()
        except Exception:
            self._crumb = None
        return self._crumb

    def quotes(self, symbols):
        """v7 quote — 여러 심볼을 한 번에. crumb 이 없으면 chart 쪽 값으로 대신한다."""
        out = {}
        if not symbols:
            return out
        crumb = self.crumb()
        for i in range(0, len(symbols), 40):
            chunk = symbols[i:i + 40]
            q = {"symbols": ",".join(chunk)}
            if crumb:
                q["crumb"] = crumb
            url = QUOTE + "?" + urllib.parse.urlencode(q, safe=",^=.")
            try:
                js = self._get(url)
            except Exception:
                continue
            for item in (js.get("quoteResponse") or {}).get("result") or []:
                if item.get("symbol"):
                    out[item["symbol"]] = item
        return out


def bars_from_chart(js):
    """chart 응답 → [(date, close)] (UTC 날짜. 원본 YahooBarsParser 와 같다)."""
    try:
        r = js["chart"]["result"][0]
    except Exception:
        return [], {}
    stamps = r.get("timestamp") or []
    closes = ((r.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    got = {}
    for i, t in enumerate(stamps):
        c = closes[i] if i < len(closes) else None
        if c is None:
            continue
        d = datetime.fromtimestamp(t, tz=timezone.utc).date()
        got[d] = float(c)
    return sorted(got.items()), (r.get("meta") or {})


def ohlc_tail(js, n=23):
    """chart 응답 → 최근 n일 시·고·저·종. 화면의 '최근 한 달 일봉' 재료.

    일봉은 이미 점수 계산에 받고 있으므로 추가 요청이 없다. 5년치를 다 넣지 않고 꼬리만 남긴다."""
    try:
        r = js["chart"]["result"][0]
        stamps = r.get("timestamp") or []
        q = ((r.get("indicators") or {}).get("quote") or [{}])[0]
        opens, highs, lows, closes = (q.get("open") or [], q.get("high") or [],
                                      q.get("low") or [], q.get("close") or [])
    except Exception:
        return []

    def at(arr, i):
        return arr[i] if i < len(arr) else None

    rows = []
    for i, t in enumerate(stamps):
        c = at(closes, i)
        if c is None:
            continue
        o, h, l = at(opens, i), at(highs, i), at(lows, i)
        o = c if o is None else o
        h = max(o, c) if h is None else h
        l = min(o, c) if l is None else l
        rows.append({
            "d": datetime.fromtimestamp(t, tz=timezone.utc).date().isoformat(),
            "o": round(float(o), 4), "h": round(float(h), 4),
            "l": round(float(l), 4), "c": round(float(c), 4),
        })
    return rows[-n:]


def iso(ts):
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat(timespec="seconds")
    except Exception:
        return None


def et_label(ts):
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=ET).strftime("%m-%d %H:%M ET")
    except Exception:
        return None


def cap_text(v, currency):
    if v is None:
        return None
    if currency == "KRW":  # 원화는 조·억 단위로
        jo = v / 1e12
        if jo >= 1:
            eok = (v - int(jo) * 1e12) / 1e8
            return "%d조 %d억 원" % (int(jo), int(round(eok))) if int(round(eok)) else "%d조 원" % int(jo)
        return "%d억 원" % int(round(v / 1e8))
    unit = "$" if currency == "USD" else "%s " % currency
    for cut, suf in ((1e12, "T"), (1e9, "B"), (1e6, "M")):
        if v >= cut:
            return "%s%s%s" % (unit, ("%.2f" % (v / cut)).rstrip("0").rstrip("."), suf)
    return "%s%s" % (unit, "{:,}".format(int(v)))


def local_time(ts, tzname):
    """거래소 시간대(예: America/New_York, Asia/Seoul)로 적은 시각."""
    if ts is None:
        return None
    try:
        from zoneinfo import ZoneInfo
        z = ZoneInfo(tzname or "America/New_York")
        return datetime.fromtimestamp(int(ts), tz=z).strftime("%m-%d %H:%M")
    except Exception:
        return et_label(ts)


def pick_session(now_et, quote, meta):
    """지금 값이 어느 세션의 체결인지. 시계와 quote 의 marketState 를 함께 본다.

    반환: (session, price, time_ts, source_note)
    """
    clk = clock_session(now_et)
    today = now_et.date()
    st = str((quote or {}).get("marketState") or (meta or {}).get("marketState") or "").upper()

    def fresh(ts):
        """그 시각이 오늘(ET) 것인가 — 어제 애프터마켓 값이 오늘 값처럼 보이지 않게."""
        if not ts:
            return False
        try:
            return datetime.fromtimestamp(int(ts), tz=ET).date() == today
        except Exception:
            return False

    cand = {}
    if quote:
        if quote.get("preMarketPrice"):
            cand["pre"] = (quote["preMarketPrice"], quote.get("preMarketTime"))
        if quote.get("regularMarketPrice"):
            cand["regular"] = (quote["regularMarketPrice"], quote.get("regularMarketTime"))
        if quote.get("postMarketPrice"):
            cand["post"] = (quote["postMarketPrice"], quote.get("postMarketTime"))

    tzname = (quote or {}).get("exchangeTimezoneName") or (meta or {}).get("exchangeTimezoneName") or ""
    # 미 동부·중부(시카고=CBOE)는 미국 장으로 본다. 그 밖(서울 등)은 자기 거래소 장 상태만 쓴다.
    us = tzname in ("", "America/New_York", "America/Chicago")
    is_index = str((quote or {}).get("symbol") or (meta or {}).get("symbol") or "").startswith("^")

    # 미국 밖 거래소(예: 한국)는 미 동부 시계로 판정하지 않는다. 거래소가 알려 준 장 상태만 쓴다.
    if not us:
        m = {"PRE": "pre", "REGULAR": "regular", "POST": "post"}.get(st, "closed")
        px, ts = cand.get(m, (None, None))
        if m == "closed":
            return "closed", None, None, "exchange=" + tzname + " state=" + (st or "?")
        if px and fresh(ts):
            return m, px, ts, "exchange=" + tzname + " state=" + st
        return m, None, None, "exchange=" + tzname + " 체결 없음"

    # 지수(^)는 장외 체결이 없다 — 시계를 따르되, 오늘 값이 이미 움직였으면(VIX) 그 시각을 인정한다.
    has_ext = (quote or {}).get("hasPrePostMarketData")
    if is_index or has_ext is False:
        if clk != "closed" and cand.get("regular") and fresh(cand["regular"][1]):
            return clk, cand["regular"][0], cand["regular"][1], "지수(장외 필드 없음) " + clk
        return "closed", None, None, "지수(장외 필드 없음)"

    # quote 가 시계와 다른 세션을 말하면(반나절 장 마감 등) quote 쪽을 믿는다.
    if st in ("PRE", "REGULAR", "POST"):
        want = st.lower()
        px, ts = cand.get(want, (None, None))
        if px and fresh(ts):
            return want, px, ts, "quote.marketState=" + st
    if st == "CLOSED" and clk != "closed":
        # 휴장일: 시계는 장중이라 하지만 시세가 닫혀 있다
        return "closed", None, None, "quote.marketState=CLOSED(휴장)"

    px, ts = cand.get(clk, (None, None))
    if px and fresh(ts):
        return clk, px, ts, "clock"
    if clk != "closed":
        return clk, None, None, "체결 없음"
    return "closed", None, None, "clock=closed"


def build_symbol(now_et, symbol, quote, series, meta, fx):
    """한 심볼 몫. 실패는 예외로 올려 부르는 쪽이 판단한다."""
    st = stats(series)
    if st is None:
        raise RuntimeError(symbol + ": 일봉이 없습니다")
    regular_close = None
    regular_ts = (quote or {}).get("regularMarketTime") or (meta or {}).get("regularMarketTime")
    if quote and quote.get("regularMarketPrice"):
        regular_close = float(quote["regularMarketPrice"])
    elif meta and meta.get("regularMarketPrice"):
        regular_close = float(meta["regularMarketPrice"])
    prev_close = None
    if quote:
        prev_close = quote.get("regularMarketPreviousClose")
    if prev_close is None:
        prev_close = (meta or {}).get("previousClose") or (meta or {}).get("chartPreviousClose")

    session, s_px, s_ts, note = pick_session(now_et, quote, meta)

    # 지금 값 — 세션 체결가가 있으면 그것, 없으면 정규장 마지막 값
    last = s_px if s_px else regular_close
    last_ts = s_ts if s_px else regular_ts

    # 등락률의 기준은 언제나 '직전 정규장 종가'다. 장전 값은 그 종가와 비교해야 뜻이 맞다.
    reg = float(regular_close) if regular_close else None
    prev = float(prev_close) if prev_close else None
    session_chg = (s_px / reg - 1) * 100 if (s_px is not None and reg) else None
    regular_chg = (reg / prev - 1) * 100 if (reg and prev) else None
    # 장전·장후 값이 마지막 정규장 종가와 같은 값이면(지수처럼 계속 갱신되는 상품) 그날 등락률을 쓴다
    if s_px is not None and reg and abs(s_px - reg) > 1e-9:
        change_pct = (s_px / reg - 1) * 100
    else:
        change_pct = regular_chg

    cur = (quote or {}).get("currency") or (meta or {}).get("currency") or "USD"
    tzname = (quote or {}).get("exchangeTimezoneName") or (meta or {}).get("exchangeTimezoneName") or "America/New_York"
    cap = (quote or {}).get("marketCap")
    out = {
        "symbol": symbol,
        "name": (quote or {}).get("shortName") or (quote or {}).get("longName") or (meta or {}).get("shortName"),
        "currency": cur,
        "last": round(last, 4) if last is not None else None,
        "lastTime": iso(last_ts),
        "lastTimeEt": et_label(last_ts),
        "changePct": round(change_pct, 3) if change_pct is not None else None,
        "previousClose": round(float(prev_close), 4) if prev_close else None,
        "regularClose": round(regular_close, 4) if regular_close is not None else None,
        "regularCloseTime": iso(regular_ts),
        "regularCloseEt": et_label(regular_ts),
        "regularCloseLocal": local_time(regular_ts, tzname),
        "regularCloseDate": st["date"],
        "session": session,
        "sessionLabel": SESSION_KO.get(session),
        "sessionPrice": round(s_px, 4) if s_px is not None else None,
        "sessionTime": iso(s_ts),
        "sessionTimeEt": et_label(s_ts),
        "sessionTimeLocal": local_time(s_ts, tzname),
        "exchangeTz": tzname,
        "sessionChangePct": round(session_chg, 3) if session_chg is not None else None,
        "regularChangePct": round(regular_chg, 3) if regular_chg is not None else None,
        "sessionNote": note,
        "marketState": (quote or {}).get("marketState") or (meta or {}).get("marketState"),
        "volume": (quote or {}).get("regularMarketVolume"),
        "dayHigh": (quote or {}).get("regularMarketDayHigh"),
        "dayLow": (quote or {}).get("regularMarketDayLow"),
        "fiftyTwoWeekHigh": (quote or {}).get("fiftyTwoWeekHigh"),
        "fiftyTwoWeekLow": (quote or {}).get("fiftyTwoWeekLow"),
        "marketCap": cap,
        "marketCapCurrency": cur if cap is not None else None,
        "marketCapText": cap_text(cap, cur) if cap is not None else None,
        "marketCapAsOf": iso(last_ts) if cap is not None else None,
        "marketCapKrw": int(cap * fx["usdkrw"]) if (cap is not None and cur == "USD" and fx.get("usdkrw")) else None,
        "marketCapKrwText": cap_text(cap * fx["usdkrw"], "KRW") if (cap is not None and cur == "USD" and fx.get("usdkrw")) else None,
        "source": "yahoo-chart-1d" + ("+yahoo-quote" if quote else ""),
    }
    return out


def scores_for(symbol, series, now_et, key, vix_series, live_px, live_session, close_minutes=16 * 60):
    """확정(종가) 점수와 실시간(추정) 점수."""
    # 오늘(ET)보다 뒤 날짜의 봉은 쓰지 않는다 — 시각대에 따라 생길 수 있는 미래 봉을 막는다
    series = [x for x in series if x[0] <= now_et.date()]
    vix_series = [x for x in vix_series if x[0] <= now_et.date()]
    conf = confirmed_series(series, now_et, close_minutes)
    if len(conf) < 200:
        raise RuntimeError(symbol + ": 일봉이 200개 미만이라 지표를 낼 수 없습니다")
    vconf = confirmed_series(vix_series, now_et, close_minutes)
    vc = vix_stats([c for _, c in vconf])
    # 원본 규칙: VIX 는 장외에 거의 안 움직인다 — 장중이라도 확정 봉까지만 쓴다.

    def values_for(seq, vstats, target):
        """지표 값 — **반올림하지 않은 원값**으로 점수를 낸다.

        원본 앱이 남긴 점수 이력(data/scores.json, 277거래일)과 대조해 보니 원값으로 계산할 때
        265일이 소수점까지 같았고, 중간값을 반올림하면 111~134일이 0.1 어긋났다.
        화면에 적는 raw 표기만 소수 2자리로 다듬는다.
        """
        st = stats(seq)
        return {
            "dd": abs(st["dd"]),
            "wrsi": wilder_rsi(weekly_closes(seq)),
            "vixr": vstats["ratio"] if vstats else None,
            "gap": st["gap"],
            "drsi": wilder_rsi([c for _, c in seq]),
            "vixp": vstats["pctile"] if vstats else None,
        }, st

    values, cst = values_for(conf, vc, key)
    score, rows = singular_score(values, key)
    confirmed = {
        "score": score, "verdict": verdict(score), "rows": rows,
        "asOf": cst["date"], "basis": "close",
        "dd": js_round(cst["dd"], 2), "close": js_round(cst["close"], 2),
        "peak": js_round(cst["peak"], 2), "ma200": js_round(cst["ma200"], 2),
        "values": values,
        "vix": {"last": js_round(vc["last"], 2), "ma50": js_round(vc["ma50"], 2), "ratio": js_round(vc["ratio"], 3),
                "pctile": js_round(vc["pctile"], 2), "samples": vc["samples"]} if vc else None,
    }

    live = None
    if live_px and live_session in ("pre", "regular", "post"):
        # 지금 값을 '진행 중인 봉' 하나로 얹는다. 봉 날짜는 오늘(ET).
        bar_date = now_et.date()
        if now_et.weekday() >= 5:
            bar_date = None  # 주말엔 새 봉을 만들지 않는다
        if bar_date is not None:
            seq = fold(conf, live_px, bar_date)
            values_l, lst = values_for(seq, vc, key)
            score_l, rows_l = singular_score(values_l, key)
            live = {
                "score": score_l, "verdict": verdict(score_l), "rows": rows_l,
                "asOf": lst["date"], "basis": live_session,
                "dd": js_round(lst["dd"], 2), "close": js_round(lst["close"], 2),
                "peak": js_round(lst["peak"], 2), "ma200": js_round(lst["ma200"], 2),
                "values": values_l,
                "priceUsed": round(live_px, 4),
            }
    return confirmed, live


def load_watchlist(path):
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except Exception:
        return []
    syms = doc.get("symbols") if isinstance(doc, dict) else doc
    if not isinstance(syms, list):
        return []
    out = []
    for s in syms:
        if isinstance(s, str) and s.strip():
            s = s.strip().upper()
            if s not in out:
                out.append(s)
    return out


def main(argv=None):
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    ap = argparse.ArgumentParser(description="야후 시세로 data/live.json 을 갱신한다(키 없음)")
    ap.add_argument("--out", default=os.path.join(root, "data", "live.json"))
    ap.add_argument("--watchlist", default=os.path.join(root, "data", "watchlist.json"))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--now", default=None, help="점검용: ISO 시각을 지금으로 고정")
    ap.add_argument("--only", default=None, help="점검용: 이 심볼들만(쉼표)")
    args = ap.parse_args(argv)

    now_utc = datetime.now(tz=timezone.utc)
    if args.now:
        now_utc = datetime.fromisoformat(args.now.replace("Z", "+00:00")).astimezone(timezone.utc)
    now_et = now_utc.astimezone(ET)

    watch = load_watchlist(args.watchlist)
    symbols = list(REQUIRED)
    for s in watch:
        if s not in symbols:
            symbols.append(s)
    if args.only:
        # 점검용 — 이 모드로 실제 파일을 쓰면 일부 심볼만 담긴 파일로 덮어쓰게 된다. 막는다.
        if not args.dry_run:
            print("--only 는 --dry-run 과 함께만 쓸 수 있습니다(파일을 줄여 덮어쓰지 않도록).", file=sys.stderr)
            return 2
        symbols = [s.strip().upper() for s in args.only.split(",") if s.strip()]

    fx = Fetcher()
    errors = []
    old = {}
    try:
        with open(args.out, encoding="utf-8") as f:
            old = json.load(f)
    except Exception:
        old = {}

    # 1) 환율(원/달러) — 시가총액 원화 환산에만 쓴다. 실패해도 계속.
    usdkrw = None
    fx_time = None
    try:
        js = fx.chart("KRW=X", rng="1d", interval="1d")
        m = (js["chart"]["result"][0].get("meta") or {})
        usdkrw = m.get("regularMarketPrice")
        fx_time = iso(m.get("regularMarketTime"))
    except Exception as e:  # noqa: BLE001
        errors.append("fx: " + str(e)[:120])
    fxinfo = {"usdkrw": round(usdkrw, 2) if usdkrw else None, "time": fx_time,
              "source": "yahoo KRW=X" if usdkrw else None}

    # 2) 지금 값 — 여러 심볼을 한 번에
    quotes = {}
    try:
        quotes = fx.quotes(symbols)
    except Exception as e:  # noqa: BLE001
        errors.append("quote: " + str(e)[:120])

    # 3) 일봉 — 점수 대상 세 개만
    need_daily = [s for s in REQUIRED if s in ("TQQQ", "SOXL", "^VIX")]
    daily = {}
    metas = {}
    tails = {}
    for s in need_daily:
        try:
            js = fx.chart(s, rng="5y", interval="1d")
            bars, meta = bars_from_chart(js)
            if len(bars) < 250:
                raise RuntimeError("일봉 " + str(len(bars)) + "개")
            daily[s] = bars
            metas[s] = meta
            tails[s] = ohlc_tail(js, 23)
        except Exception as e:  # noqa: BLE001
            errors.append(s + ": " + str(e)[:120])

    missing = [s for s in need_daily if s not in daily]
    if missing:
        # 필수 일봉을 못 받았다 → 기존 파일 유지, 0이 아닌 종료
        print("실패: 필수 일봉을 받지 못했습니다 → " + ", ".join(missing), file=sys.stderr)
        for e in errors:
            print("  " + e, file=sys.stderr)
        print("기존 파일을 그대로 두었습니다: " + args.out, file=sys.stderr)
        return 1

    vix_series = daily["^VIX"]
    symbols_out = {}
    partial = []

    # 점수 대상 두 심볼
    for key, sym in SCORE_SYMBOLS.items():
        q = quotes.get(sym) or {}
        meta = metas.get(sym) or {}
        try:
            base = build_symbol(now_et, sym, q, daily[sym], meta, fxinfo)
            close_min = session_close_minutes(meta, now_et)
            conf, live = scores_for(sym, daily[sym], now_et, key, vix_series,
                                    base["sessionPrice"], base["session"], close_min)
            base["score"] = conf["score"]
            base["scoreAsOf"] = conf["asOf"]
            base["scoreBasis"] = "close"
            base["scoreVerdict"] = conf["verdict"]
            base["scoreRows"] = conf["rows"]
            base["scoreValues"] = conf["values"]
            base["scoreDetail"] = {"close": conf["close"], "peak": conf["peak"],
                                   "ma200": conf["ma200"], "dd": conf["dd"], "vix": conf["vix"]}
            base["scoreLive"] = live["score"] if live else None
            base["scoreLiveAsOf"] = live["asOf"] if live else None
            base["scoreLiveBasis"] = live["basis"] if live else None
            base["scoreLiveVerdict"] = live["verdict"] if live else None
            base["scoreLiveRows"] = live["rows"] if live else None
            base["scoreLivePrice"] = live["priceUsed"] if live else None
            base["scoreLiveValues"] = live["values"] if live else None
            base["dayBars"] = tails.get(sym) or []
            base["target"] = key
            symbols_out[sym] = base
        except Exception as e:  # noqa: BLE001
            print("실패: " + sym + " — " + str(e)[:160], file=sys.stderr)
            print("기존 파일을 그대로 두었습니다: " + args.out, file=sys.stderr)
            return 1

    # ^NDX — 점수는 없지만 지금 지수와 낙폭을 담는다
    try:
        js = fx.chart("^NDX", rng="5y", interval="1d")
        bars, meta = bars_from_chart(js)
        if len(bars) < 250:
            raise RuntimeError("일봉 " + str(len(bars)) + "개")
        ndx = build_symbol(now_et, "^NDX", quotes.get("^NDX") or {}, bars, meta, fxinfo)
        symbols_out["^NDX"] = ndx
    except Exception as e:  # noqa: BLE001
        errors.append("^NDX: " + str(e)[:120])
        partial.append("^NDX")

    # ^VIX
    try:
        vq = quotes.get("^VIX") or {}
        vmeta = metas.get("^VIX") or {}
        v = build_symbol(now_et, "^VIX", vq, vix_series, vmeta, fxinfo)
        vst = vix_stats([c for _, c in confirmed_series(vix_series, now_et)])
        if vst:
            v["vix"] = {"last": round(vst["last"], 2), "ma50": round(vst["ma50"], 2),
                        "ratio": round(vst["ratio"], 3), "pctile": round(vst["pctile"], 2),
                        "samples": vst["samples"]}
        symbols_out["^VIX"] = v
    except Exception as e:  # noqa: BLE001
        print("실패: ^VIX — " + str(e)[:160], file=sys.stderr)
        print("기존 파일을 그대로 두었습니다: " + args.out, file=sys.stderr)
        return 1

    # 관심 종목 — 일봉 없이 지금 값만. 실패한 심볼은 이전 값을 이어 쓴다.
    for sym in symbols:
        if sym in symbols_out or sym in REQUIRED:
            continue
        q = quotes.get(sym)
        if not q or not (q.get("regularMarketPrice") or q.get("preMarketPrice") or q.get("postMarketPrice")):
            prev = (old.get("symbols") or {}).get(sym)
            if prev:
                symbols_out[sym] = prev
                partial.append(sym)
            else:
                partial.append(sym)
            continue
        symbols_out[sym] = quote_only(now_et, sym, q, fxinfo)

    # 국장 — 미국장 필수 심볼과 분리해 받는다. 한 종목이 실패해도 그 종목만 빠지고 파일은 쓴다.
    kr_syms = {}
    kr_partial = []
    kr_error = None
    now_kst = now_utc.astimezone(KST)
    kr_doc = {"session": None, "sessionLabel": None, "kst": now_kst.strftime("%Y-%m-%d %H:%M"),
              "open": "09:00", "close": "15:30", "symbols": [], "partial": []}
    try:
        names = naver_names([s.split(".")[0] for s, _ in KR_SYMBOLS])
        try:
            kr_quotes = fx.quotes([s for s, _ in KR_SYMBOLS]) or {}
        except Exception as e:  # noqa: BLE001
            kr_quotes = {}
            kr_error = "quote: " + str(e)[:80]
        for sym, name_ko in KR_SYMBOLS:
            code = sym.split(".")[0]
            q = kr_quotes.get(sym) or {}
            meta = {}
            if not q.get("regularMarketPrice"):
                try:  # quote 에 없으면 chart 메타로 한 번 더
                    js = fx.chart(sym, rng="1d", interval="1d")
                    meta = (js["chart"]["result"][0].get("meta") or {})
                except Exception as e:  # noqa: BLE001
                    prev = (old.get("symbols") or {}).get(sym)
                    if prev and prev.get("market") == "kr":
                        kr_syms[sym] = prev
                    kr_partial.append(code)
                    kr_error = kr_error or (code + ": " + str(e)[:80])
                    continue
            try:
                nm = (names.get(code) or {}).get("name") or name_ko
                rec = kr_record(now_kst, sym, q, meta, nm)
                if rec.get("last") is None:
                    raise RuntimeError("값 없음")
                suf = (names.get(code) or {}).get("suffix")
                if suf:
                    rec["suffix"] = suf
                kr_syms[sym] = rec
            except Exception as e:  # noqa: BLE001
                prev = (old.get("symbols") or {}).get(sym)
                if prev and prev.get("market") == "kr":
                    kr_syms[sym] = prev
                kr_partial.append(code)
                kr_error = kr_error or (code + ": " + str(e)[:80])
        kr_session, kr_label = kr_clock(now_kst, "")
        # 시계는 장중인데 모두 CLOSED 면 휴장일로 적는다
        states = [r.get("marketState") for r in kr_syms.values() if r.get("marketState")]
        mnow = now_kst.hour * 60 + now_kst.minute
        if (states and all(s == "CLOSED" for s in states) and now_kst.weekday() < 5
                and KR_OPEN_MIN <= mnow <= KR_CLOSE_MIN):
            kr_session, kr_label = "closed", "휴장일(장 마감)"
        kr_doc.update({
            "session": kr_session, "sessionLabel": kr_label,
            "kst": now_kst.strftime("%Y-%m-%d %H:%M"),
            "note": ("국내 정규장 09:00~15:30 KST · 미국장과 세션이 다름 · "
                     "지연될 수 있음. 목록 밖 종목은 화면이 증시 스냅샷으로 채운다."),
            "symbols": list(kr_syms), "partial": kr_partial,
        })
        if kr_error:
            kr_doc["error"] = kr_error
        symbols_out.update(kr_syms)
    except Exception as e:  # noqa: BLE001 — 국장 실패가 미국장 파일을 막지 않는다
        errors.append("kr: " + str(e)[:120])
        kr_doc.update({"symbols": list(kr_syms), "partial": kr_partial, "error": str(e)[:160]})

    market = {
        "session": clock_session(now_et),
        "sessionLabel": SESSION_KO.get(clock_session(now_et)),
        "et": now_et.strftime("%Y-%m-%d %H:%M ET"),
        "etDate": now_et.date().isoformat(),
        "isHalfDay": False,
        "note": "프리마켓 04:00~09:29, 정규장 09:30~16:00, 애프터마켓 16:00~19:59 (미 동부)",
    }
    # 반나절 장(추수감사절 다음 날 등) 표시 — quote 의 장 마감 시각이 16:00 이 아니면
    try:
        tp = (((metas.get("TQQQ") or {}).get("currentTradingPeriod") or {}).get("regular") or {})
        if tp.get("start") and tp.get("end"):
            span = int(tp["end"]) - int(tp["start"])
            same_day = datetime.fromtimestamp(int(tp["start"]), ET).date() == now_et.date()
            if 0 < span < 6 * 3600 and same_day:
                market["isHalfDay"] = True
                market["regularEndEt"] = et_label(tp["end"])
    except Exception:
        pass

    doc = {
        "schema": 1,
        "updatedAt": now_utc.isoformat(timespec="seconds"),
        "updatedAtKst": now_utc.astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M"),
        "market": market,
        "kr": kr_doc,
        "fx": fxinfo,
        "required": REQUIRED,
        "watchlistCount": len(watch),
        "partial": partial,
        "errors": errors,
        "sources": ["yahoo chart v8 (일봉·시세, 키 없음)", "yahoo quote v7 + crumb (시가총액·프리/애프터)"],
        "note": ("브라우저에는 이 파일만 간다. 지연될 수 있고, 값이 없으면 null 이다(지어내지 않음). "
                 "점수는 확정 종가 기준(score)과 프리/애프터를 얹은 추정(scoreLive) 두 벌이다."),
        "symbols": symbols_out,
    }

    # 한 줄짜리로 쓴다(사람이 읽을 일은 없다). 5분마다 커밋되므로 크기를 줄여 두는 편이 낫다.
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
    if args.dry_run:
        print(text)
        return 0

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, args.out)

    tq = symbols_out.get("TQQQ", {})
    print("live.json: %d심볼 (국장 %d) · %s · TQQQ %s(%s) 점수 %s / 실시간 %s · partial %d · calls %d"
          % (len(symbols_out), len(kr_syms), market["session"], tq.get("last"), tq.get("session"),
             tq.get("score"), tq.get("scoreLive"), len(partial), fx.calls))
    return 0


def quote_only(now_et, sym, q, fxinfo):
    """일봉 없이 지금 값만 담는 심볼(관심 종목)."""
    base = {
        "symbol": sym,
        "name": q.get("shortName") or q.get("longName"),
        "currency": q.get("currency") or "USD",
    }
    session, s_px, s_ts, note = pick_session(now_et, q, {})
    prev = q.get("regularMarketPreviousClose")
    reg = q.get("regularMarketPrice")
    last = s_px or reg
    cap = q.get("marketCap")
    cur = base["currency"]
    tzname = q.get("exchangeTimezoneName") or "America/New_York"
    out = dict(base)
    out.update({
        "last": round(last, 4) if last is not None else None,
        "lastTime": iso(s_ts if s_px else q.get("regularMarketTime")),
        "lastTimeEt": et_label(s_ts if s_px else q.get("regularMarketTime")),
        "changePct": round(((last / reg - 1) * 100) if (last and reg and abs(last - reg) > 1e-9)
                           else ((reg / prev - 1) * 100 if (reg and prev) else None), 3) if (last and reg) else None,
        "previousClose": prev,
        "regularClose": round(q["regularMarketPrice"], 4) if q.get("regularMarketPrice") else None,
        "regularCloseTime": iso(q.get("regularMarketTime")),
        "regularCloseEt": et_label(q.get("regularMarketTime")),
        "regularCloseLocal": local_time(q.get("regularMarketTime"), tzname),
        "session": session,
        "sessionLabel": SESSION_KO.get(session),
        "sessionPrice": round(s_px, 4) if s_px is not None else None,
        "sessionTime": iso(s_ts),
        "sessionTimeEt": et_label(s_ts),
        "sessionTimeLocal": local_time(s_ts, tzname),
        "exchangeTz": tzname,
        "sessionChangePct": round((s_px / reg - 1) * 100, 3) if (s_px and reg) else None,
        "regularChangePct": round((reg / prev - 1) * 100, 3) if (reg and prev) else None,
        "sessionNote": note,
        "marketState": q.get("marketState"),
        "volume": q.get("regularMarketVolume"),
        "dayHigh": q.get("regularMarketDayHigh"),
        "dayLow": q.get("regularMarketDayLow"),
        "fiftyTwoWeekHigh": q.get("fiftyTwoWeekHigh"),
        "fiftyTwoWeekLow": q.get("fiftyTwoWeekLow"),
        "marketCap": cap,
        "marketCapCurrency": cur if cap is not None else None,
        "marketCapText": cap_text(cap, cur) if cap is not None else None,
        "marketCapAsOf": iso(q.get("regularMarketTime")) if cap is not None else None,
        "marketCapKrw": int(cap * fxinfo["usdkrw"]) if (cap is not None and cur == "USD" and fxinfo.get("usdkrw")) else None,
        "marketCapKrwText": cap_text(cap * fxinfo["usdkrw"], "KRW") if (cap is not None and cur == "USD" and fxinfo.get("usdkrw")) else None,
        "source": "yahoo-quote",
    })
    return out


if __name__ == "__main__":
    sys.exit(main())
