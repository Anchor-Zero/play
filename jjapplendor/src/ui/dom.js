// @ts-check
/*
 * 짭플렌더 화면 — DOM 을 만드는 작은 도우미 (Zap.ui.dom)
 * h('div.card.is-on', { test: 'card-c01', onclick: fn }, 자식...) 꼴로 쓴다.
 */
(function () {
  Zap.ui = Zap.ui || {};

  /** @param {HTMLElement} el @param {any} kid */
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false || kid === true) return;
    if (Array.isArray(kid)) { for (const k of kid) append(el, k); return; }
    if (kid instanceof Node) { el.appendChild(kid); return; }
    el.appendChild(document.createTextNode(String(kid)));
  }

  /**
   * @param {string} spec  'tag.class1.class2' (tag 생략 시 div)
   * @param {Record<string, any>|null} [attrs]  class, test(=data-test), on<event>, disabled 등
   * @param {...any} kids
   * @returns {HTMLElement}
   */
  function h(spec, attrs, ...kids) {
    const parts = spec.split('.');
    const el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    if (attrs) {
      for (const key of Object.keys(attrs)) {
        const v = attrs[key];
        if (v === null || v === undefined || v === false) continue;
        if (key === 'class') { if (v) el.className = (el.className ? el.className + ' ' : '') + v; }
        else if (key === 'test') el.setAttribute('data-test', String(v));
        else if (key.slice(0, 2) === 'on' && typeof v === 'function') {
          // 처리기는 속성(el.onclick)으로 단다: patch() 가 남겨 둔 옛 요소에 새 처리기를 옮겨 달 수 있게
          const anyEl = /** @type {any} */ (el);
          anyEl[key] = v;
          (anyEl._on || (anyEl._on = [])).push(key);
        }
        else if (v === true) el.setAttribute(key, '');
        else el.setAttribute(key, String(v));
      }
    }
    for (const k of kids) append(el, k);
    return el;
  }

  /** 조건에 맞는 class 이름만 이어 붙인다. @param {Record<string, any>} map @returns {string} */
  function cls(map) {
    return Object.keys(map).filter((k) => map[k]).join(' ');
  }

  /* ───────────── 고쳐 그리기 ─────────────
   * 화면은 매번 통째로 새로 만들지만(h 로 만든 새 나무), 문서에는 달라진 곳만 옮겨 적는다.
   * 요소를 갈아 끼우지 않으므로 입력 중인 칸의 초점·한글 조합, 펼쳐 둔 선택 상자, 안쪽 스크롤 위치가 그대로 남는다. */

  /** @param {Element} a @param {Element} b */
  function syncElement(a, b) {
    for (const name of a.getAttributeNames()) if (!b.hasAttribute(name)) a.removeAttribute(name);
    for (const name of b.getAttributeNames()) {
      const v = b.getAttribute(name);
      if (a.getAttribute(name) !== v) a.setAttribute(name, v === null ? '' : v);
    }
    const A = /** @type {any} */ (a);
    const B = /** @type {any} */ (b);
    const oldKeys = A._on || [];
    const newKeys = B._on || [];
    for (const k of oldKeys) if (newKeys.indexOf(k) < 0) A[k] = null;
    for (const k of newKeys) A[k] = B[k];
    A._on = newKeys;
    if (a instanceof HTMLInputElement) {
      if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
      else if (document.activeElement !== a) {
        const v = b.getAttribute('value') || '';
        if (a.value !== v) a.value = v;
      }
    } else if (a instanceof HTMLOptionElement) {
      const sel = b.hasAttribute('selected');
      if (a.selected !== sel) a.selected = sel;
    }
  }

  /** @param {Node} n @returns {string|null} */
  function keyOf(n) {
    return n.nodeType === 1 ? /** @type {Element} */ (n).getAttribute('data-key') : null;
  }

  /**
   * 옛 노드 a 를 새 노드 b 와 같아지게 고친다. 종류가 달라 고칠 수 없으면 b 를 돌려준다(자리는 부르는 쪽이 정한다).
   * data-own 이 붙은 요소는 속성만 맞추고 안쪽은 건드리지 않는다(판처럼 다른 코드가 그리는 자리).
   * @param {Node} a 문서에 있는 옛 노드 @param {Node} b 새로 만든 노드 @returns {Node} 문서에 남길 노드
   */
  function morph(a, b) {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return b;
    if (a.nodeType === 3) {
      if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
      return a;
    }
    if (a.nodeType !== 1) return b;
    syncElement(/** @type {Element} */ (a), /** @type {Element} */ (b));
    if (!(/** @type {Element} */ (b)).hasAttribute('data-own')) morphChildren(a, Array.from(b.childNodes));
    return a;
  }

  /**
   * 자식들을 kids 와 같게 고친다. data-key 가 같은 요소는 자리가 바뀌어도 같은 요소를 옮겨 쓰고, 나머지는 순서대로 짝짓는다.
   * @param {Node} parent @param {Node[]} kids
   */
  function morphChildren(parent, kids) {
    const old = Array.from(parent.childNodes);
    /** @type {Map<string, Node>} */
    const keyed = new Map();
    /** @type {Node[]} */
    const free = [];
    for (const o of old) { const k = keyOf(o); if (k) keyed.set(k, o); else free.push(o); }
    /** @type {Node[]} */
    const result = [];
    let fi = 0;
    for (const kid of kids) {
      const k = keyOf(kid);
      let node = kid;
      if (k && keyed.has(k)) {
        const o = /** @type {Node} */ (keyed.get(k));
        keyed.delete(k);
        node = morph(o, kid);
      } else if (!k && fi < free.length) {
        node = morph(free[fi++], kid);
      }
      result.push(node);
    }
    const keep = new Set(result);
    for (const o of old) if (!keep.has(o) && o.parentNode === parent) parent.removeChild(o);
    for (let i = 0; i < result.length; i++) {
      if (parent.childNodes[i] !== result[i]) parent.insertBefore(result[i], parent.childNodes[i] || null);
    }
  }

  /**
   * root 의 내용을 kids 와 같아지게 고친다.
   * @param {HTMLElement} root
   * @param {any[]} kids  요소·문자열·null 이 섞인 목록
   */
  function patch(root, kids) {
    const holder = document.createElement('div');
    for (const k of kids) append(holder, k);
    morphChildren(root, Array.from(holder.childNodes));
  }

  Zap.ui.dom = { h, cls, patch };
})();
