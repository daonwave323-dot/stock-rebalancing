#!/usr/bin/env python3
"""배포 페이지(깃허브 페이지)에서 글 탭 그대로 확인 — 목록 먼저 / ＋ 글쓰기 / 분류.

  LD_LIBRARY_PATH=/workspace/site-stock-rel/.libs python3 tools/live_content_check.py
"""
import os
import sys

SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'screens-content')
URL = 'https://daonwave323-dot.github.io/stock-rebalancing/'
results, console_errors = [], []


def check(name, ok, note=''):
    results.append((name, bool(ok), note))
    print(('PASS  ' if ok else 'FAIL  ') + name + ('   ' + str(note) if note else ''))
    return ok


def main():
    os.makedirs(SHOTS, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        pg = ctx.new_page()
        pg.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: console_errors.append('pageerror: ' + str(e)))
        pg.goto(URL + '#/readings', wait_until='load')
        pg.wait_for_selector('#pToggle', timeout=20000)
        pg.wait_for_timeout(800)

        st = pg.evaluate("""() => ({
          formOn: !document.querySelector('#postPanel').hidden,
          toggle: document.querySelector('#pToggle').textContent,
          expanded: document.querySelector('#pToggle').getAttribute('aria-expanded'),
          hero: document.querySelector('.hero p').textContent,
          cats: [...document.querySelectorAll('#pKind option')].map(o => o.value),
          sections: [...document.querySelectorAll('#view section.panel h2')].map(h => h.textContent),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          btnH: Math.round(document.querySelector('#pToggle').getBoundingClientRect().height),
          viewSrc: (document.querySelector('script[src*="content.js"]') || {}).src || null
        })""")
        print('  배포 스크립트:', st['viewSrc'])
        print('  첫 문단:', st['hero'])
        check('배포: 처음엔 폼 접힘', st['formOn'] is False)
        check('배포: ＋ 글쓰기 버튼', '글쓰기' in st['toggle'] and '접기' not in st['toggle'], st['toggle'])
        check('배포: 목록이 먼저 (리포트·칼럼·지난 글)', st['sections'][:3] == ['리포트', '칼럼', '지난 글'], st['sections'])
        check('배포: 버튼 44px 이상', st['btnH'] >= 44, st['btnH'])
        check('배포: 390px 가로 넘침 0', st['overflow'] <= 0, st['overflow'])
        pg.screenshot(path=os.path.join(SHOTS, 'live-390-closed.png'))

        pg.click('#pToggle')
        pg.wait_for_timeout(400)
        check('배포: 버튼으로 폼 열림', pg.evaluate("() => !document.querySelector('#postPanel').hidden"))
        pg.click('#pCatAddBtn')
        pg.fill('#pCatName', '매크로')
        pg.click('#pCatOk')
        pg.wait_for_timeout(400)
        cats = pg.evaluate("() => [...document.querySelectorAll('#pKind option')].map(o => o.value)")
        check('배포: 분류 추가', cats == ['칼럼', '리포트', '매크로'], cats)
        pg.fill('#pTitle', '배포 확인 글')
        pg.fill('#pBody', '# 확인\n\n배포 페이지에서 쓴 글입니다.')
        pg.click('#pSave')
        pg.wait_for_timeout(1000)
        got = pg.evaluate("""() => {
          const a = [...document.querySelectorAll('#view a.read-card')].find(x => x.textContent.includes('배포 확인 글'));
          return a ? a.querySelector('.tag').textContent : null;
        }""")
        check('배포: 저장한 글 카드에 분류 이름표', got and got.startswith('매크로'), got)
        pg.screenshot(path=os.path.join(SHOTS, 'live-390-saved.png'))

        pg.reload(wait_until='load')
        pg.wait_for_selector('#pToggle', timeout=20000)
        pg.wait_for_timeout(900)
        st2 = pg.evaluate("""() => ({
          formOn: !document.querySelector('#postPanel').hidden,
          cats: [...document.querySelectorAll('#pKind option')].map(o => o.value),
          has: [...document.querySelectorAll('#view a.read-card')].some(x => x.textContent.includes('배포 확인 글'))
        })""")
        check('배포: 새로고침 뒤에도 접힘', st2['formOn'] is False)
        check('배포: 새로고침 뒤 분류 유지', st2['cats'] == ['칼럼', '리포트', '매크로'], st2['cats'])
        check('배포: 새로고침 뒤 글 유지', st2['has'] is True)
        b.close()

    check('배포: 콘솔 오류 없음', not console_errors, console_errors[:3])
    fails = [r for r in results if not r[1]]
    print('\n%d/%d 통과' % (len(results) - len(fails), len(results)))
    for f in fails:
        print('  FAIL', f[0], f[2])
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
