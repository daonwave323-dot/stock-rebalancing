/* 글 탭 — 세 갈래를 한 화면에: 저장소 문서(리포트 PDF·칼럼 md) · 직접 쓰기 · 파일 올리기.
 *
 * 저장 계층은 PostStore 하나로 분리했다. 지금은 브라우저 저장소(localStorage) 구현만 있고,
 * 서버·호스팅이 정해지면 같은 인터페이스(list/save/remove)의 구현을 갈아 끼우면 화면은 그대로 쓴다.
 * 아직 없는 API 를 fetch 로 부르지 않는다.
 */
(function (w) {
  'use strict';

  var V = w.Views;
  if (!V) return;

  var KEY = 'posts';
  var manifest = null;

  /* ------------------------------------------------------------ 저장 계층(인터페이스) */
  var PostStore = {
    list: function () {
      var arr = S.get(KEY, []);
      return Array.isArray(arr) ? arr : [];
    },
    save: function (post) {
      var arr = PostStore.list();
      var i = -1;
      for (var k = 0; k < arr.length; k++) if (arr[k].id === post.id) i = k;
      if (i >= 0) arr[i] = post; else arr.unshift(post);
      if (arr.length > 40) arr = arr.slice(0, 40);
      var ok = S.set(KEY, arr);
      if (!ok) throw new Error('저장 공간이 부족합니다(브라우저 저장소). PDF는 특히 큽니다 — 파일 크기를 줄이거나 서버 저장이 붙은 뒤에 올려 주세요.');
      return post;
    },
    remove: function (id) {
      S.set(KEY, PostStore.list().filter(function (p) { return p.id !== id; }));
    }
  };
  w.PostStore = PostStore;

  /* 서버 저장이 준비되면(js/poststore-api.js 의 base 가 채워지면) 그쪽을 쓴다. */
  function activeStore() {
    return (w.PostStoreApi && w.PostStoreApi.available()) ? w.PostStoreApi : PostStore;
  }
  function serverMode() { return !!(w.PostStoreApi && w.PostStoreApi.available()); }

  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    return fetch('content/index.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('content/index.json ' + r.status);
      return r.json();
    }).then(function (j) {
      manifest = (j && j.items) ? j : { items: [] };
      return manifest;
    }).catch(function () {
      manifest = { items: [] };
      return manifest;
    });
  }

  function esc2(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* data: URL → blob: URL (PDF·이미지 열람용) */
  function blobFromDataUrl(dataUrl) {
    var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(String(dataUrl || ''));
    if (!m) return dataUrl;
    var mime = m[1] || 'application/octet-stream';
    var bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }

  /* 아주 작은 마크다운 — 제목·목록·인용·굵게·기울임·링크·문단만. 라이브러리를 쓰지 않는다. */
  function mdToHtml(md) {
    var lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    var out = [], inList = false, para = [];
    function inline(s) {
      var t = esc2(s);
      t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
      t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (m, txt, url) {
        var u = String(url).replace(/"/g, '&quot;');
        if (!/^https?:\/\//i.test(u) && !/^(\.\.?\/|content\/)/.test(u)) u = '#';
        return '<a href="' + u + '">' + txt + '</a>';
      });
      return t;
    }
    function flushPara() { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } }
    function closeList() { if (inList) { out.push('</ul>'); inList = false; } }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      if (!line.trim()) { flushPara(); closeList(); return; }
      var h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { flushPara(); closeList(); var lv = h[1].length + 1; out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'); return; }
      if (/^>\s?/.test(line)) { flushPara(); closeList(); out.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>'); return; }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); closeList(); out.push('<hr>'); return; }
      var li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (li) { flushPara(); if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + inline(li[1]) + '</li>'); return; }
      closeList();
      para.push(line.trim());
    });
    flushPara(); closeList();
    return out.join('\n');
  }

  function isPdf(it) { return it.kind === 'reports' || /\.pdf$/i.test(it.path || it.fileName || ''); }
  function isImage(it) { return /\.(png|jpe?g|gif|webp)$/i.test(it.path || it.fileName || '') || (it.mime || '').indexOf('image/') === 0; }

  /* ------------------------------------------------------------ 목록 */
  function allItems(idx) {
    var store = activeStore().list().map(function (p) {
      return {
        id: p.id, kind: p.kind, title: p.title, date: p.date, summary: p.summary,
        body: p.body, dataUrl: p.dataUrl, mime: p.mime, fileName: p.fileName,
        local: true
      };
    });
    var fromManifest = (idx.items || []).map(function (x) {
      return {
        id: x.id || x.path, kind: x.kind || (/\.pdf$/i.test(x.path) ? 'reports' : 'notes'),
        title: x.title, date: x.date, summary: x.summary, path: x.path, local: false
      };
    });
    return store.concat(fromManifest);
  }

  function card(it) {
    var pdf = isPdf(it), img = isImage(it);
    var href = it.local
      ? '#/note/' + encodeURIComponent(it.id)
      : (pdf || img ? esc2(it.path) : '#/note/' + encodeURIComponent(it.id));
    var cls = (pdf || img) && !it.local ? 'doc-card' : 'read-card';
    var tag = it.local ? '이 브라우저' : (pdf ? 'PDF 리포트' : '칼럼');
    return '<a class="' + cls + '" href="' + href + '"' +
      ((pdf || img) && !it.local ? ' target="_blank" rel="noopener"' : '') + '>' +
      '<span class="tag">' + tag + ' · ' + (it.date ? F.day(it.date) : '') + '</span>' +
      '<h3>' + esc2(it.title || '제목 없음') + '</h3>' +
      '<p>' + esc2(it.summary || '') + '</p>' +
      (it.local ? '<span class="doc-dl">이 브라우저에만 저장됨</span>' : ((pdf || img) ? '<span class="doc-dl">새 탭에서 열기 · 내려받기</span>' : '')) +
      '</a>';
  }

  function section(title, note, items, emptyMsg) {
    return '<section class="panel">' +
      '<div class="panel-h"><h2>' + title + '</h2><span class="note">' + note + '</span></div>' +
      (items.length ? '<div class="read-grid">' + items.map(card).join('') + '</div>'
        : '<div class="empty">' + emptyMsg + '</div>') +
      '</section>';
  }

  /* ------------------------------------------------------------ 화면 */
  function render(view, idx) {
    var items = allItems(idx).sort(function (a, b) {
      if (!!b.local !== !!a.local) return b.local ? 1 : -1;         /* 내가 방금 쓴 글을 맨 위에 */
      return String(b.date || '') < String(a.date || '') ? -1 : 1;
    });
    var localCount = activeStore().list().length;
    var reports = items.filter(function (x) { return isPdf(x); });
    var notes = items.filter(function (x) { return !isPdf(x); });
    var arts = Data.readings.articles;

    view.innerHTML =
      '<section class="hero"><div class="crumb"><a href="#/">홈</a> / 글</div>' +
        '<h1>글</h1>' +
        '<p>여기서 직접 쓰거나 파일을 올릴 수 있고, 저장소 <code>content/</code> 에 둔 리포트·칼럼도 함께 보입니다.</p>' +
        '<p class="byline">글 · Verdictjang</p></section>' +

      '<div class="panel">' +
        '<div class="panel-h"><h2>글쓰기</h2><span class="badge ' + (serverMode() ? 'good' : 'amber') + '">' + (serverMode() ? '사이트에 올라갑니다' : '이 브라우저에만 저장됩니다') + '</span></div>' +
        '<p class="note" style="margin-bottom:10px">' + (serverMode()
          ? '서버 저장이 연결되어 글과 파일이 사이트에 올라갑니다.'
          : '지금은 서버 저장이 붙기 전이라 글은 <b>이 브라우저(localStorage)</b>에만 남습니다. 다른 기기·다른 사람에게는 보이지 않고, 브라우저 기록을 지우면 함께 사라집니다. 서버 주소를 넣으면 같은 화면 그대로 사이트에 올라갑니다.') + '</p>' +
        '<div class="row" style="margin-bottom:10px">' +
          '<span class="g-seg" id="postMode">' +
            '<button type="button" data-pmode="write" class="on">직접 쓰기</button>' +
            '<button type="button" data-pmode="upload">파일 올리기</button>' +
          '</span>' +
          '<span class="g-mini" id="postCount">이 브라우저에 쓴 글 ' + localCount + '건</span>' +
        '</div>' +

        '<div id="writePane">' +
          '<div class="form-grid">' +
            '<div class="field span3"><label for="pTitle">제목</label><input id="pTitle" placeholder="글 제목"></div>' +
            '<div class="field span2"><label for="pKind">분류</label><select id="pKind"><option value="notes">칼럼</option><option value="reports">리포트</option></select></div>' +
            '<div class="field"><label for="pDate">날짜</label><input type="date" id="pDate" value="' + F.today() + '"></div>' +
            '<div class="field span6"><label for="pSummary">한 줄 요약 (선택)</label><input id="pSummary" placeholder="목록에 보일 한 줄"></div>' +
            '<div class="field span6"><label for="pBody">본문 — 마크다운(#, -, **굵게**, [링크](주소))</label>' +
              '<textarea id="pBody" rows="10" placeholder="# 제목&#10;&#10;본문을 씁니다."></textarea></div>' +
          '</div>' +
          '<div class="row" style="margin-top:10px">' +
            '<button class="btn primary" type="button" id="pSave">글 저장</button>' +
            '<span class="g-mini" id="pMsg" style="color:var(--amber)"></span>' +
          '</div>' +
        '</div>' +

        '<div id="uploadPane" hidden>' +
          '<div class="form-grid">' +
            '<div class="field span3"><label for="pFiles">파일 (PDF · md · 이미지, 여러 개 가능)</label>' +
              '<input type="file" id="pFiles" multiple accept=".pdf,.md,.markdown,.png,.jpg,.jpeg,.webp"></div>' +
            '<div class="field span2"><label for="pKind2">분류</label><select id="pKind2"><option value="reports">리포트</option><option value="notes">칼럼</option></select></div>' +
            '<div class="field"><label>&nbsp;</label><button class="btn" type="button" id="pUpload">올리기</button></div>' +
          '</div>' +
          '<p class="note">제목은 파일 이름으로 채웁니다. md는 사이트 안에서 읽고, PDF·이미지는 새 탭에서 엽니다. ' +
            '큰 PDF는 브라우저 저장 공간(약 5MB)을 넘기면 저장되지 않습니다 — 그때는 안내가 나옵니다.</p>' +
        '</div>' +
      '</div>' +

      section('리포트', 'PDF · 클릭하면 새 탭에서 열립니다', reports,
        '아직 리포트가 없습니다 — content/reports/ 에 PDF를 올리거나 위에서 파일을 올리면 여기에 나타납니다.') +
      section('칼럼', '짧은 글 · 사이트 안에서 읽습니다', notes,
        '아직 칼럼이 없습니다 — content/notes/ 에 .md 를 올리거나 위에서 직접 쓰면 여기에 나타납니다.') +
      section('지난 글', '사이트에 직접 쓴 글', arts.map(function (a) {
        return { id: 'a:' + a.id, kind: 'article', title: a.title, date: a.date, summary: a.summary, local: false, path: '#/read/' + a.id };
      }), '지난 글이 없습니다.');

    /* 지난 글은 기존 기사 화면(#/read/{id})으로 */
    var last = els('section.panel', view).slice(-1)[0];
    if (last) {
      var grid = last.querySelector('.read-grid');
      if (grid) grid.innerHTML = arts.map(function (a) {
        return '<a class="read-card" href="#/read/' + a.id + '">' +
          '<span class="tag">' + esc2(a.tag) + ' · ' + F.day(a.date) + '</span>' +
          '<h3>' + esc2(a.title) + '</h3><p>' + esc2(a.summary) + '</p></a>';
      }).join('');
    }

    bindEditor(view);
  }

  function bindEditor(view) {
    els('[data-pmode]', view).forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-pmode');
        els('[data-pmode]', view).forEach(function (x) { x.classList.toggle('on', x === b); });
        el('#writePane', view).hidden = mode !== 'write';
        el('#uploadPane', view).hidden = mode !== 'upload';
      });
    });

    var save = el('#pSave', view);
    if (save) save.addEventListener('click', function () {
      var title = (el('#pTitle', view).value || '').trim();
      var body = el('#pBody', view).value || '';
      var msg = el('#pMsg', view);
      if (!title) { msg.textContent = '제목을 넣어 주세요.'; return; }
      if (!body.trim()) { msg.textContent = '본문을 넣어 주세요.'; return; }
      var post = {
        id: uid(), kind: el('#pKind', view).value, title: title,
        date: el('#pDate', view).value || F.today(),
        summary: (el('#pSummary', view).value || '').trim(),
        body: body, at: new Date().toISOString()
      };
      try {
        activeStore().save(post);
      } catch (e) {
        msg.textContent = String(e.message || e);
        return;
      }
      toast('글을 저장했습니다 — 이 브라우저에만 남습니다.');
      V.readings(document.getElementById('view'));
    });

    var up = el('#pUpload', view);
    if (up) up.addEventListener('click', function () {
      var input = el('#pFiles', view);
      var msg = el('#pMsg', view);
      var files = input.files ? Array.prototype.slice.call(input.files) : [];
      if (!files.length) { msg.textContent = '올릴 파일을 골라 주세요.'; return; }
      var kind = el('#pKind2', view).value;
      var pending = files.length, failed = 0;
      files.forEach(function (f) {
        var isMd = /\.(md|markdown|txt)$/i.test(f.name);
        var reader = new FileReader();
        reader.onload = function () {
          var post = {
            id: uid(), kind: kind, title: f.name.replace(/\.[^.]+$/, ''),
            date: F.today(), summary: '', fileName: f.name, mime: f.type || '',
            at: new Date().toISOString()
          };
          if (isMd) post.body = String(reader.result || '');
          else post.dataUrl = String(reader.result || '');
          try { activeStore().save(post); } catch (e) {
            failed++;
            msg.textContent = String(e.message || e);
          }
          if (--pending === 0) {
            if (!failed) toast(files.length === 1 ? '파일을 올렸습니다.' : files.length + '개 파일을 올렸습니다.');
            V.readings(document.getElementById('view'));
          }
        };
        reader.onerror = function () { failed++; if (--pending === 0) V.readings(document.getElementById('view')); };
        if (isMd) reader.readAsText(f); else reader.readAsDataURL(f);
      });
    });
  }

  V.readings = function (view) {
    view.innerHTML = '<div class="loading">글 목록을 불러오는 중…</div>';
    loadManifest().then(function (idx) {
      if (!document.body.contains(view)) return;
      render(view, idx);
    });
  };

  V.note = function (view, id) {
    id = decodeURIComponent(id || '');
    view.innerHTML = '<div class="loading">글을 불러오는 중…</div>';

    function show(post) {
      var head = '<article><section class="hero"><div class="crumb"><a href="#/">홈</a> / <a href="#/readings">글</a> / ' +
        (post.kind === 'reports' ? '리포트' : '칼럼') + '</div>' +
        '<h1>' + esc2(post.title || '') + '</h1>' +
        '<p class="byline">글 · Verdictjang · ' + (post.date ? F.day(post.date) : '') +
        (post.local ? ' · 이 브라우저에만 저장됨' : '') + '</p></section>';
      var body = '';
      if (post.dataUrl) {
        if (isImage(post) || (post.mime || '').indexOf('image/') === 0) {
          body = '<div class="panel"><img src="' + post.dataUrl + '" alt="' + esc2(post.title) + '" style="max-width:100%;height:auto;border-radius:10px"></div>';
        } else {
          /* 브라우저 저장소의 파일은 blob URL 로 연다(긴 data: URL 을 화면에 붙이지 않는다).
             아이폰 사파리는 새 탭 PDF 미리보기를 막는 경우가 있어 내려받기 링크를 함께 둔다. */
          var blobUrl = post.dataUrl, blobNote = '';
          try {
            blobUrl = blobFromDataUrl(post.dataUrl);
          } catch (e) { blobNote = ' (blob 주소를 만들지 못해 원본 주소로 엽니다: ' + (e && e.message || e) + ')'; }
          body = '<div class="panel"><p class="note">PDF 파일입니다. 브라우저 저장소에 넣어 둔 파일이라 새 탭 열기가 막히면 아래 내려받기를 쓰세요.' + blobNote + '</p>' +
            '<div class="row"><a class="btn" href="' + blobUrl + '" target="_blank" rel="noopener">새 탭에서 열기</a>' +
            '<a class="btn ghost" href="' + blobUrl + '" download="' + esc2(post.fileName || 'file.pdf') + '">내려받기</a></div>' +
            '<embed src="' + blobUrl + '" type="application/pdf" style="width:100%;height:70vh;margin-top:10px;border:0;border-radius:10px">' +
            '</div>';
        }
      } else {
        body = '<div class="panel article-body md-body">' + mdToHtml(post.body || '') + '</div>';
      }
      var tools = post.local
        ? '<div class="row"><button class="btn ghost sm" type="button" id="pDel">이 글 지우기</button></div>'
        : '';
      view.innerHTML = head + body + tools +
        '<div class="row"><a class="btn ghost" href="#/readings">← 글 목록</a><a class="btn ghost" href="#/">홈</a></div></article>';
      var del = el('#pDel', view);
      if (del) del.addEventListener('click', function () {
        confirmBox({ title: '이 글을 지울까요?', body: '이 브라우저에 저장된 글입니다. 되돌릴 수 없습니다.', ok: '지운다' }, function () {
          activeStore().remove(post.id);
          location.hash = '#/readings';
          toast('글을 지웠습니다.');
        });
      });
    }

    /* 1) 이 브라우저에 쓴 글 */
    var mine = activeStore().list().filter(function (p) { return p.id === id; })[0];
    if (mine) { show(mine); return; }

    /* 2) 저장소 문서(content/index.json) — md만 본문을 읽어 보여 준다 */
    loadManifest().then(function (idx) {
      var it = (idx.items || []).filter(function (x) { return x.id === id || x.path === id; })[0];
      if (!it) {
        view.innerHTML = '<div class="empty">없는 글입니다. <a href="#/readings">글 목록으로</a></div>';
        return;
      }
      if (isPdf(it) || isImage(it)) { location.replace(it.path); return; }
      return fetch(it.path, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error(it.path + ' ' + r.status);
        return r.text();
      }).then(function (md) {
        show({ title: it.title, date: it.date, summary: it.summary, body: md, kind: it.kind, local: false });
      }).catch(function (e) {
        view.innerHTML = '<div class="empty">글을 읽지 못했습니다.<br><span class="small">' + esc2(String(e && e.message || e)) +
          ' — <a href="' + esc2(it.path) + '">파일 열기</a></span></div>';
      });
    });
  };

  w.MdRender = mdToHtml;
})(window);
