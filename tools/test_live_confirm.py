#!/usr/bin/env python3
"""확정(종가) 경계 검사 — 5분 파이프라인이 '마지막 완료 정규장'을 제대로 고르는지.

    python3 tools/test_live_confirm.py

네트워크를 쓰지 않는다(now_et·메타를 손으로 넣는다).
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_update as lu  # noqa: E402

ET = lu.ET
FAIL = []


def check(name, got, want):
    ok = got == want
    print(('PASS  ' if ok else 'FAIL  ') + name + '   ' + str(got) + ('' if ok else ' (기대 ' + str(want) + ')'))
    if not ok:
        FAIL.append(name)


def meta_for(day, close_et):
    """그날 정규장 시작 09:30 ET, 마감 close_et 인 메타를 만든다."""
    start = datetime(day.year, day.month, day.day, 9, 30, tzinfo=ET)
    end = datetime(day.year, day.month, day.day, close_et[0], close_et[1], tzinfo=ET)
    return {"currentTradingPeriod": {"regular": {"start": int(start.timestamp()), "end": int(end.timestamp())}}}


d = datetime(2026, 11, 27).date()            # 반나절 장(추수감사절 다음 날)
series = [(datetime(2026, 11, 24).date(), 45.0), (datetime(2026, 11, 25).date(), 45.3),
          (d, 46.0)]

# 1) 반나절 장 마감(13:00) 전 — 오늘 봉은 확정이 아니다
now = datetime(2026, 11, 27, 12, 50, tzinfo=ET)
m_half = meta_for(d, (13, 0))
check('마감 시각(반나절) = 13:00', lu.session_close_minutes(m_half, now), 13 * 60)
check('12:50 ET — 오늘 봉 제외', lu.confirmed_series(series, now, lu.session_close_minutes(m_half, now))[-1][0],
      datetime(2026, 11, 25).date())

# 2) 반나절 장 마감 5분 뒤 — 오늘 봉이 확정으로 들어온다
now2 = datetime(2026, 11, 27, 13, 10, tzinfo=ET)
check('13:10 ET — 오늘 봉 포함', lu.confirmed_series(series, now2, lu.session_close_minutes(m_half, now2))[-1][0],
      d)

# 3) 보통 장(16:00) 기준
m_full = meta_for(d, (16, 0))
check('마감 시각(보통) = 16:00', lu.session_close_minutes(m_full, now2), 16 * 60)
check('13:10 ET 보통장 — 오늘 봉 제외', lu.confirmed_series(series, now2, lu.session_close_minutes(m_full, now2))[-1][0],
      datetime(2026, 11, 25).date())

# 4) 마감 뒤 16:10 — 포함
now3 = datetime(2026, 11, 27, 16, 10, tzinfo=ET)
check('16:10 ET — 오늘 봉 포함', lu.confirmed_series(series, now3, lu.session_close_minutes(m_full, now3))[-1][0], d)

# 5) 메타가 없으면 16:00 기본값
check('메타 없음 → 16:00', lu.session_close_minutes({}, now2), 16 * 60)

# 6) 반나절 메타가 '다른 날' 것이면 무시(기본 16:00)
other = meta_for(datetime(2026, 11, 26).date(), (13, 0))
check('다른 날 메타는 무시', lu.session_close_minutes(other, now2), 16 * 60)

print()
print('실패 %d개' % len(FAIL))
sys.exit(1 if FAIL else 0)
