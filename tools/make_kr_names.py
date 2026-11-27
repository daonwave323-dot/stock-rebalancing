#!/usr/bin/env python3
"""국내 종목 코드 → 한국어 이름 표(data/names-kr.json)를 만든다.

  python3 tools/make_kr_names.py            # data/market.json 에 있는 국내 코드만
  python3 tools/make_kr_names.py --all      # 네이버 목록 전체

이름의 출처는 네이버 금융 시가총액 목록이다(공개 시세 화면이 쓰는 값).
  https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=1&pageSize=100
  https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=1&pageSize=100
값을 지어내지 않는다 — 목록에 없는 코드는 표에 넣지 않고 그대로 보고한다.
"""
import argparse
import datetime
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'names-kr.json')
API = 'https://m.stock.naver.com/api/stocks/marketValue/%s?page=%d&pageSize=100'


def get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def naver_names():
    out = {}
    for board in ('KOSPI', 'KOSDAQ'):
        page = 1
        while page <= 40:
            d = get_json(API % (board, page))
            stocks = d.get('stocks') or []
            if not stocks:
                break
            for s in stocks:
                code = str(s.get('itemCode') or '').strip()
                name = str(s.get('stockName') or '').strip()
                if code and name and code not in out:
                    out[code] = {'name': name, 'board': board}
            page += 1
            time.sleep(0.1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--all', action='store_true', help='시장 자료에 없는 코드까지 모두 넣는다')
    a = ap.parse_args()

    names = naver_names()
    print('네이버 목록 %d종목' % len(names), file=sys.stderr)

    if not a.all:
        snap = json.load(open(os.path.join(ROOT, 'data', 'market.json'), encoding='utf-8'))
        codes = [k for k, v in (snap.get('symbols') or {}).items()
                 if v.get('market') == 'kr' and k not in ('KOSPI', 'KOSDAQ')]
        kept, missing = {}, []
        for c in codes:
            if c in names:
                kept[c] = names[c]
            else:
                missing.append(c)
        names = kept
        if missing:
            print('네이버 목록에 없어 표에 못 넣은 코드: %s' % ' '.join(missing), file=sys.stderr)

    doc = {
        'asOf': datetime.datetime.now().astimezone().strftime('%Y-%m-%d'),
        'source': 'naver finance 시가총액 목록(m.stock.naver.com marketValue, KOSPI·KOSDAQ) — 종목코드→한국어 이름',
        'count': len(names),
        'names': dict(sorted(names.items())),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print('%s — %d종목' % (os.path.relpath(OUT, ROOT), len(names)), file=sys.stderr)


if __name__ == '__main__':
    main()
