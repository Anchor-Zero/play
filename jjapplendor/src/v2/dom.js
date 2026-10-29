// @ts-check
// 생성됨: tools/sync-v2.js 가 design/ 에서 복사한 파일 — 직접 고치지 말 것(원본을 고친 뒤 다시 복사).
/*
 * 짭플렌더 v2 — DOM 을 만드는 작은 도우미 (Zap.v2.dom)
 * h('div.a.b', { test:'x', onclick: fn, style: {'--card-w':'120px'} }, 자식...) 꼴.
 */
/**
 * 셸이 스킨을 부를 때 쓰는 형식. 내용은 design/skin-api.js 의 SkinAPI 와 같고(그쪽이 기준),
 * 다만 medal 은 비어 있을 수 있게 둔다: 메달이 없는 스킨이면 판이 임시 메달로 대신한다.
 * @typedef {Object} V2Skin
 * @property {string} id
 * @property {string} label
 * @property {string} cssClass
 * @property {string} fontCss
 * @property {(card:CardDef) => HTMLElement} card
 * @property {(tier:Tier, count:number) => HTMLElement} deck
 * @property {(tier:Tier) => HTMLElement} cardBack
 * @property {() => HTMLElement} emptySlot
 * @property {(noble:NobleDef) => HTMLElement} noble
 * @property {(color:TokenColor, px:number) => Element} gem
 * @property {(color:Color, n:number, px:number) => HTMLElement} costChip
 * @property {(color:TokenColor, count:number, px:number) => HTMLElement} chipStack
 * @property {(color:Color, n:number, px:number) => HTMLElement} bonusTile
 * @property {(n:number, px:number) => HTMLElement} pointsBadge
 * @property {(o:{name:string, score:number, cards:number, shared:boolean, px:number}) => HTMLElement} [medal]
 */

(function () {
  Zap.v2 = Zap.v2 || {};

  /** @param {Element} el @param {any} kid */
  function append(el, kid) {
    if (kid === null || kid === undefined || kid === false || kid === true) return;
    if (Array.isArray(kid)) { for (const k of kid) append(el, k); return; }
    if (kid instanceof Node) { el.appendChild(kid); return; }
    el.appendChild(document.createTextNode(String(kid)));
  }

  /**
   * @param {string} spec  'tag.class1.class2' (tag 생략 시 div)
   * @param {Record<string, any>|null} [attrs]  class, test(=data-test), style(객체), on<event>, disabled 등
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
        else if (key === 'style' && typeof v === 'object') {
          for (const p of Object.keys(v)) { if (v[p] !== null && v[p] !== undefined) el.style.setProperty(p, String(v[p])); }
        }
        else if (key.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(key.slice(2), v);
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

  Zap.v2.dom = { h, cls, append };
})();
