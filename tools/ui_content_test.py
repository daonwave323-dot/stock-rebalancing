#!/usr/bin/env python3
"""글 탭 검증 — 목록 먼저 / '＋ 글쓰기'로 폼 열기 / 분류 직접 추가·이름 바꾸기·지우기.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/ui_content_test.py
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, 'screens-content')

results = []
console_errors = []


def check(name, ok, note=''):
    results.append((name, bool(ok), note))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + str(note) if note else ''))
    return ok


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    handler = functools.partial(Handler, directory=ROOT)
    httpd = socketserver.TCPServer(('127.0.0.1', 0), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def state(pg):
    return pg.evaluate("""() => {
      const q = s => document.querySelector(s);
      const on = s => { const e = q(s); return !!(e && !e.hidden && e.offsetParent !== null); };
      const cats = s => { const e = q(s); return e ? [...e.options].map(o => o.value) : null; };
      return {
        order: [...document.querySelectorAll('#view > *')].map(e => e.id || e.className || e.tagName),
        toggle: (q('#pToggle') || {}).textContent,
        expanded: q('#pToggle') ? q('#pToggle').getAttribute('aria-expanded') : null,
        formOn: on('#postPanel'),
        cats1: cats('#pKind'), cats2: cats('#pKind2'),
        sel1: q('#pKind') ? q('#pKind').value : null,
        sel2: q('#pKind2') ? q('#pKind2').value : null,
        sections: [...document.querySelectorAll('#view section.panel')].map(s => ({
          h: (s.querySelector('h2') || {}).textContent,
          cards: [...s.querySelectorAll('.read-grid > *')].map(c => ({
            tag: (c.querySelector('.tag') || {}).textContent,
            title: (c.querySelector('h3') || {}).textContent,
            href: c.getAttribute('href')
          }))
        })),
        catEditOn: on('#pCatEdit'),
        toast: (q('#toast') || {}).textContent,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        btnH: q('#pToggle') ? Math.round(q('#pToggle').getBoundingClientRect().height) : 0,
        btnW: q('#pToggle') ? Math.round(q('#pToggle').getBoundingClientRect().width) : 0,
        msg: (q('#pMsg') || {}).textContent + ' / ' + (q('#pCatMsg') || {}).textContent
      };
    }""")


def titles(st, section_title):
    for s in st['sections']:
        if s['h'] == section_title:
            return [c['title'] for c in s['cards']]
    return None


def tags(st, section_title):
    for s in st['sections']:
        if s['h'] == section_title:
            return [c['tag'] for c in s['cards']]
    return None


def main():
    os.makedirs(SHOTS, exist_ok=True)
    httpd = serve()
    base = 'http://127.0.0.1:%d/' % httpd.server_address[1]
    from playwright.sync_api import sync_playwright
    ok_all = True

    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844},
                            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
        pg = ctx.new_page()
        pg.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console_errors.append('pageerror: ' + str(e)))

        def open_tab(tag=''):
            pg.goto(base + 'index.html' + tag + '#/readings')
            pg.wait_for_selector('#pToggle', timeout=10000)
            pg.wait_for_timeout(700)

        # ----------------------------------------------------- 1) 처음엔 접힘
        open_tab('?t1')
        st = state(pg)
        print('  order:', st['order'])
        check('처음 화면: 글쓰기 폼 접힘', st['formOn'] is False)
        check('처음 화면: 버튼 문구 ＋ 글쓰기', '글쓰기' in (st['toggle'] or '') and '접기' not in (st['toggle'] or ''), st['toggle'])
        check('처음 화면: aria-expanded=false', st['expanded'] == 'false', st['expanded'])
        check('버튼이 목록 위에 있다', st['order'].index('post-tools') < st['order'].index('panel') if 'post-tools' in st['order'] else False, st['order'])
        check('목록(리포트·칼럼·지난 글)이 먼저 보인다', titles(st, '리포트') is not None and titles(st, '칼럼') is not None, [s['h'] for s in st['sections']])
        check('버튼 높이 44px 이상 (390px)', st['btnH'] >= 44, (st['btnW'], st['btnH']))
        check('390px 가로 넘침 0', st['overflow'] <= 0, st['overflow'])
        pg.screenshot(path=os.path.join(SHOTS, 'content-390-closed.png'), full_page=False)

        # ----------------------------------------------------- 2) 버튼으로 열기/닫기
        pg.click('#pToggle')
        pg.wait_for_timeout(300)
        st = state(pg)
        check('버튼 누르면 폼 열림', st['formOn'] is True)
        check('열리면 문구·aria 바뀜', '접기' in (st['toggle'] or '') and st['expanded'] == 'true', (st['toggle'], st['expanded']))
        check('직접 쓰기 / 파일 올리기 세그먼트 보임', pg.is_visible('[data-pmode="write"]') and pg.is_visible('[data-pmode="upload"]'))
        pg.click('#pToggle')
        pg.wait_for_timeout(300)
        check('다시 누르면 접힘', state(pg)['formOn'] is False)
        pg.click('#pToggle')
        pg.wait_for_timeout(300)

        # ----------------------------------------------------- 3) 분류 목록
        st = state(pg)
        check('기본 분류 둘 (칼럼·리포트) + 쓰기 기본 칼럼', st['cats1'] == ['칼럼', '리포트'] and st['sel1'] == '칼럼', (st['cats1'], st['sel1']))
        check('파일 올리기 분류도 같은 목록, 기본 리포트', st['cats2'] == ['칼럼', '리포트'] and st['sel2'] == '리포트', (st['cats2'], st['sel2']))

        # 새 분류 추가
        pg.click('#pCatAddBtn')
        pg.wait_for_timeout(200)
        check('분류 추가 입력칸 열림', state(pg)['catEditOn'] is True)
        pg.fill('#pCatName', '매크로')
        pg.click('#pCatOk')
        pg.wait_for_timeout(300)
        st = state(pg)
        check('분류 추가 → 두 선택칸에 반영', st['cats1'] == ['칼럼', '리포트', '매크로'] and st['cats2'] == ['칼럼', '리포트', '매크로'], (st['cats1'], st['cats2']))
        check('추가한 분류가 쓰기 칸에 선택됨', st['sel1'] == '매크로', st['sel1'])
        check('추가 후 입력칸 닫힘', st['catEditOn'] is False)
        pg.screenshot(path=os.path.join(SHOTS, 'content-390-cat-added.png'))

        # 중복·기본 이름 거부
        pg.click('#pCatAddBtn')
        pg.fill('#pCatName', '매크로')
        pg.click('#pCatOk')
        pg.wait_for_timeout(200)
        check('같은 이름은 거부', '이미 있는 분류' in state(pg)['msg'], state(pg)['msg'])
        pg.fill('#pCatName', '리포트')
        pg.click('#pCatOk')
        pg.wait_for_timeout(200)
        check('칼럼·리포트 이름은 거부', '쓸 수 없습니다' in state(pg)['msg'], state(pg)['msg'])
        pg.click('#pCatCancel')
        pg.wait_for_timeout(200)

        # ----------------------------------------------------- 4) 매크로 분류로 글 저장
        pg.fill('#pTitle', '매크로 점검 노트')
        pg.fill('#pSummary', '금리와 환율을 함께 본다')
        pg.fill('#pBody', '# 매크로\n\n금리와 환율을 함께 봅니다.')
        pg.click('#pSave')
        pg.wait_for_timeout(900)
        st = state(pg)
        col_titles = titles(st, '칼럼') or []
        col_tags = tags(st, '칼럼') or []
        check('저장한 글이 칼럼 묶음에 나온다', '매크로 점검 노트' in col_titles, col_titles)
        check('카드에 분류 이름표가 붙는다', any(t.startswith('매크로') for t in col_tags), col_tags)
        check('저장 뒤에도 폼은 접힘 (목록 먼저)', st['formOn'] is False)
        pg.screenshot(path=os.path.join(SHOTS, 'content-390-saved.png'))

        # ----------------------------------------------------- 5) 새로고침 유지
        open_tab('?t2')
        st = state(pg)
        check('새 분류가 새로고침 뒤에도 남는다', st['cats1'] == ['칼럼', '리포트', '매크로'], st['cats1'])
        check('글이 새로고침 뒤에도 남는다', '매크로 점검 노트' in (titles(st, '칼럼') or []), titles(st, '칼럼'))
        check('새로고침 뒤에도 폼은 접힘', st['formOn'] is False)

        # ----------------------------------------------------- 6) 리포트·칼럼 기존 글
        pg.click('#pToggle')
        pg.wait_for_timeout(300)
        pg.fill('#pTitle', '리포트 분류 글')
        pg.fill('#pBody', '리포트로 쓴 글')
        pg.select_option('#pKind', '리포트')
        pg.click('#pSave')
        pg.wait_for_timeout(900)
        st = state(pg)
        check('리포트로 고른 글은 리포트 묶음에', '리포트 분류 글' in (titles(st, '리포트') or []), titles(st, '리포트'))
        check('칼럼·리포트 글은 서로 안 섞인다', '리포트 분류 글' not in (titles(st, '칼럼') or []))

        pg.click('#pToggle')
        pg.wait_for_timeout(300)
        pg.fill('#pTitle', '칼럼 분류 글')
        pg.fill('#pBody', '칼럼으로 쓴 글')
        pg.select_option('#pKind', '칼럼')
        pg.click('#pSave')
        pg.wait_for_timeout(900)
        st = state(pg)
        check('칼럼으로 고른 글은 칼럼 묶음에', '칼럼 분류 글' in (titles(st, '칼럼') or []), titles(st, '칼럼'))

        # 분류 없이 저장된 예전 글(localStorage 직접 주입)
        pg.evaluate("""() => {
          const arr = JSON.parse(localStorage.getItem('stockrebal.posts') || '[]');
          arr.push({id:'old1', kind:'notes', title:'예전 글(분류 없음)', date:'2026-11-01', body:'옛 글', at:'2026-11-01T00:00:00Z'});
          localStorage.setItem('stockrebal.posts', JSON.stringify(arr));
        }""")
        open_tab('?t3')
        st = state(pg)
        check('분류 없는 예전 글은 칼럼으로 보인다', '예전 글(분류 없음)' in (titles(st, '칼럼') or []), titles(st, '칼럼'))
        check('예전 글 카드 이름표 = 칼럼', any(t.startswith('칼럼') for t, ti in zip(tags(st, '칼럼') or [], titles(st, '칼럼') or []) if ti == '예전 글(분류 없음)'), tags(st, '칼럼'))

        # ----------------------------------------------------- 7) 글 있는 분류: 이름 바꾸기 / 지우기
        pg.click('#pToggle')
        pg.wait_for_timeout(300)
        pg.select_option('#pKind', '매크로')
        pg.click('#pCatDelBtn')
        pg.wait_for_timeout(400)
        st = state(pg)
        check('글이 있는 분류는 지우지 않고 안내', '지우지 않았습니다' in (st['toast'] or ''), st['toast'])
        check('지운 뒤에도 분류가 남아 있다', '매크로' in (st['cats1'] or []), st['cats1'])

        pg.select_option('#pKind', '매크로')
        pg.click('#pCatRenBtn')
        pg.wait_for_timeout(200)
        pg.fill('#pCatName', '거시')
        pg.click('#pCatOk')
        pg.wait_for_timeout(700)
        st = state(pg)
        check('이름 바꾸기 반영', st['cats1'] == ['칼럼', '리포트', '거시'], st['cats1'])
        open_tab('?t4')
        st = state(pg)
        check('이름을 바꾸면 그 글이 새 분류로 보인다', '매크로 점검 노트' in (titles(st, '칼럼') or []) and any(t.startswith('거시') for t in (tags(st, '칼럼') or [])), tags(st, '칼럼'))
        check('바뀐 분류가 새로고침 뒤 유지', '거시' in (st['cats1'] or []), st['cats1'])

        # 글이 없는 분류는 지울 수 있다
        pg.click('#pToggle')
        pg.wait_for_timeout(300)
        pg.click('#pCatAddBtn')
        pg.fill('#pCatName', '실적')
        pg.click('#pCatOk')
        pg.wait_for_timeout(300)
        pg.click('#pCatDelBtn')
        pg.wait_for_timeout(300)
        pg.click('#modal-ok')
        pg.wait_for_timeout(500)
        st = state(pg)
        check('빈 분류 지우기', '실적' not in (st['cats1'] or []), st['cats1'])
        check('기본 분류는 지울 수 없다', pg.evaluate("""() => {
          const s = document.querySelector('#pKind'); s.value = '칼럼';
          document.querySelector('#pCatDelBtn').click();
          return document.querySelector('#toast').textContent;
        }""").find('지울 수 없습니다') >= 0)

        # ----------------------------------------------------- 8) 상세 화면 분류
        pg.click('#pToggle')
        pg.wait_for_timeout(300)
        href = pg.evaluate("""() => {
          const a = [...document.querySelectorAll('#view a.read-card')].find(x => x.textContent.includes('매크로 점검 노트'));
          return a ? a.getAttribute('href') : null;
        }""")
        if href:
            pg.goto(base + 'index.html?t5' + href)
            pg.wait_for_selector('article', timeout=8000)
            pg.wait_for_timeout(400)
            crumb = pg.evaluate("() => (document.querySelector('.crumb')||{}).textContent")
            check('상세 화면 갈래에 분류가 보인다', '거시' in (crumb or ''), crumb)
            pg.screenshot(path=os.path.join(SHOTS, 'content-390-note.png'))
        else:
            check('상세 화면 갈래에 분류가 보인다', False, '카드 링크 못 찾음')

        # ----------------------------------------------------- 9) 파일 올리기 분류
        open_tab('?t6')
        pg.click('#pToggle')
        pg.wait_for_timeout(300)
        pg.click('[data-pmode="upload"]')
        pg.wait_for_timeout(200)
        pg.select_option('#pKind2', '거시')
        md = os.path.join(ROOT, 'screens-content', 'up-sample.md')
        with open(md, 'w', encoding='utf-8') as f:
            f.write('# 올린 md\n\n파일로 올린 글입니다.\n')
        pg.set_input_files('#pFiles', md)
        pg.click('#pUpload')
        pg.wait_for_timeout(900)
        st = state(pg)
        check('파일 올리기에도 같은 분류가 쓰인다', st['cats2'] == st['cats1'], (st['cats1'], st['cats2']))
        check('올린 md 가 고른 분류 이름표로 목록에', any(t.startswith('거시') for t, ti in zip(tags(st, '칼럼') or [], titles(st, '칼럼') or []) if ti == 'up-sample'), (titles(st, '칼럼'), tags(st, '칼럼')))

        # ----------------------------------------------------- 10) 390px 최종 확인
        pg.click('#pToggle')
        pg.wait_for_timeout(300)
        st = state(pg)
        check('열린 상태에서도 390px 가로 넘침 0', st['overflow'] <= 0, st['overflow'])
        pg.screenshot(path=os.path.join(SHOTS, 'content-390-open.png'), full_page=True)
        pg.click('#pCatAddBtn')
        pg.wait_for_timeout(300)
        check('분류 입력칸 열어도 넘침 0', state(pg)['overflow'] <= 0, state(pg)['overflow'])
        pg.screenshot(path=os.path.join(SHOTS, 'content-390-catedit.png'))

        # ----------------------------------------------------- 11) 데스크톱 화면
        ctx2 = b.new_context(viewport={'width': 1200, 'height': 900})
        pg2 = ctx2.new_page()
        pg2.on('pageerror', lambda e: console_errors.append('pageerror: ' + str(e)))
        pg2.goto(base + 'index.html?d1#/readings')
        pg2.wait_for_selector('#pToggle', timeout=10000)
        pg2.wait_for_timeout(700)
        pg2.screenshot(path=os.path.join(SHOTS, 'content-1200-closed.png'), full_page=False)
        pg2.click('#pToggle')
        pg2.wait_for_timeout(300)
        pg2.screenshot(path=os.path.join(SHOTS, 'content-1200-open.png'), full_page=False)

        b.close()

    check('콘솔 오류 없음', not console_errors, console_errors[:3])
    fails = [r for r in results if not r[1]]
    print('\n%d/%d 통과' % (len(results) - len(fails), len(results)))
    for f in fails:
        print('  FAIL', f[0], f[2])
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
