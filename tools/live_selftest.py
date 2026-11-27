#!/usr/bin/env python3
"""live_update.py 계산·세션 판정 자기 점검 — 네트워크 없이 돈다.

  python3 tools/live_selftest.py            # 저장해 둔 일봉이 있으면 함께 대조
  python3 tools/live_selftest.py --bars DIR # scratch 등에 받아 둔 TQQQ.json/SOXL.json/VIX.json

확인 항목
  1) 점수 식이 원본 앱 스냅샷(data/scores.json, 2026-11-20)과 같은가 — TQQQ 98.6 / SOXL 97.6
  2) 프리·정규·장후·휴장·주말 판정이 시계와 quote 를 함께 볼 때 맞는가
  3) 실시간(추정) 점수가 프리마켓 값을 얹었을 때만 달라지는가
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_update as L  # noqa: E402

ET = L.ET
fails = []


def check(name, ok, note=""):
    print(("PASS  " if ok else "FAIL  ") + name + ("   " + str(note) if note else ""))
    if not ok:
        fails.append(name)


def load_bars(path):
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return [(datetime.fromisoformat(d).date(), float(c)) for d, c in raw]


def session_tests():
    # 2026-11-27(금) 각 시각의 ET 시계
    def et(s):
        return datetime.fromisoformat(s).replace(tzinfo=ET)

    q_pre = {"marketState": "PRE", "preMarketPrice": 48.15, "preMarketTime": et("2026-11-27T09:03:00").timestamp(),
             "regularMarketPrice": 45.28, "regularMarketTime": et("2026-11-25T16:00:00").timestamp(),
             "hasPrePostMarketData": True}
    s, px, ts, _ = L.pick_session(et("2026-11-27T09:05:00"), q_pre, {})
    check("프리마켓 판정", s == "pre" and abs(px - 48.15) < 1e-9, (s, px))

    q_reg = dict(q_pre, marketState="REGULAR",
                 regularMarketTime=et("2026-11-27T11:00:00").timestamp())
    s, px, _ts, _ = L.pick_session(et("2026-11-27T11:05:00"), q_reg, {})
    check("정규장 판정", s == "regular" and abs(px - 45.28) < 1e-9, (s, px))

    q_post = {"marketState": "POST", "postMarketPrice": 46.1,
              "postMarketTime": et("2026-11-27T13:10:00").timestamp(),
              "regularMarketPrice": 45.9, "regularMarketTime": et("2026-11-27T13:00:00").timestamp(),
              "hasPrePostMarketData": True}
    # 반나절 장(13:00 마감) 뒤 — 시계는 아직 '정규장'이라 하지만 quote 는 POST
    s, px, _ts, _ = L.pick_session(et("2026-11-27T13:15:00"), q_post, {})
    check("반나절 장 마감 뒤 장후 판정", s == "post" and abs(px - 46.1) < 1e-9, (s, px))

    # 어제 장후 값이 오늘 장전으로 둔갑하지 않는가
    q_stale = {"marketState": "PRE", "preMarketPrice": 99.0,
               "preMarketTime": et("2026-11-25T18:00:00").timestamp(),
               "regularMarketPrice": 45.28, "regularMarketTime": et("2026-11-25T16:00:00").timestamp(),
               "hasPrePostMarketData": True}
    s, px, _ts, note = L.pick_session(et("2026-11-27T05:00:00"), q_stale, {})
    check("어제 장후 값을 오늘 장전으로 쓰지 않음", s == "pre" and px is None, (s, px, note))

    # 휴장일(추수감사절) — 시계는 장전, 시세는 닫힘
    q_hol = {"marketState": "CLOSED", "regularMarketPrice": 45.28,
             "regularMarketTime": et("2026-11-25T16:00:00").timestamp(), "hasPrePostMarketData": True}
    s, px, _ts, _ = L.pick_session(et("2026-11-26T09:00:00"), q_hol, {})
    check("휴장일 판정", s == "closed" and px is None, (s, px))

    # 주말
    q_we = {"marketState": "CLOSED", "regularMarketPrice": 45.28,
            "regularMarketTime": et("2026-11-27T13:00:00").timestamp(), "hasPrePostMarketData": True}
    s, px, _ts, _ = L.pick_session(et("2026-11-28T12:00:00"), q_we, {})
    check("주말 판정", s == "closed" and px is None, (s, px))
    check("주말 시계", L.clock_session(et("2026-11-28T12:00:00")) == "closed")

    # 지수는 장외 체결이 없다 → 장전이라도 닫힘
    q_idx = {"marketState": "PRE", "regularMarketPrice": 26046.9,
             "regularMarketTime": et("2026-11-25T17:15:00").timestamp(), "hasPrePostMarketData": False}
    s, px, _ts, _ = L.pick_session(et("2026-11-27T08:30:00"), q_idx, {})
    check("지수는 장외 값을 만들지 않음", s == "closed" and px is None, (s, px))


def score_tests(barsdir, snap):
    if not barsdir:
        print("(일봉 폴더가 없어 점수 대조는 건너뜁니다)")
        return
    need = ["TQQQ", "SOXL", "VIX"]
    paths = {k: os.path.join(barsdir, k + ".json") for k in need}
    if not all(os.path.exists(p) for p in paths.values()):
        print("(일봉 파일이 없어 점수 대조는 건너뜁니다: " + barsdir + ")")
        return
    tq = load_bars(paths["TQQQ"])
    sx = load_bars(paths["SOXL"])
    vx = load_bars(paths["VIX"])
    # 2026-11-20 16:30 ET — 그날 정규장이 끝난 뒤
    now = datetime.fromisoformat("2026-11-20T16:30:00").replace(tzinfo=ET)
    c1, _ = L.scores_for("TQQQ", tq, now, "ndx", vx, None, "closed")
    c2, _ = L.scores_for("SOXL", sx, now, "sox", vx, None, "closed")
    want = snap["targets"]
    check("점수 TQQQ 2026-11-20 일치", c1["score"] == want["ndx"]["score"], (c1["score"], want["ndx"]["score"]))
    check("점수 SOXL 2026-11-20 일치", c2["score"] == want["sox"]["score"], (c2["score"], want["sox"]["score"]))
    check("낙폭 TQQQ 일치", c1["dd"] == want["ndx"]["dd"], (c1["dd"], want["ndx"]["dd"]))
    check("낙폭 SOXL 일치", c2["dd"] == want["sox"]["dd"], (c2["dd"], want["sox"]["dd"]))
    check("200일선 TQQQ 일치", c1["ma200"] == want["ndx"]["detail"]["ma200"], (c1["ma200"], want["ndx"]["detail"]["ma200"]))
    check("VIX 비율 일치", c1["rows"][2]["raw"] == want["ndx"]["rows"][2]["raw"],
          (c1["rows"][2]["raw"], want["ndx"]["rows"][2]["raw"]))

    # 실시간(추정) — 프리마켓 값을 얹으면 점수가 다시 계산된다
    live_pre = 48.16
    now2 = datetime.fromisoformat("2026-11-27T09:05:00").replace(tzinfo=ET)
    c, lv = L.scores_for("TQQQ", tq, now2, "ndx", vx, live_pre, "pre")
    check("장전에도 확정 점수는 마지막 종가 기준", c["asOf"] == "2026-11-25", c["asOf"])
    check("실시간(추정) 점수는 장전 값을 얹어 다름", lv is not None and lv["score"] != c["score"],
          (None if lv is None else lv["score"], c["score"]))
    check("실시간 점수 낙폭은 장전 가격 기준", lv is not None and lv["dd"] > c["dd"], (None if lv is None else lv["dd"], c["dd"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bars", default=None)
    ap.add_argument("--scores", default=os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "data", "scores.json"))
    a = ap.parse_args()
    snap = None
    if os.path.exists(a.scores):
        with open(a.scores, encoding="utf-8") as f:
            snap = json.load(f)
    session_tests()
    if snap:
        score_tests(a.bars, snap)
    print()
    print("실패 %d개" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
