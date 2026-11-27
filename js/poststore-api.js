/* 서버 저장 구현 자리 — 지금은 비어 있다.
 *
 * 화면(content.js)은 PostStore 인터페이스(list / save / remove)만 쓴다.
 * 서버가 준비되면 아래 BASE 에 주소를 넣고 이 파일의 함수 세 개를 실제 요청으로 채우면,
 * 화면 코드는 그대로 두고 저장 위치만 바뀐다. **주소가 비어 있는 동안에는 아무 요청도 보내지 않는다.**
 */
(function (w) {
  'use strict';

  var BASE = '';   /* 예: 'https://upload.example.workers.dev' — 정해지면 여기만 채운다 */

  w.PostStoreApi = {
    base: BASE,
    available: function () { return !!BASE; },
    list: function () {
      if (!BASE) return [];
      /* 서버가 붙으면: return fetch(BASE + '/posts').then(r => r.json()).then(j => j.items) */
      return [];
    },
    save: function (post) {
      if (!BASE) throw new Error('서버 주소가 아직 없습니다.');
      /* 서버가 붙으면: return fetch(BASE + '/posts', {method:'POST', body: ...}) */
      return post;
    },
    remove: function (id) {
      if (!BASE) return;
      /* 서버가 붙으면: return fetch(BASE + '/posts/' + encodeURIComponent(id), {method:'DELETE'}) */
    }
  };
})(window);
