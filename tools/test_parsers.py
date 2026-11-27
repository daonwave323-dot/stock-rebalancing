#!/usr/bin/env python3
"""원본 시험과의 대조 — BrokerFileTest 기대값 + 세금 식.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/test_parsers.py
"""
import base64
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
results = []


def check(name, ok, note=''):
    results.append((name, bool(ok), note))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + note if note else ''))


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main():
    httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d/' % httpd.server_address[1]
    # 원본 앱 시험 자료는 저장소 밖(작업 공간)에 둔다 — 원본 자산을 공개 저장소에 넣지 않는다.
    fx = os.environ.get('FIXTURES', os.path.join(os.path.dirname(ROOT), 'test-fixtures'))

    def b64(name):
        with open(os.path.join(fx, name), 'rb') as f:
            return base64.b64encode(f.read()).decode()

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(base + 'index.html#/tools/import')
        pg.wait_for_timeout(1500)

        # ---- CSV(UTF-8 BOM)
        out = pg.evaluate("""(b64) => {
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
            const d = ToolsTest.decodeText(u8.buffer);
            const rep = ToolsTest.mapTable(ToolsTest.csvRows(d.text), 'CSV', d.enc);
            return {enc:d.enc, ok:rep.ok, rows:rep.rows.map(r=>({t:r.ticker,n:r.displayName,q:r.qty,a:r.avg,m:r.market})), foreign:rep.foreign, domestic:rep.domestic, skipped:rep.skipped};
        }""", b64('mirae_balance_us_bom.csv'))
        check('BOM CSV 3줄', out['ok'] and len(out['rows']) == 3, json.dumps(out, ensure_ascii=False)[:120])
        check('BOM 인코딩 표기', out['enc'] == 'UTF-8(BOM)', out['enc'])
        nvda = next((r for r in out['rows'] if r['t'] == 'NVDA'), None)
        check('NVDA 12주 · 평단 180.5', nvda and nvda['q'] == 12 and abs(nvda['a'] - 180.5) < 1e-9, str(nvda))
        check('따옴표 이름 유지', nvda and nvda['n'] == '엔비디아')
        tq = next((r for r in out['rows'] if r['t'] == 'TQQQ'), None)
        check('TQQQ 이름 안의 쉼표', tq and tq['n'] == 'ProShares UltraPro QQQ' and abs(tq['a'] - 53.03) < 1e-9, str(tq))
        check('합계 줄 건너뜀', out['foreign'] == 3 and out['skipped'] >= 1, str(out['skipped']))

        # ---- CP949
        out2 = pg.evaluate("""(b64) => {
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
            const d = ToolsTest.decodeText(u8.buffer);
            const rep = ToolsTest.mapTable(ToolsTest.csvRows(d.text), 'CSV', d.enc);
            return {enc:d.enc, ok:rep.ok, rows:rep.rows.map(r=>({t:r.ticker,n:r.name,q:r.qty,a:r.avg,m:r.market})), domestic:rep.domestic, skipped:rep.skipped};
        }""", b64('mirae_balance_kr_cp949.csv'))
        check('CP949 2줄', out2['ok'] and len(out2['rows']) == 2, json.dumps(out2, ensure_ascii=False)[:100])
        check('CP949 표기', out2['enc'] == 'CP949(EUC-KR)', out2['enc'])
        s1 = next((r for r in out2['rows'] if r['t'] == '005930'), None)
        check('삼성전자 30주 · 15만', s1 and s1['q'] == 30 and abs(s1['a'] - 150000) < 1e-9 and s1['m'] == 'kr', str(s1))
        check('현금 줄(수량 0) 제외', out2['skipped'] >= 1 and not any(r['n'] == '현금' for r in out2['rows']))

        # ---- XLSX
        out3 = pg.evaluate("""(b64) => {
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
            return ToolsTest.readXlsx(u8.buffer).then(table => {
                const rep = ToolsTest.mapTable(table, '엑셀(xlsx)', '');
                return {ok:rep.ok, fmt:rep.format, hdr:rep.headerRow, skipped:rep.skipped,
                        rows:rep.rows.map(r=>({t:r.ticker,n:r.displayName,q:r.qty,a:r.avg,m:r.market}))};
            });
        }""", b64('mirae_balance_sample.xlsx'))
        check('xlsx 3줄', out3['ok'] and len(out3['rows']) == 3, json.dumps(out3, ensure_ascii=False)[:140])
        check('xlsx 티커 NVDA/GOOGL/AAPL', [r['t'] for r in out3['rows']] == ['NVDA', 'GOOGL', 'AAPL'], str([r['t'] for r in out3['rows']]))
        check('xlsx 머리글 3행', out3['hdr'] == 3, str(out3['hdr']))
        check('xlsx 합계 1줄 건너뜀', out3['skipped'] == 1, str(out3['skipped']))
        check('xlsx 공유문자열 이름', out3['rows'][0]['n'] == 'NVIDIA Corporation', out3['rows'][0]['n'])
        check('xlsx inlineStr 이름', out3['rows'][2]['n'] == 'Apple Inc.' and abs(out3['rows'][2]['a'] - 240.25) < 1e-9, str(out3['rows'][2]))

        # ---- 머리글 없는 파일
        out4 = pg.evaluate("""(b64) => {
            const bin = atob(b64);
            const u8 = new Uint8Array(bin.length);
            for (let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
            const d = ToolsTest.decodeText(u8.buffer);
            return ToolsTest.mapTable(ToolsTest.csvRows(d.text), 'CSV', d.enc);
        }""", b64('not_a_balance.csv'))
        check('머리글 없으면 실패로 돌려줌', out4['ok'] is False and '찾지 못했습니다' in (out4.get('message') or '') and not out4.get('rows'), str(out4.get('message'))[:70])

        # ---- 수량 칸 없음
        out5 = pg.evaluate("""() => {
            const t = ToolsTest.csvRows('종목명,종목코드,매입단가\\n삼성전자,005930,150000\\n');
            return ToolsTest.mapTable(t, 'CSV', 'UTF-8');
        }""")
        check('수량 칸 없으면 채우지 않음', out5['ok'] is False and '보유수량' in out5['message'] and out5['missing'] == ['보유수량'], out5.get('message', ''))

        # ---- 세금 식 (원본 taxOf: max(0, already+gain-250만) - max(0, already-250만)) × 22%
        tax = pg.evaluate("""() => {
            const T = ToolsTest.taxOf;
            return [T(2500000,0), T(3500000,0), T(1000000,5000000), T(-1000000,5000000), T(0,0)];
        }""")
        check('세금: 공제 한도까지 0원', tax[0] == 0, str(tax[0]))
        check('세금: 350만 → 22만원', abs(tax[1] - 220000) < 1e-6, str(tax[1]))
        check('세금: 이미 500만 실현 + 100만 → 22만원', abs(tax[2] - 220000) < 1e-6, str(tax[2]))
        check('세금: 손실이면 세금 감소(-22만)', abs(tax[3] + 220000) < 1e-6, str(tax[3]))

        check('페이지 오류 없음', len(errs) == 0, str(errs[:2]))
        b.close()
    httpd.shutdown()
    fails = [r for r in results if not r[1]]
    print('\n%d/%d 통과' % (len(results) - len(fails), len(results)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
