#!/usr/bin/env python3
"""희귀도(rarity) 재계산 — 실제 주봉 점수 기록으로만 센다.

    python3 tools/make_rarity.py            # data/gauge.json 을 고치고 보고
    python3 tools/make_rarity.py --check    # 고치지 않고 현재 값과 비교만

왜 다시 세나
  기존 stat.rarity(0.4년에 1회 · 자주 오는 구간)는 1995년부터의 합성·백필 구간까지
  섞은 값이라 실제 주봉 기록과 어긋났다(무아 님 지적). 여기서는 data/gauge.json 의
  weekly[t](주별 최고 점수 시계열, 2011~)만 쓴다.

세는 법
  · 문턱 = buy(90). 주봉 점수 ≥ 문턱인 주만 센다.
  · 21일 이내로 이어진 주는 한 회차로 묶는다.
  · 기간 = 첫 주 ~ 마지막 주(년). 회차 수로 나눠 '몇 년에 1회'를 낸다.
"""
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GAUGE = os.path.join(ROOT, 'data', 'gauge.json')
GAP_DAYS = 21


def episodes(series, thr):
    out = []
    cur = None
    for row in series:
        d, sc = row[0], row[1]
        if sc is None or sc < thr:
            continue
        dd = date.fromisoformat(d)
        if cur and (dd - cur['_end']).days <= GAP_DAYS:
            cur['_end'] = dd
            cur['end'] = d
            cur['max'] = max(cur['max'], sc)
            cur['weeks'] += 1
        else:
            if cur:
                out.append(cur)
            cur = {'start': d, 'end': d, 'max': sc, 'weeks': 1, '_end': dd}
    if cur:
        out.append(cur)
    return [{k: v for k, v in e.items() if not k.startswith('_')} for e in out]


def label_for(per_year):
    if per_year >= 2:
        return '자주 오는 구간'
    if per_year >= 0.75:
        return '1년에 한 번 수준'
    if per_year >= 0.4:
        return '2~3년에 한 번'
    return '드문 구간'


def rarity_for(series, thr):
    eps = episodes(series, thr)
    if len(series) < 10 or not eps:
        return None
    span = (date.fromisoformat(series[-1][0]) - date.fromisoformat(series[0][0])).days / 365.25
    per_year = len(eps) / span
    return {
        # 1년에 가까우면 1.0 처럼, 1년보다 훨씬 드물면 0.75 처럼 두 자리로
        'text': ('%.1f년에 1회' % (span / len(eps)) if span / len(eps) >= 0.95 else '%.2f년에 1회' % (span / len(eps)))
                + ' · %d년간 %d회' % (round(span), len(eps)),
        'label': label_for(per_year),
        'perYear': round(per_year, 2),
        'yearsPer': round(span / len(eps), 2),
        'episodes': len(eps),
        'weeks': len(series),
        'hits': sum(1 for r in series if r[1] is not None and r[1] >= thr),
        'gapDays': GAP_DAYS,
        'from': series[0][0],
        'to': series[-1][0],
        'recent': eps[-6:],
    }


def main():
    check_only = '--check' in sys.argv
    with open(GAUGE, encoding='utf-8') as f:
        g = json.load(f)
    thr = g.get('buy', 90.0)
    changed = False
    for t in ('ndx', 'sox'):
        series = (g.get('weekly') or {}).get(t) or []
        r = rarity_for(series, thr)
        if not r:
            print('%s: 주봉 기록이 모자라 건너뜁니다' % t)
            continue
        stat = g['targets'][t].setdefault('stat', {})
        old = stat.get('rarity')
        print('%s — 주봉 %d개 %s~%s (%.1f년) · ≥%g %d주 · %d회차 · %s'
              % (t, r['weeks'], r['from'], r['to'], r['weeks'] and (date.fromisoformat(r['to']) - date.fromisoformat(r['from'])).days / 365.25,
                 thr, r['hits'], r['episodes'], r['text']))
        for e in r['recent']:
            print('    %s~%s max %.1f (%d주)' % (e['start'], e['end'], e['max'], e['weeks']))
        if old != r['text']:
            print('    rarity: %r → %r' % (old, r['text']))
            changed = True
        if check_only:
            continue
        stat['rarity'] = r['text']
        stat['rarityLabel'] = r['label']
        stat['rarityPerYear'] = r['perYear']
        stat['rarityYearsPer'] = r['yearsPer']
        stat['rarityEpisodes'] = r['episodes']
        stat['rarityWeeks'] = r['weeks']
        stat['rarityHits'] = r['hits']
        stat['rarityGapDays'] = r['gapDays']
        stat['rarityFrom'] = r['from']
        stat['rarityTo'] = r['to']
        stat['rarityRecent'] = r['recent']
        # 1995년 합성 구간까지 섞여 있던 옛 값도 같은 주봉 기록으로 맞춘다
        stat['episodes'] = r['episodes']
        stat['meanGapYears'] = r['yearsPer']
    if check_only:
        print('(--check: 파일을 고치지 않았습니다)')
        return 0
    if changed:
        with open(GAUGE, 'w', encoding='utf-8') as f:
            json.dump(g, f, ensure_ascii=False, separators=(',', ':'))
        print('data/gauge.json 을 고쳤습니다.')
    else:
        print('이미 같은 값입니다 — 그대로 둡니다.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
