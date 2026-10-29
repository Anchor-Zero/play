// @ts-check
// 생성됨: tools/sync-v2.js 가 design/ 에서 복사한 파일 — 직접 고치지 말 것(원본을 고친 뒤 다시 복사).
/*
 * 짭플렌더 v2 시안 — 방향 B 상감풍 스킨 (Zap.skins.intarsia)
 *
 * 르네상스 나무 상감(인타르시아)처럼, 색과 결이 다른 나무 조각을 이어 붙인 그림으로 판 위 물건을 그린다.
 * 약속은 design/skin-api.js 의 SkinAPI. 모양(크기·그림자·움직임)은 같은 폴더 skin.css 의 `.skin-intarsia` 아래에 있다.
 * 글꼴(@font-face, data URI)은 같은 폴더 fonts.js 가 Zap.skins.intarsia.fontCss 에 넣는다(앞뒤 어느 쪽에 불러도 됨).
 *
 * 구조(위에서 아래로):
 *   1. 작은 도우미 (DOM·난수·색)
 *   2. 공용 질감과 <defs> — 나무 결은 canvas 로 한 번 그려 SVG <pattern> 과 CSS 변수로 함께 쓴다
 *   3. 보석 6종 (공용 <g> 를 <use> 로 찍는다)
 *   4. 칩·보너스·점수
 *   5. 상감 삽화 엔진과 단계별 장면
 *   6. 카드·덱·뒷면·빈칸
 *   7. 귀족(곤팔로네 + 말머리형 방패)
 *
 * 여기 함수들은 값만 받아 요소를 돌려준다. 누르기·움직임은 부르는 쪽(셸)이 붙인다.
 * 채도 높은 색은 보석 색에만 쓴다: 삽화에서 색을 맡은 물건만 그 카드의 보석 색, 나머지는 나무 갈색의 농담.
 */
(function () {
  const G = /** @type {any} */ (globalThis);
  G.Zap = G.Zap || {};
  G.Zap.skins = G.Zap.skins || {};

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** @type {Color[]} */
  const COLORS = ['w', 'u', 'g', 'r', 'k'];
  /** @type {TokenColor[]} */
  const TOKENS = ['w', 'u', 'g', 'r', 'k', 'gold'];

  /* ═════════════ 1. 도우미 ═════════════ */

  /** @param {string} tag @param {string} [cls] @param {...(Node|string|null)} kids @returns {HTMLElement} */
  function h(tag, cls, ...kids) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    for (const k of kids) {
      if (k === null || k === undefined) continue;
      el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    }
    return el;
  }

  /** @param {string} viewBox @param {string} cls @param {string} inner @returns {SVGSVGElement} */
  function svg(viewBox, cls, inner) {
    const el = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'));
    el.setAttribute('viewBox', viewBox);
    el.setAttribute('class', cls);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = inner;
    return el;
  }

  /** 소수 한 자리로 줄인 숫자 글자 @param {number} n */
  function f(n) { return String(Math.round(n * 10) / 10); }
  /** @param {number[][]} pts */
  function pstr(pts) { return pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' '); }
  /** 닫힌 다각형 path @param {number[][]} pts */
  function poly(pts) { return 'M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z'; }

  /** @param {string} s */
  function hash(s) {
    let x = 2166136261;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
    return x >>> 0;
  }
  /** 같은 seed 면 같은 수열 @param {number} seed @returns {() => number} */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** @param {string} hex @returns {number[]} */
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  /** @param {number[]} c */
  function hex(c) {
    return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  /** @param {string} a @param {string} b @param {number} t */
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  /** 색 띠에서 0~1 자리의 색 @param {(number|string)[][]} stops @param {number} t */
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i];
      if (t <= /** @type {number} */ (b[0])) {
        const span = /** @type {number} */ (b[0]) - /** @type {number} */ (a[0]);
        return mix(/** @type {string} */ (a[1]), /** @type {string} */ (b[1]), span ? (t - /** @type {number} */ (a[0])) / span : 0);
      }
    }
    return /** @type {string} */ (stops[stops.length - 1][1]);
  }

  /* 나무 색 띠: 흑단 → 늪참나무 → 호두 → 배나무 → 참나무 → 회양목 → 단풍 → 호랑가시. 붉게 읽히지 않게 색상 34~43°의 회갈색·호박색. */
  const WOOD = [
    [0, '#15120e'], [0.12, '#2b241a'], [0.28, '#4c3f2c'], [0.42, '#6b5a3f'], [0.56, '#8c7854'],
    [0.68, '#a99165'], [0.8, '#c4ad7a'], [0.9, '#d9c79a'], [1, '#ebdfbf'],
  ];
  /* 돌 색 띠: 올리브 기운이 도는 회색 */
  const STONE = [[0, '#121210'], [0.25, '#383731'], [0.5, '#69675d'], [0.75, '#a09d8f'], [1, '#dbd8ca']];

  /** 삽화에서 색을 맡은 물건의 농담 [가장 어두움, 어두움, 기본, 밝음, 반짝임] @type {Record<Color, string[]>} */
  const DYE = {
    w: ['#8d98a9', '#c9d1db', '#e9edf2', '#f8f9fb', '#ffffff'],
    u: ['#0c1f66', '#153c9e', '#2259d8', '#5b8ff2', '#a9c8ff'],
    g: ['#06402a', '#0c6a41', '#14995c', '#4fcf93', '#b4f5d2'],
    r: ['#5e0a16', '#95121f', '#cf1f33', '#ee5a62', '#ffb3b0'],
    k: ['#020203', '#0c0c0f', '#1b1c21', '#3a3c45', '#7b7e8a'],
  };

  /* ═════════════ 2. 공용 질감과 <defs> ═════════════ */

  /**
   * 이어 붙여도 끊기지 않는 나무 결 그림(어두운 줄·밝은 줄·물관 점)을 canvas 로 한 번 그려 data URI 로 돌려준다.
   * 결은 가로로 흐른다. 색 없이 반투명한 어두움·밝음만 담아 어떤 바탕색 위에나 겹칠 수 있다.
   * @param {number} size @param {number} seed @param {number} rings @param {number} strength
   */
  function makeGrain(size, seed, rings, strength) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const rnd = rng(seed);
    /** @param {number} nx @param {number} ny */
    function lattice(nx, ny) {
      const a = new Float32Array(nx * ny);
      for (let i = 0; i < a.length; i++) a[i] = rnd();
      return { a, nx, ny };
    }
    /** @param {{a:Float32Array,nx:number,ny:number}} L @param {number} u @param {number} v */
    function sample(L, u, v) {
      const x = u * L.nx, y = v * L.ny;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const xa = x0 % L.nx, xb = (x0 + 1) % L.nx, ya = y0 % L.ny, yb = (y0 + 1) % L.ny;
      const p = L.a[ya * L.nx + xa], q = L.a[ya * L.nx + xb], r = L.a[yb * L.nx + xa], s = L.a[yb * L.nx + xb];
      return p + (q - p) * sx + (r - p) * sy + (p - q - r + s) * sx * sy;
    }
    const fine = lattice(5, 110), mid = lattice(3, 30), warp = lattice(3, 4), pore = lattice(36, 128);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        const w = sample(warp, u, v);
        const ring = Math.sin((v * rings + w * 1.7) * Math.PI * 2);
        const fib = sample(fine, u, v) * 2 - 1;
        const md = sample(mid, u, v) * 2 - 1;
        let s = ring * 0.42 + fib * 0.55 + md * 0.4;
        const p = sample(pore, u, v);
        if (p > 0.8) s -= (p - 0.8) * 5;
        s *= strength;
        const i = (y * size + x) * 4;
        if (s < 0) { d[i] = 34; d[i + 1] = 22; d[i + 2] = 10; d[i + 3] = Math.min(1, -s) * 150; }
        else { d[i] = 255; d[i + 1] = 245; d[i + 2] = 218; d[i + 3] = Math.min(1, s) * 62; }
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  /** 벨벳 탁자에 얹는 고운 보풀 점 @param {number} size @param {number} seed */
  function makeNap(size, seed) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(size, size);
    const d = img.data;
    const rnd = rng(seed);
    for (let i = 0; i < d.length; i += 4) {
      const v = rnd();
      const light = v > 0.5;
      d[i] = light ? 255 : 0; d[i + 1] = light ? 250 : 0; d[i + 2] = light ? 225 : 0;
      d[i + 3] = Math.abs(v - 0.5) * (light ? 34 : 70);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  /** 벨벳에 아주 얕게 짜 넣은 석류 무늬 다마스크(오지 격자 + 석류) */
  function makeDamask() {
    const fill = 'rgba(255,246,214,.042)', line = 'rgba(255,246,214,.06)', cut = 'rgba(0,0,0,.16)';
    const motif = '<path d="M0 -16C12 -16 18 -6 18 4C18 16 9 24 0 24C-9 24 -18 16 -18 4C-18 -6 -12 -16 0 -16Z"/>' +
      '<path d="M-6 -15L-8 -27L-3 -20L0 -29L3 -20L8 -27L6 -15Z"/>' +
      '<path d="M-19 10C-35 6 -41 -8 -37 -23C-27 -17 -19 -6 -19 10ZM19 10C35 6 41 -8 37 -23C27 -17 19 -6 19 10Z"/>' +
      '<path d="M-9 26C-22 34 -25 47 -17 58C-8 49 -5 37 -9 26ZM9 26C22 34 25 47 17 58C8 49 5 37 9 26Z"/>' +
      '<path d="M-3 -34C-10 -44 -8 -54 0 -62C8 -54 10 -44 3 -34Z"/>' +
      '<path d="M0 -7C6 -1 6 10 0 17C-6 10 -6 -1 0 -7Z" fill="' + cut + '"/>' +
      '<circle cx="0" cy="1" r="1.3"/><circle cx="-1.6" cy="6" r="1.3"/><circle cx="1.6" cy="6" r="1.3"/><circle cx="0" cy="11" r="1.3"/>';
    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 200" width="140" height="200">' +
      '<path d="M70 0C70 40 140 60 140 100C140 140 70 160 70 200C70 160 0 140 0 100C0 60 70 40 70 0Z" fill="none" stroke="' + line + '" stroke-width="3.2"/>' +
      '<path d="M70 12C72 44 128 64 128 100C128 136 72 156 70 188C68 156 12 136 12 100C12 64 68 44 70 12Z" fill="none" stroke="' + line + '" stroke-width=".8"/>' +
      '<g fill="' + fill + '">';
    for (const p of [[70, 100], [0, 0], [140, 0], [0, 200], [140, 200]]) s += '<g transform="translate(' + p[0] + ' ' + p[1] + ')">' + motif + '</g>';
    s += '</g></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(s);
  }

  let grainUri = '';
  /** @type {HTMLStyleElement|null} */
  let textureStyle = null;
  /** 질감을 만들고 CSS 변수(--ix-grain, --ix-nap, --ix-damask)로 내보낸다(한 번만, 문서에서 떼였으면 다시 붙인다). */
  function ensureTextures() {
    if (typeof document === 'undefined') return;
    if (textureStyle) {
      if (!textureStyle.isConnected) (document.head || document.documentElement).appendChild(textureStyle);
      return;
    }
    grainUri = makeGrain(256, 7, 5, 1);
    const nap = makeNap(128, 11);
    const st = textureStyle = document.createElement('style');
    st.id = 'ix-textures';
    st.textContent = '.skin-intarsia{--ix-grain:url(' + grainUri + ');--ix-nap:url(' + nap + ');--ix-damask:url("' + makeDamask() + '")}';
    (document.head || document.documentElement).appendChild(st);
  }

  /** @param {string} id @param {number[]} v x1,y1,x2,y2 @param {(string|number)[][]} stops [자리, 색, 불투명도?] @param {string} [extra] */
  function lin(id, v, stops, extra) {
    return '<linearGradient id="' + id + '" x1="' + v[0] + '" y1="' + v[1] + '" x2="' + v[2] + '" y2="' + v[3] + '"' + (extra || '') + '>' + stopStr(stops) + '</linearGradient>';
  }
  /** @param {string} id @param {number[]} v cx,cy,r[,fx,fy] @param {(string|number)[][]} stops @param {string} [extra] */
  function rad(id, v, stops, extra) {
    return '<radialGradient id="' + id + '" cx="' + v[0] + '" cy="' + v[1] + '" r="' + v[2] + '"' +
      (v.length > 3 ? ' fx="' + v[3] + '" fy="' + v[4] + '"' : '') + (extra || '') + '>' + stopStr(stops) + '</radialGradient>';
  }
  /** @param {(string|number)[][]} stops */
  function stopStr(stops) {
    return stops.map((s) => '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s.length > 2 ? ' stop-opacity="' + s[2] + '"' : '') + '/>').join('');
  }

  /* 나무 결 방향 6가지(도). 조각마다 다른 방향을 골라 상감의 '결 방향 차이'를 낸다. */
  const GRAIN_ANGLES = [0, 90, 28, -28, 62, -62];

  /** @type {SVGSVGElement|null} */
  let defsHolder = null;
  /** 공용 <defs>(결 무늬, 그을림 그라데이션, 보석, 뒷면 등)를 문서에 한 번 넣는다. 셸이 body 를 비워 떼였으면 다시 붙인다. */
  function ensureDefs() {
    if (typeof document === 'undefined') return;
    const host = document.body || document.documentElement;
    if (!host) return;
    if (defsHolder) {
      if (!defsHolder.isConnected) host.insertBefore(defsHolder, host.firstChild);
      return;
    }
    ensureTextures();
    let d = '';
    GRAIN_ANGLES.forEach((a, i) => {
      d += '<pattern id="ix-gr' + i + '" patternUnits="userSpaceOnUse" width="60" height="60" patternTransform="rotate(' + a + ')">' +
        '<image href="' + grainUri + '" width="60" height="60" preserveAspectRatio="none"/></pattern>';
    });
    /* 그을림(달군 모래에 담가 한쪽 가장자리를 태우는 상감 음영): 조각 상자 기준이라 어느 조각에나 쓴다 */
    const burn = '#1c1006';
    d += lin('ix-sc-l', [0, 0, 1, 0], [[0, burn, 0.62], [0.7, burn, 0]]);
    d += lin('ix-sc-r', [1, 0, 0, 0], [[0, burn, 0.62], [0.7, burn, 0]]);
    d += lin('ix-sc-t', [0, 0, 0, 1], [[0, burn, 0.62], [0.7, burn, 0]]);
    d += lin('ix-sc-b', [0, 1, 0, 0], [[0, burn, 0.62], [0.7, burn, 0]]);
    d += lin('ix-sc-tl', [0, 0, 1, 1], [[0, burn, 0.6], [0.6, burn, 0]]);
    d += lin('ix-sc-br', [1, 1, 0, 0], [[0, burn, 0.6], [0.6, burn, 0]]);
    d += lin('ix-sc-tr', [1, 0, 0, 1], [[0, burn, 0.6], [0.6, burn, 0]]);
    d += lin('ix-sc-bl', [0, 1, 1, 0], [[0, burn, 0.6], [0.6, burn, 0]]);
    d += rad('ix-sc-o', [0.5, 0.5, 0.62], [[0.45, burn, 0], [1, burn, 0.6]]);
    d += lin('ix-li-t', [0, 0, 0, 1], [[0, '#fff6dc', 0.5], [0.6, '#fff6dc', 0]]);
    d += lin('ix-li-l', [0, 0, 1, 0], [[0, '#fff6dc', 0.5], [0.6, '#fff6dc', 0]]);
    d += lin('ix-li-tl', [0, 0, 1, 1], [[0, '#fff6dc', 0.5], [0.55, '#fff6dc', 0]]);
    /* 카드 위: 니스 광택과 가장자리 어두움, 정보 자리 바탕 */
    d += lin('ix-varnish', [0, 0, 1, 1], [[0, '#fff', 0.14], [0.3, '#fff', 0.02], [0.55, '#fff', 0], [1, '#000', 0.16]]);
    d += rad('ix-vig', [0.5, 0.5, 0.75], [[0.55, '#000', 0], [1, '#000', 0.34]]);
    d += lin('ix-band', [0, 0, 0, 1], [[0, '#0e0a06', 0.9], [0.7, '#0e0a06', 0.74], [1, '#0e0a06', 0.6]]);
    d += lin('ix-band-k', [0, 0, 1, 0], [[0, '#0e0a06', 0.86], [0.42, '#0e0a06', 0.7], [1, '#3a2f20', 0.38]]);
    d += rad('ix-costshade', [0, 1, 1], [[0, '#0b0805', 0.78], [0.55, '#0b0805', 0.45], [1, '#0b0805', 0]]);
    d += rad('ix-halo-l', [0.5, 0.5, 0.5], [[0, '#fff3d0', 0.75], [0.6, '#fff3d0', 0.3], [1, '#fff3d0', 0]]);
    d += rad('ix-halo-d', [0.5, 0.5, 0.5], [[0, '#000', 0.6], [0.6, '#000', 0.28], [1, '#000', 0]]);
    for (const c of COLORS) {
      const glow = c === 'k' ? '#fff6dc' : DYE[c][c === 'w' ? 4 : 3];
      d += rad('ix-glow-' + c, [0.5, 0.5, 0.5], [[0, glow, c === 'k' ? 0.75 : 0.6], [0.55, glow, 0.24], [1, glow, 0]]);
    }
    d += gemDefs();
    d += numberDefs();
    d += backDefs();
    d += nobleDefs();
    d += medalDefs();
    const holder = defsHolder = svg('0 0 10 10', 'ix-defs', '<defs>' + d + '</defs>');
    holder.setAttribute('width', '0');
    holder.setAttribute('height', '0');
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    host.insertBefore(holder, host.firstChild);
  }

  /* ═════════════ 3. 보석 ═════════════ */

  /** 반짝임 별 @param {number} x @param {number} y @param {number} r @param {number} [o] */
  function sparkle(x, y, r, o) {
    const k = r * 0.16;
    return '<path d="' + poly([[x, y - r], [x + k, y - k], [x + r, y], [x + k, y + k], [x, y + r], [x - k, y + k], [x - r, y], [x - k, y - k]]) +
      '" fill="#fff" opacity="' + (o === undefined ? 0.95 : o) + '"/>';
  }

  /** 육각·팔각 등 바깥 윤곽 @type {Record<TokenColor, string>} */
  const SILHOUETTE = { w: '', u: '', g: '', r: '', k: '', gold: '' };

  /** 흰 = 테이블 컷 다이아몬드, 45° 돌린 정사각 */
  function gemDiamond() {
    const cx = 50, cy = 46, R = 41, r = 23;
    const T = [cx, cy - R], E = [cx + R, cy], B = [cx, cy + R], W = [cx - R, cy];
    const t = [cx, cy - r], e = [cx + r, cy], b = [cx, cy + r], w = [cx - r, cy], C = [cx, cy];
    /** @param {number[]} a @param {number[]} b2 */
    const mid = (a, b2) => [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2];
    SILHOUETTE.w = '<polygon points="' + pstr([T, E, B, W]) + '"/>';
    let d = lin('ix-dw1', [0, 1, 1, 0], [[0, '#eaeff6'], [0.55, '#ffffff'], [1, '#f6f9fc']]) +
      lin('ix-dw2', [0, 0, 1, 1], [[0, '#fbfdff'], [1, '#dde4ee']]) +
      lin('ix-dw3', [0, 0, 1, 1], [[0, '#e4e9f1'], [1, '#cfd8e4']]) +
      lin('ix-dw4', [1, 0, 0, 1], [[0, '#dbe2ec'], [1, '#eef2f7']]) +
      lin('ix-dwt', [0, 0, 1, 1], [[0, '#ffffff'], [0.5, '#f0f4f9'], [1, '#d6deea']]) +
      lin('ix-dw5', [0.2, 0, 0.8, 1], [[0, '#fff', 0.5], [0.3, '#fff', 0], [0.7, '#1c2740', 0], [1, '#1c2740', 0.03]]);
    let s = '<g id="ix-gem-w">' +
      '<ellipse cx="53" cy="90" rx="27" ry="6" fill="url(#ix-gshadow)"/>' +
      '<polygon points="' + pstr([[T[0] + 2, T[1] + 4], [E[0] + 2, E[1] + 4], [B[0] + 2, B[1] + 4], [W[0] + 2, W[1] + 4]]) + '" fill="#000" opacity=".38"/>' +
      /* 관(crown) 네 면 */
      '<polygon points="' + pstr([W, T, t, w]) + '" fill="url(#ix-dw1)"/>' +
      '<polygon points="' + pstr([T, E, e, t]) + '" fill="url(#ix-dw2)"/>' +
      '<polygon points="' + pstr([E, B, b, e]) + '" fill="url(#ix-dw3)"/>' +
      '<polygon points="' + pstr([B, W, w, b]) + '" fill="url(#ix-dw4)"/>' +
      /* 관 면마다 모서리 쪽 작은 삼각 면(빛이 갈리는 자리) */
      '<polygon points="' + pstr([W, mid(W, T), w]) + '" fill="#eef2f8"/>' +
      '<polygon points="' + pstr([mid(W, T), T, t]) + '" fill="#ffffff"/>' +
      '<polygon points="' + pstr([T, mid(T, E), t]) + '" fill="#f1f5fa"/>' +
      '<polygon points="' + pstr([mid(T, E), E, e]) + '" fill="#d9e1ec"/>' +
      '<polygon points="' + pstr([E, mid(E, B), e]) + '" fill="#cfd8e4"/>' +
      '<polygon points="' + pstr([mid(E, B), B, b]) + '" fill="#c6d0de"/>' +
      '<polygon points="' + pstr([B, mid(B, W), b]) + '" fill="#c9d3e0"/>' +
      '<polygon points="' + pstr([mid(B, W), W, w]) + '" fill="#e2e8f0"/>' +
      '<path d="M' + pstr([w]) + 'L' + pstr([mid(W, T)]) + 'L' + pstr([t]) + 'L' + pstr([mid(T, E)]) + 'L' + pstr([e]) + 'L' + pstr([mid(E, B)]) + 'L' + pstr([b]) + 'L' + pstr([mid(B, W)]) + 'Z" fill="none" stroke="#fff" stroke-width=".5" opacity=".6"/>' +
      /* 테이블: 아래 면(pavilion)이 비쳐 보이는 네 삼각 + 큘렛 */
      '<polygon points="' + pstr([t, e, b, w]) + '" fill="url(#ix-dwt)"/>' +
      '<polygon points="' + pstr([w, t, C]) + '" fill="#ffffff" opacity=".9"/>' +
      '<polygon points="' + pstr([t, e, C]) + '" fill="#eaf0f6"/>' +
      '<polygon points="' + pstr([e, b, C]) + '" fill="#c8d2df"/>' +
      '<polygon points="' + pstr([b, w, C]) + '" fill="#d8e0ea"/>' +
      /* 안쪽 반사: 가는 빛 조각과 어두운 조각 */
      '<polygon points="' + pstr([[cx - 15, cy - 8], [cx - 4, cy - 19], [cx - 3, cy - 4]]) + '" fill="#f4f7fb"/>' +
      '<polygon points="' + pstr([[cx + 4, cy - 17], [cx + 15, cy - 6], [cx + 5, cy - 3]]) + '" fill="#ffffff"/>' +
      '<polygon points="' + pstr([[cx + 16, cy + 5], [cx + 6, cy + 15], [cx + 4, cy + 4]]) + '" fill="#a9b6c9"/>' +
      '<polygon points="' + pstr([[cx - 5, cy + 16], [cx - 15, cy + 6], [cx - 4, cy + 5]]) + '" fill="#eaf0f7"/>' +
      '<polygon points="' + pstr([[cx, cy - 7], [cx + 7, cy], [cx, cy + 7], [cx - 7, cy]]) + '" fill="#b8c3d3"/>' +
      '<polygon points="' + pstr([[cx, cy - 7], [cx + 7, cy], [cx, cy], [cx - 7, cy]]) + '" fill="#f6f9fc"/>' +
      /* 모서리 선 */
      '<g fill="none" stroke-linejoin="round">' +
      '<polygon points="' + pstr([t, e, b, w]) + '" stroke="#fff" stroke-width=".9" opacity=".9"/>' +
      '<path d="M' + pstr([W]) + 'L' + pstr([w]) + 'M' + pstr([T]) + 'L' + pstr([t]) + 'M' + pstr([E]) + 'L' + pstr([e]) + 'M' + pstr([B]) + 'L' + pstr([b]) + '" stroke="#8191aa" stroke-width=".6" opacity=".7"/>' +
      '<polygon points="' + pstr([T, E, B, W]) + '" stroke="#8e99af" stroke-width="1"/>' +
      '<path d="M' + pstr([[W[0] + 2, W[1] - 0.5]]) + 'L' + pstr([[T[0], T[1] + 2.2]]) + 'L' + pstr([[E[0] - 2, E[1] - 0.5]]) + '" stroke="#fff" stroke-width="1.1" opacity=".95"/>' +
      '</g>' +
      '<polygon points="' + pstr([T, E, B, W]) + '" fill="url(#ix-dw5)"/>' +
      sparkle(cx - 19, cy - 20, 9) + sparkle(cx + 15, cy + 13, 4.5, 0.8) +
      '</g>';
    return d + s;
  }

  /** 파랑 = 세로 타원 카보숑 사파이어 */
  function gemSapphire() {
    const cx = 50, cy = 46, rx = 31, ry = 41;
    SILHOUETTE.u = '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '"/>';
    const d = rad('ix-su1', [0.6, 0.7, 0.8], [[0, '#2f68e0'], [0.3, '#1845bd'], [0.62, '#0d2a8a'], [1, '#040c44']]) +
      lin('ix-su2', [0, 0, 0, 1], [[0, '#030a3d', 0.75], [0.55, '#030a3d', 0]]) +
      rad('ix-su3', [0.5, 0.5, 0.5], [[0, '#bfe0ff', 0.9], [0.5, '#6aa8ff', 0.45], [1, '#3d7dff', 0]]) +
      lin('ix-su4', [0, 0, 1, 1], [[0, '#fff', 0.98], [0.6, '#fff', 0.55], [1, '#fff', 0]]) +
      lin('ix-su5', [0, 0, 1, 1], [[0.45, '#9cc4ff', 0], [1, '#b7d6ff', 0.95]]) +
      rad('ix-su6', [0.5, 0.5, 0.5], [[0, '#fff', 0.55], [1, '#fff', 0]]);
    const s = '<g id="ix-gem-u">' +
      '<ellipse cx="53" cy="90" rx="24" ry="6" fill="url(#ix-gshadow)"/>' +
      '<ellipse cx="' + (cx + 2) + '" cy="' + (cy + 4) + '" rx="' + rx + '" ry="' + ry + '" fill="#000" opacity=".4"/>' +
      '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="url(#ix-su1)"/>' +
      '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="url(#ix-su2)"/>' +
      /* 빛이 돌 안을 지나 반대편에 모이는 밝은 자리 */
      '<ellipse cx="58" cy="67" rx="14" ry="16" fill="url(#ix-su3)" opacity=".8"/>' +
      /* 별빛(성채) 세 줄: 아주 얕게 */
      '<g opacity=".55"><ellipse cx="48" cy="44" rx="1.1" ry="34" fill="url(#ix-su6)"/>' +
      '<ellipse cx="48" cy="44" rx="1.1" ry="27" fill="url(#ix-su6)" transform="rotate(60 48 44)"/>' +
      '<ellipse cx="48" cy="44" rx="1.1" ry="27" fill="url(#ix-su6)" transform="rotate(-60 48 44)"/></g>' +
      /* 가장자리 되비침 */
      '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (rx - 1.6) + '" ry="' + (ry - 1.6) + '" fill="none" stroke="url(#ix-su5)" stroke-width="1.8"/>' +
      /* 돔 위 하이라이트: 창문 비침 모양 */
      '<path d="M27 37C27 21 37 11 49 9.5C41 15 35.5 24 34.5 37C33.5 43 27.5 43 27 37Z" fill="url(#ix-su4)"/>' +
      '<ellipse cx="41" cy="20" rx="7.5" ry="4.2" transform="rotate(-38 41 20)" fill="#fff" opacity=".9"/>' +
      '<circle cx="35" cy="50" r="2" fill="#fff" opacity=".7"/>' +
      '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="none" stroke="#06114c" stroke-width="1.3"/>' +
      /* 어두운 바탕에서 떼어 주는 테두리 빛 */
      '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (rx + 0.9) + '" ry="' + (ry + 0.9) + '" fill="none" stroke="#7ea9ff" stroke-width=".9" opacity=".6"/>' +
      '</g>';
    return d + s;
  }

  /** 초록 = 가로로 긴 팔각 스텝 컷 에메랄드 */
  function gemEmerald() {
    const cx = 50, cy = 46;
    /** @param {number} ins */
    function oct(ins) {
      const hw = 43 - ins, hh = 30 - ins, c = Math.max(2, 14 - ins * 0.42);
      return [[cx - hw + c, cy - hh], [cx + hw - c, cy - hh], [cx + hw, cy - hh + c], [cx + hw, cy + hh - c],
        [cx + hw - c, cy + hh], [cx - hw + c, cy + hh], [cx - hw, cy + hh - c], [cx - hw, cy - hh + c]];
    }
    const rings = [oct(0), oct(6.5), oct(12), oct(16.5)];
    SILHOUETTE.g = '<polygon points="' + pstr(rings[0]) + '"/>';
    /* 면 방향별 밝기: 위, 오른위 모서리, 오른, 오른아래, 아래, 왼아래, 왼, 왼위 */
    const tone = [
      ['#96f2c4', '#40cd8b', '#18995e', '#0e7446', '#0c683f', '#128651', '#25b675', '#ccffe4'],
      ['#6be0a9', '#2cbd7a', '#158e57', '#0d6e42', '#0c633b', '#127f4d', '#22ab6c', '#a3f5cd'],
      ['#b6f9d8', '#57da9d', '#20aa6a', '#148a54', '#147c4c', '#1a9a5f', '#33c886', '#e8fff3'],
    ];
    const d = lin('ix-em1', [0, 0, 1, 1], [[0, '#3fd690'], [0.45, '#1ca264'], [1, '#107a4c']]) +
      lin('ix-em2', [0, 0, 1, 0], [[0, '#fff', 0], [0.5, '#fff', 0.55], [1, '#fff', 0]]);
    let s = '<g id="ix-gem-g">' +
      '<ellipse cx="53" cy="80" rx="34" ry="6" fill="url(#ix-gshadow)"/>' +
      '<polygon points="' + pstr(rings[0].map((p) => [p[0] + 2, p[1] + 4])) + '" fill="#000" opacity=".4"/>';
    for (let k = 0; k < 3; k++) {
      const a = rings[k], b = rings[k + 1];
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        s += '<polygon points="' + pstr([a[i], a[j], b[j], b[i]]) + '" fill="' + tone[k][i] + '"/>';
      }
    }
    const tb = rings[3];
    s += '<polygon points="' + pstr(tb) + '" fill="url(#ix-em1)"/>' +
      '<clipPath id="ix-emclip"><polygon points="' + pstr(tb) + '"/></clipPath>' +
      '<g clip-path="url(#ix-emclip)">' +
      '<polygon points="26,60 44,30 55,30 37,60" fill="#fff" opacity=".42"/>' +
      '<polygon points="58,60 70,30 74,30 62,60" fill="#fff" opacity=".2"/>' +
      '<polygon points="20,46 80,46 80,60 20,60" fill="#04351f" opacity=".2"/>' +
      '</g>' +
      '<g fill="none" stroke-linejoin="round">' +
      '<polygon points="' + pstr(rings[1]) + '" stroke="#063b25" stroke-width=".5" opacity=".7"/>' +
      '<polygon points="' + pstr(rings[2]) + '" stroke="#063b25" stroke-width=".5" opacity=".7"/>' +
      '<polygon points="' + pstr(tb) + '" stroke="#d9ffec" stroke-width=".8" opacity=".85"/>' +
      '<polygon points="' + pstr(rings[0]) + '" stroke="#032918" stroke-width="1.5"/>' +
      '<path d="M' + pstr([[rings[0][7][0] + 1, rings[0][7][1] + 1]]) + 'L' + pstr([[rings[0][0][0] + 0.4, rings[0][0][1] + 1.3]]) + 'L' + pstr([[rings[0][1][0] - 1, rings[0][1][1] + 1.3]]) + '" stroke="#f1fff7" stroke-width="1.1"/>' +
      '</g>' +
      sparkle(cx - 31, cy - 21, 8) + sparkle(cx + 24, cy + 12, 4, 0.75) +
      '</g>';
    return d + s;
  }

  /** 빨강 = 원형 로즈 컷 루비(삼각 면이 꼭대기로 모이는 돔) */
  function gemRuby() {
    const cx = 50, cy = 46, R = 40, r1 = 19;
    /** @type {number[][]} */
    const hexp = [], gird = [];
    for (let i = 0; i < 6; i++) { const a = (i * 60 - 90) * Math.PI / 180; hexp.push([cx + r1 * Math.cos(a), cy + r1 * Math.sin(a), 10]); }
    for (let i = 0; i < 12; i++) { const a = (i * 30 - 90) * Math.PI / 180; gird.push([cx + R * Math.cos(a), cy + R * Math.sin(a), 0]); }
    const apex = [cx, cy, 16];
    /** @type {number[][][]} */
    const tris = [];
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      tris.push([apex, hexp[i], hexp[j]]);
      tris.push([hexp[i], gird[(2 * i + 1) % 12], hexp[j]]);
      tris.push([hexp[i], gird[(2 * i + 11) % 12], gird[2 * i]]);
      tris.push([hexp[i], gird[2 * i], gird[(2 * i + 1) % 12]]);
    }
    const L = [-0.48, -0.62, 0.62];
    const shades = [[0, '#6a0c1a'], [0.22, '#98131f'], [0.45, '#c81c30'], [0.62, '#e23346'], [0.8, '#f5666f'], [0.93, '#ffb0b0'], [1, '#fff0ee']];
    const rnd = rng(31);
    SILHOUETTE.r = '<polygon points="' + pstr(gird) + '"/>';
    let s = '<g id="ix-gem-r">' +
      '<ellipse cx="53" cy="89" rx="27" ry="6" fill="url(#ix-gshadow)"/>' +
      '<circle cx="' + (cx + 2) + '" cy="' + (cy + 4) + '" r="' + (R + 0.5) + '" fill="#000" opacity=".4"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R + 0.3) + '" fill="#7c101f"/>';
    const overlay = rad('ix-rb1', [0.64, 0.7, 0.42], [[0, '#ff8a80', 0.55], [1, '#ff5a5a', 0]]) +
      lin('ix-rb2', [0, 0, 1, 1], [[0, '#fff', 0.5], [0.34, '#fff', 0.06], [0.5, '#fff', 0], [0.72, '#300008', 0], [1, '#300008', 0.2]]);
    for (const t of tris) {
      const a = t[0], b = t[1], c = t[2];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
      const len = Math.hypot(n[0], n[1], n[2]);
      const dot = (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / len;
      /* 겉면 밝기 + 맞은편 면에 맺히는 안쪽 되비침 + 면마다 조금씩 다른 반짝임 */
      const back = Math.max(0, -(n[0] * L[0] + n[1] * L[1]) / len);
      const lit = Math.max(0, (dot - 0.34) / 0.62);
      let v0 = 0.2 + Math.pow(lit, 1.5) * 0.62 + back * back * 1.5 * (rnd() < 0.55 ? 1 : 0.2) + (rnd() - 0.5) * 0.22;
      if (dot > 0.95) v0 = 0.97;
      s += '<polygon points="' + pstr([a, b, c]) + '" fill="' + ramp(shades, v0) + '"/>';
    }
    s += '<polygon points="' + pstr(gird) + '" fill="url(#ix-rb1)"/><polygon points="' + pstr(gird) + '" fill="url(#ix-rb2)"/>';
    s += '<g fill="none" stroke-linejoin="round">';
    let web = '';
    for (const t of tris) web += 'M' + pstr([t[0]]) + 'L' + pstr([t[1]]) + 'L' + pstr([t[2]]) + 'Z';
    s += '<path d="' + web + '" stroke="#ffc9c4" stroke-width=".4" opacity=".34"/>' +
      '<polygon points="' + pstr(gird) + '" stroke="#34030c" stroke-width="1.5"/>' +
      '<path d="M' + pstr([gird[9]]) + 'L' + pstr([gird[10]]) + 'L' + pstr([gird[11]]) + 'L' + pstr([gird[0]]) + '" stroke="#ffd9d6" stroke-width="1" opacity=".85" transform="translate(.8 1)"/>' +
      '</g>' +
      sparkle(cx - 13, cy - 17, 9) + sparkle(cx + 20, cy + 17, 4.5, 0.8) + sparkle(cx + 4, cy - 2, 3, 0.7) +
      '</g>';
    return overlay + s;
  }

  /** 검정 = 육각 음각 판 오닉스(흰 층까지 파 내려가 무늬가 드러나는 니콜로 방식) */
  function gemOnyx() {
    const cx = 50, cy = 46;
    /** @param {number} R */
    function hx(R) {
      const p = [];
      for (let i = 0; i < 6; i++) { const a = (i * 60) * Math.PI / 180; p.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
      return p;
    }
    const o = hx(44), band = hx(35.4), inn = hx(34.2);
    SILHOUETTE.k = '<polygon points="' + pstr(o) + '"/>';
    /* 면 순서: 0 오른아래, 1 아래, 2 왼아래, 3 왼위, 4 위, 5 오른위 */
    const bev = ['#050506', '#09090b', '#141519', '#3d4049', '#27292f', '#121316'];
    const d = lin('ix-on1', [0, 0, 1, 1], [[0, '#24252b'], [0.35, '#0e0e11'], [1, '#030304']]) +
      lin('ix-on2', [0, 0, 1, 1], [[0, '#fff', 0.14], [0.38, '#fff', 0.04], [0.5, '#fff', 0]]) +
      lin('ix-on3', [0, 0, 1, 1], [[0, '#8c8779'], [0.5, '#e9e4d6'], [1, '#fffdf6']]);
    let s = '<g id="ix-gem-k">' +
      '<ellipse cx="53" cy="87" rx="30" ry="6" fill="url(#ix-gshadow)"/>' +
      '<polygon points="' + pstr(o.map((p) => [p[0] + 2, p[1] + 4])) + '" fill="#000" opacity=".42"/>';
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      s += '<polygon points="' + pstr([o[i], o[j], band[j], band[i]]) + '" fill="' + bev[i] + '"/>';
    }
    s += '<polygon points="' + pstr(band) + '" fill="#cfcabc"/>' +
      '<polygon points="' + pstr(inn) + '" fill="url(#ix-on1)"/>';
    /* 음각 꽃무늬: 여섯 잎 + 가운데 구슬 + 둘레 고리 */
    let petals = '';
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 + 30) * Math.PI / 180;
      const ex = cx + 19.5 * Math.cos(a), ey = cy + 19.5 * Math.sin(a);
      const px = -Math.sin(a) * 4.6, py = Math.cos(a) * 4.6;
      const mx = cx + 11 * Math.cos(a), my = cy + 11 * Math.sin(a);
      petals += 'M' + f(cx + 3.5 * Math.cos(a)) + ' ' + f(cy + 3.5 * Math.sin(a)) +
        'Q' + f(mx + px) + ' ' + f(my + py) + ' ' + f(ex) + ' ' + f(ey) +
        'Q' + f(mx - px) + ' ' + f(my - py) + ' ' + f(cx + 3.5 * Math.cos(a)) + ' ' + f(cy + 3.5 * Math.sin(a)) + 'Z';
    }
    s += '<path d="' + petals + '" fill="#000" transform="translate(-.9 -1.1)"/>' +
      '<path d="' + petals + '" fill="url(#ix-on3)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="2.6" fill="#f4efe2" stroke="#000" stroke-width=".6"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="25.5" fill="none" stroke="#000" stroke-width="1.2" transform="translate(-.5 -.6)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="25.5" fill="none" stroke="#bdb8aa" stroke-width=".7"/>' +
      '<polygon points="' + pstr(inn) + '" fill="url(#ix-on2)"/>' +
      '<g fill="none" stroke-linejoin="round">' +
      '<polygon points="' + pstr(o) + '" stroke="#000" stroke-width="1.2"/>' +
      /* 어두운 바탕에서 떼어 주는 테두리 빛 */
      '<polygon points="' + pstr(hx(45)) + '" stroke="#9a9eab" stroke-width=".9" opacity=".62"/>' +
      '<path d="M' + pstr([o[3]]) + 'L' + pstr([o[4]]) + 'L' + pstr([o[5]]) + '" stroke="#c9ccd6" stroke-width="1.2" transform="translate(.9 1.1)"/>' +
      '</g>' +
      sparkle(cx - 22, cy - 29, 6, 0.9) +
      '</g>';
    return d + s;
  }

  /** 백합(플로린의 문양) 길 — 가운데 (0,0), 높이 약 40 */
  const LILY = 'M0 -20C5 -13 7 -6 4 3L-4 3C-7 -6 -5 -13 0 -20Z' +
    'M-5 5C-10 4 -13 -1 -18 -3C-22 -4.5 -25 -1.5 -24 2C-23 5 -19 5 -18 2.5C-16 6.5 -11 8.5 -5 8Z' +
    'M5 5C10 4 13 -1 18 -3C22 -4.5 25 -1.5 24 2C23 5 19 5 18 2.5C16 6.5 11 8.5 5 8Z' +
    'M-8 8.6H8V12H-8Z' +
    'M0 13L-4 21L0 18.5L4 21Z' +
    'M-5 12.6C-8 16 -11 17.5 -15 17.5C-12 20.5 -7 19.5 -3.5 14Z' +
    'M5 12.6C8 16 11 17.5 15 17.5C12 20.5 7 19.5 3.5 14Z' +
    'M-3.2 2L-8.5 -11.5A1.9 1.9 0 1 1 -6.6 -12.2L-1.6 1.4Z' +
    'M3.2 2L8.5 -11.5A1.9 1.9 0 1 0 6.6 -12.2L1.6 1.4Z';

  /** 황금 = 피렌체 플로린 금화(구슬 테두리, 백합) */
  function gemFlorin() {
    const cx = 50, cy = 46, R = 41;
    SILHOUETTE.gold = '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '"/>';
    const d = lin('ix-fl1', [0, 0, 1, 1], [[0, '#fff6c6'], [0.35, '#f5d370'], [0.7, '#e0b042'], [1, '#b88a28']]) +
      lin('ix-fl2', [0, 0, 1, 1], [[0, '#a87a17'], [0.5, '#d9aa3c'], [1, '#f7dd86']]) +
      rad('ix-fl3', [0.4, 0.35, 0.75], [[0, '#f5d36c'], [0.6, '#dcab3c'], [1, '#b6871f']]) +
      lin('ix-fl4', [0, 0, 1, 1], [[0, '#fff', 0.5], [0.4, '#fff', 0], [1, '#fff', 0]]);
    const s = '<g id="ix-gem-gold">' +
      '<ellipse cx="53" cy="90" rx="29" ry="6" fill="url(#ix-gshadow)"/>' +
      '<circle cx="' + (cx + 1.6) + '" cy="' + (cy + 4.2) + '" r="' + R + '" fill="#000" opacity=".4"/>' +
      '<circle cx="' + cx + '" cy="' + (cy + 2.6) + '" r="' + R + '" fill="#6f4f0a"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="url(#ix-fl1)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R - 3) + '" fill="none" stroke="url(#ix-fl2)" stroke-width="2"/>' +
      /* 구슬 테두리: 그림자 → 구슬 */
      '<circle cx="' + (cx + 0.6) + '" cy="' + (cy + 0.9) + '" r="34" fill="none" stroke="#8a6412" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="0 5.34"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="34" fill="none" stroke="#fbe493" stroke-width="3.1" stroke-linecap="round" stroke-dasharray="0 5.34"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="29.5" fill="url(#ix-fl3)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="29.5" fill="none" stroke="#8a6412" stroke-width="1" transform="translate(-.4 -.5)" opacity=".8"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="29.5" fill="none" stroke="#fdeaa5" stroke-width=".8" transform="translate(.5 .6)" opacity=".8"/>' +
      /* 백합 돋을새김: 그림자 → 밝은 가장자리 → 몸 */
      '<g transform="translate(' + cx + ' ' + (cy + 0.5) + ') scale(1.02)">' +
      '<path d="' + LILY + '" fill="#7a560c" transform="translate(1 1.3)"/>' +
      '<path d="' + LILY + '" fill="#fff6c9" transform="translate(-.7 -.8)"/>' +
      '<path d="' + LILY + '" fill="#efc758"/>' +
      '</g>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="url(#ix-fl4)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="#5a3f06" stroke-width="1.4"/>' +
      sparkle(cx - 24, cy - 26, 6.5, 0.9) +
      '</g>';
    return d + s;
  }

  function gemDefs() {
    let d = rad('ix-gshadow', [0.5, 0.5, 0.5], [[0, '#000', 0.55], [0.6, '#000', 0.22], [1, '#000', 0]]) +
      lin('ix-glintfill', [0, 0, 1, 0], [[0, '#fff', 0], [0.4, '#fff', 0.7], [0.55, '#fff', 0.85], [1, '#fff', 0]]);
    d += gemDiamond() + gemSapphire() + gemEmerald() + gemRuby() + gemOnyx() + gemFlorin();
    for (const c of TOKENS) d += '<clipPath id="ix-clip-' + c + '">' + SILHOUETTE[c] + '</clipPath>';
    return d;
  }

  /** 보석 하나(황금은 플로린 금화). class 'is-glint' 가 붙으면 빛이 한 번 스친다. @param {TokenColor} color @param {number} px @returns {SVGSVGElement} */
  function gem(color, px) {
    ensureDefs();
    const s = svg('0 0 100 100', 'ix-gem ix-gem--' + color,
      '<use href="#ix-gem-' + color + '"/>' +
      '<g clip-path="url(#ix-clip-' + color + ')"><polygon class="ix-gem__glint" points="-36,-8 -18,-8 -48,104 -66,104" fill="url(#ix-glintfill)"/></g>');
    if (px) { s.style.width = px + 'px'; s.style.height = px + 'px'; }
    return s;
  }

  /* ═════════════ 4. 숫자·칩·보너스·점수 ═════════════ */

  function numberDefs() {
    return lin('ix-numfill', [0, 0, 0, 1], [[0, '#fffdf0'], [0.38, '#f6e3a6'], [0.7, '#dfb45a'], [1, '#b98a34']]) +
      lin('ix-numfill-dim', [0, 0, 0, 1], [[0, '#d8d0bb'], [1, '#9a917b']]);
  }

  /**
   * 틀 없는 큰 숫자(점수 계열): 상아·금박 채움 + 어두운 외곽선 + 눌린 그림자. SVG 글자라 어떤 크기에서도 또렷하다.
   * @param {string|number} text @param {string} cls
   */
  function numeral(text, cls) {
    const t = String(text);
    const w = 25 * t.length + 8;
    const x = w / 2;
    return svg('0 0 ' + w + ' 40', 'ix-num ' + cls,
      '<text x="' + (x + 1.2) + '" y="35" text-anchor="middle" class="ix-num__s">' + t + '</text>' +
      '<text x="' + x + '" y="33" text-anchor="middle" class="ix-num__o">' + t + '</text>' +
      '<text x="' + x + '" y="33" text-anchor="middle" class="ix-num__f">' + t + '</text>');
  }

  /**
   * 칩 한 닢의 윗면. 테두리 고리(문장학 해칭) + 가운데(숫자나 보석 자리).
   * @param {TokenColor} color @param {string} size CSS 길이 @param {string} extra
   */
  function chipFace(color, size, extra) {
    const el = h('span', 'ix-chip ix-chip--' + color + (extra ? ' ' + extra : ''));
    if (size) el.style.setProperty('--d', size);
    return el;
  }

  /** 카드 비용용 작은 칩(숫자 포함) @param {Color} color @param {number} n @param {number} px @returns {HTMLElement} */
  function costChip(color, n, px) {
    const el = chipFace(color, px ? px + 'px' : '', 'ix-cost');
    el.setAttribute('data-color', color);
    el.appendChild(h('b', 'ix-chip__n', String(n)));
    return el;
  }

  const STACK_MAX = 7;
  const STACK_LIFT = 0.09;

  /** 토큰 더미: 쌓인 높이로 개수를 보이고 숫자는 아래에 둔다 @param {TokenColor} color @param {number} count @param {number} px 칩 지름 @returns {HTMLElement} */
  function chipStack(color, count, px) {
    ensureDefs();
    const el = h('div', 'ix-stack ix-stack--' + color + (count === 0 ? ' is-empty' : ''));
    el.setAttribute('data-color', color);
    el.setAttribute('data-count', String(count));
    el.style.setProperty('--d', px + 'px');
    const shown = Math.min(count, STACK_MAX);
    const lift = Math.max(1.5, px * STACK_LIFT);
    const pile = h('div', 'ix-stack__pile');
    pile.style.height = f(px + shown * lift) + 'px';
    if (count === 0) {
      const ghost = h('span', 'ix-stack__ghost');
      ghost.appendChild(gem(color, Math.round(px * 0.6)));
      pile.appendChild(ghost);
    } else {
      pile.appendChild(h('span', 'ix-stack__shadow'));
      for (let i = 0; i < shown; i++) {
        const wall = h('span', 'ix-chip__wall ix-chip--' + color);
        wall.style.bottom = f(i * lift) + 'px';
        pile.appendChild(wall);
      }
      const top = chipFace(color, '', 'ix-chip--top');
      top.style.bottom = f(shown * lift) + 'px';
      top.appendChild(h('i', 'ix-chip__well'));
      top.appendChild(gem(color, Math.round(px * 0.8)));
      pile.appendChild(top);
    }
    el.appendChild(pile);
    el.appendChild(h('b', 'ix-stack__n', String(count)));
    return el;
  }

  /** 보너스(산 카드 수): 작은 카드 더미 + 숫자. 자리 크기는 폭 0.8px × 높이 px. @param {Color} color @param {number} n @param {number} px @returns {HTMLElement} */
  function bonusTile(color, n, px) {
    const el = h('div', 'ix-bonus ix-bonus--' + color + (n === 0 ? ' is-zero' : '') + (n >= 2 ? ' is-pile' : '') + (n >= 4 ? ' is-pile2' : '') + (n >= 10 ? ' is-2d' : ''));
    el.setAttribute('data-color', color);
    el.style.setProperty('--px', px + 'px');
    el.appendChild(h('b', 'ix-bonus__n', String(n)));
    return el;
  }

  /** 플레이어 점수: 틀 없는 큰 숫자. px 는 글자 높이. @param {number} n @param {number} px @returns {HTMLElement} */
  function pointsBadge(n, px) {
    ensureDefs();
    const el = h('div', 'ix-points' + (n === 0 ? ' is-zero' : ''));
    el.style.setProperty('--px', px + 'px');
    el.setAttribute('data-points', String(n));
    el.appendChild(numeral(n, 'ix-points__n'));
    return el;
  }

  /* ═════════════ 5. 상감 삽화 ═════════════
   * 그림 좌표는 카드 앞면 전체 100×140. 위 0~37 은 점수·보석 띠가 덮고, 왼쪽 아래는 비용 칩이 덮는다.
   * 색을 맡은 물건은 어느 단계든 가운데~오른쪽(대략 x 40~95, y 45~115)에 비슷한 넓이로 놓는다.
   * 조각 하나 = 바탕색 path + 결 무늬 path(+ 그을림 path). 조각 사이 어두운 선이 이음매다.
   */

  /** 장면의 밝기 범위. lo~hi 는 나무 색 띠에서 쓰는 구간. 흰 카드는 밤(어두움), 검정 카드는 낮(밝음).
   * @typedef {{id:string, lo:number, hi:number, sky:number[]}} Mood */
  /** @type {Record<string, Mood>} */
  const MOODS = {
    night: { id: 'night', lo: 0.02, hi: 0.5, sky: [0.1, 0.34] },
    dusk: { id: 'dusk', lo: 0.12, hi: 0.82, sky: [0.5, 0.95] },
    gray: { id: 'gray', lo: 0.24, hi: 0.92, sky: [0.74, 0.92] },
    day: { id: 'day', lo: 0.44, hi: 1, sky: [0.8, 1] },
  };

  /**
   * @typedef {Object} ArtKit
   * @property {() => number} rnd
   * @property {(a:number, b:number) => number} r
   * @property {(l:number, j?:number) => string} wood   0~1 밝기의 나무색(장면 밝기 범위에 맞춰짐)
   * @property {(l:number, j?:number) => string} stone
   * @property {(l:number) => string} raw               장면 밝기와 무관한 나무색
   * @property {(l:number) => string} dark              깊은 그늘(굴 속·창 안). 검정 카드에서는 검은 물건이 묻히지 않게 밝혀 준다
   * @property {(l:number) => string} pale              밝은 물건(종이·불빛). 흰 카드에서는 흰 물건과 겨루지 않게 낮춘다
   * @property {(i:number) => string} dye               색을 맡은 물건의 농담 0(어두움)~4(반짝임)
   * @property {(d:string, fill:string, g?:number, sc?:string, extra?:string) => void} p   조각 하나
   * @property {(d:string, tone:number, g?:number, sc?:string) => void} c                  색 조각 하나
   * @property {(fn:() => void) => void} batch          서로 겹치지 않는 조각 묶음(결 무늬를 모아 그린다)
   * @property {(d:string, id:string, dyed?:boolean) => void} ov   결·그을림만 덧칠(id: 'gr0'~'gr5', 'sc-b' 등)
   * @property {(s:string) => void} add
   * @property {(fn:() => void) => void} fine           작은 카드에서는 감추는 세부
   * @property {Color} color
   * @property {Mood} mood
   * @property {number} v                               같은 장면 틀의 몇 번째 변주인지
   */

  /** @param {number} seed @param {Mood} mood @param {Color} color @param {number} variant */
  function makeArt(seed, mood, color, variant) {
    const rnd = rng(seed);
    /** @type {string[]} */
    const out = [];
    let gi = Math.floor(rnd() * 6);
    let soft = '';
    /** 서로 겹치지 않는 조각 묶음의 결 무늬를 방향별 path 하나로 모은다(요소 수 줄이기) @type {string[]|null} */
    let pending = null;
    const seam = color === 'k' ? '#6a6d78' : color === 'w' ? '#5d6777' : DYE[color][0];
    /** @param {number} l @param {number} [j] */
    function lv(l, j) {
      const t = l + (j === undefined ? 0.04 : j) * (rnd() * 2 - 1);
      return mood.lo + (mood.hi - mood.lo) * Math.max(0, Math.min(1, t));
    }
    /** @type {ArtKit} */
    const A = {
      rnd,
      r: (a, b) => a + (b - a) * rnd(),
      wood: (l, j) => ramp(WOOD, lv(l, j)),
      stone: (l, j) => { const t = lv(l, j); return mix(ramp(STONE, t), ramp(WOOD, t), 0.55); },
      raw: (l) => ramp(WOOD, l),
      dark: (l) => ramp(WOOD, color === 'k' ? 0.5 + l * 2.4 : l),
      pale: (l) => ramp(WOOD, color === 'w' ? l * 0.66 : l),
      dye: (i) => DYE[color][i],
      p(d, fill, g, sc, extra) {
        if (g === undefined) { gi = (gi + 1 + Math.floor(rnd() * 3)) % 6; g = gi; }
        out.push('<path d="' + d + '" fill="' + fill + '"' + (extra || '') + '/>');
        if (g >= 0) {
          if (pending) pending[g] += d;
          else out.push('<path d="' + d + '" fill="url(#ix-gr' + g + ')" stroke="none"' + soft + '/>');
        }
        if (sc) out.push('<path d="' + d + '" fill="url(#ix-' + (sc.charAt(0) === '+' ? 'li-' + sc.slice(1) : 'sc-' + sc) + ')" stroke="none"' + soft + '/>');
      },
      c(d, tone, g, sc) {
        /* 흰 물건은 결과 그을림을 옅게 얹어 흰빛을 지킨다 */
        if (color === 'w') soft = ' opacity=".42"';
        A.p(d, DYE[color][tone], g, sc, ' stroke="' + seam + '"');
        soft = '';
      },
      ov(d, id, dyed) { out.push('<path d="' + d + '" fill="url(#ix-' + id + ')" stroke="none"' + (dyed && color === 'w' ? ' opacity=".42"' : '') + '/>'); },
      batch(fn) {
        if (pending) { fn(); return; }
        pending = ['', '', '', '', '', ''];
        fn();
        const done = pending;
        pending = null;
        for (let i = 0; i < 6; i++) if (done[i]) out.push('<path d="' + done[i] + '" fill="url(#ix-gr' + i + ')" stroke="none"/>');
      },
      add(s) { out.push(s); },
      fine(fn) { out.push('<g class="ix-fine">'); fn(); out.push('</g>'); },
      color, mood, v: variant,
    };
    return { A, out };
  }

  /* ── 모양 도우미 ── */
  /** @param {number} x @param {number} y @param {number} w @param {number} hh */
  function rect(x, y, w, hh) { return poly([[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]]); }
  /** @param {number} cx @param {number} cy @param {number} rx @param {number} [ry] */
  function ell(cx, cy, rx, ry) {
    const b = ry === undefined ? rx : ry;
    return 'M' + f(cx - rx) + ' ' + f(cy) + 'A' + f(rx) + ' ' + f(b) + ' 0 1 0 ' + f(cx + rx) + ' ' + f(cy) + 'A' + f(rx) + ' ' + f(b) + ' 0 1 0 ' + f(cx - rx) + ' ' + f(cy) + 'Z';
  }
  /** 위가 반원인 아치 문 @param {number} x0 @param {number} x1 @param {number} ys 아치가 시작하는 높이 @param {number} yb 바닥 */
  function arch(x0, x1, ys, yb) {
    const r = (x1 - x0) / 2;
    return 'M' + f(x0) + ' ' + f(yb) + 'L' + f(x0) + ' ' + f(ys) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(x1) + ' ' + f(ys) + 'L' + f(x1) + ' ' + f(yb) + 'Z';
  }
  /** 물결치는 가로 선의 점들 @param {ArtKit} A @param {number} x0 @param {number} x1 @param {number} y @param {number} amp @param {number} n */
  function wavy(A, x0, x1, y, amp, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * i / n, y + (i === 0 || i === n ? 0 : A.r(-amp, amp))]);
    return pts;
  }
  /** 가는 선 @param {number[][]} pts @param {string} color @param {number} w */
  function line(pts, color, w) {
    return '<path d="M' + pts.map((p) => f(p[0]) + ' ' + f(p[1])).join('L') + '" fill="none" stroke="' + color + '" stroke-width="' + w + '" stroke-linecap="round"/>';
  }

  /** 하늘: 가로 띠 서너 장 + 해·달. @param {ArtKit} A @param {number} hy 지평선 높이 */
  function sky(A, hy) {
    const s = A.mood.sky;
    const n = 4;
    A.p(rect(0, 0, 100, hy + 2), A.raw(s[0]), -1);
    for (let i = 1; i < n; i++) {
      const y = 30 + (hy - 30) * (i / n) + A.r(-2, 2);
      const top = wavy(A, 0, 100, y, 2.2, 5);
      A.p(poly(top.concat([[100, hy + 2], [0, hy + 2]])), A.raw(s[0] + (s[1] - s[0]) * (i / (n - 1))), -1);
    }
    A.add('<path d="' + rect(0, 0, 100, hy + 2) + '" fill="url(#ix-gr0)" stroke="none"/>');
    const sx = A.r(18, 80), sy = A.r(42, hy - 12);
    if (A.mood.id === 'night') {
      A.p(ell(sx, sy, 5.2), A.raw(0.96), 2);
      A.p(ell(sx + 2.4, sy - 1.2, 4.4), A.raw(s[0] + 0.04), 0, '', ' stroke="none"');
      A.fine(() => {
        for (let i = 0; i < 7; i++) {
          const x = A.r(4, 96), y = A.r(38, hy - 8), q = A.r(0.5, 1);
          A.add('<path d="' + poly([[x, y - q], [x + q, y], [x, y + q], [x - q, y]]) + '" fill="' + A.raw(0.9) + '" stroke="none"/>');
        }
      });
    } else {
      A.add('<circle cx="' + f(sx) + '" cy="' + f(sy) + '" r="13" fill="url(#ix-halo-l)" stroke="none" opacity=".55"/>');
      A.p(ell(sx, sy, 5), A.raw(A.mood.id === 'dusk' ? 0.99 : 1), 4);
      A.fine(() => {
        const cx = (sx + 45) % 90 + 5, cy = A.r(42, hy - 14);
        A.p('M' + f(cx - 12) + ' ' + f(cy) + 'Q' + f(cx - 4) + ' ' + f(cy - 4) + ' ' + f(cx + 3) + ' ' + f(cy - 1.5) + 'Q' + f(cx + 10) + ' ' + f(cy - 3) + ' ' + f(cx + 14) + ' ' + f(cy) + 'Z',
          A.raw(Math.min(1, s[1] + 0.06)), 0);
      });
    }
  }

  /** 산줄기: 봉우리마다 볕 든 면과 그늘 면 두 조각 + 눈. @param {ArtKit} A @param {number} base @param {number[][]} peaks [x, y, 반폭] @param {number} l @param {boolean} snow */
  function mountains(A, base, peaks, l, snow) {
    for (const pk of peaks) {
      const x = pk[0], y = pk[1], w = pk[2];
      const ridge = x + w * 0.18;
      A.p(poly([[x - w, base], [x, y], [ridge, base]]), A.stone(l + 0.14), 2, 'b');
      A.p(poly([[x, y], [x + w * 1.1, base], [ridge, base]]), A.stone(l - 0.1), 3, 'b');
      if (snow) {
        const k = 0.34;
        A.p(poly([[x, y], [x - w * k, y + (base - y) * k], [x - w * k * 0.4, y + (base - y) * k * 0.72], [x + w * 0.06, y + (base - y) * k * 1.05],
          [x + w * k * 0.5, y + (base - y) * k * 0.7], [x + w * k * 1.1, y + (base - y) * k]]), A.raw(Math.min(1, A.mood.hi + 0.02)), 4);
      }
    }
  }

  /**
   * 들쭉날쭉한 격자로 넓은 면을 나무 조각들로 채운다(바위 벽·돌 바닥).
   * @param {ArtKit} A @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} nx @param {number} ny
   * @param {number} jit @param {(cx:number, cy:number) => string} fill @param {number} [split]
   */
  function tess(A, x0, y0, x1, y1, nx, ny, jit, fill, split) {
    /** @type {number[][][]} */
    const v = [];
    for (let j = 0; j <= ny; j++) {
      v.push([]);
      for (let i = 0; i <= nx; i++) {
        const edgeX = i === 0 || i === nx, edgeY = j === 0 || j === ny;
        v[j].push([x0 + (x1 - x0) * i / nx + (edgeX ? 0 : A.r(-jit, jit) * (x1 - x0) / nx),
          y0 + (y1 - y0) * j / ny + (edgeY ? 0 : A.r(-jit, jit) * (y1 - y0) / ny)]);
      }
    }
    A.batch(() => {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = v[j][i], b = v[j][i + 1], c = v[j + 1][i + 1], d = v[j + 1][i];
          const cx = (a[0] + c[0]) / 2, cy = (a[1] + c[1]) / 2;
          if (A.rnd() < (split === undefined ? 0.35 : split)) {
            if (A.rnd() < 0.5) { A.p(poly([a, b, d]), fill(cx - 2, cy - 2)); A.p(poly([b, c, d]), fill(cx + 2, cy + 2)); }
            else { A.p(poly([a, b, c]), fill(cx + 2, cy - 2)); A.p(poly([a, c, d]), fill(cx - 2, cy + 2)); }
          } else A.p(poly([a, b, c, d]), fill(cx, cy));
        }
      }
    });
  }

  /**
   * 원석 결정 무리(1단계에서 색을 맡는다). 밑동 (bx,by)에서 부채꼴로 자란 각기둥들.
   * @param {ArtKit} A @param {number} bx @param {number} by @param {number} sc @param {number} tilt @param {number} n @param {boolean} [noGlow]
   */
  function crystals(A, bx, by, sc, tilt, n, noGlow) {
    if (!noGlow) A.add('<circle cx="' + f(bx - 2 + tilt * 0.2) + '" cy="' + f(by - 22 * sc) + '" r="' + f(31 * sc) + '" fill="url(#ix-glow-' + A.color + ')" stroke="none"/>');
    const items = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      items.push({
        ang: tilt + t * 108 + A.r(-7, 7),
        len: (36 - Math.abs(t) * 30 + A.r(-4, 5)) * sc,
        wid: (8.2 - Math.abs(t) * 3.4 + A.r(-1, 1.8)) * sc,
        off: t * 13 * sc,
      });
    }
    items.sort((a, b) => b.len - a.len);
    let grain = '';
    for (const it of items) {
      const a = it.ang * Math.PI / 180;
      const ux = Math.sin(a), uy = -Math.cos(a), px = Math.cos(a), py = Math.sin(a);
      const cx = bx + it.off, hw = it.wid / 2;
      const k = hw * A.r(-0.3, 0.4);
      const sh = it.len * A.r(0.7, 0.8), sh2 = sh * A.r(0.9, 1.04);
      /** @param {number} q @param {number} t */
      const at = (q, t) => [cx + px * q + ux * t, by + py * q + uy * t];
      const bL = at(-hw, -2), bR = at(hw, -2), bM = at(k, -2);
      const sL = at(-hw, sh), sR = at(hw, sh2), sM = at(k, sh * 1.03), tip = at(k * 0.5, it.len);
      const d1 = poly([bL, sL, sM, bM]), d2 = poly([bM, sM, sR, bR]);
      A.c(d1, 3, -1);
      A.c(d2, 1, -1);
      A.c(poly([sL, tip, sM]), 4, -1);
      A.c(poly([sM, tip, sR]), 2, -1);
      /* 밑동 쪽 그을림은 결정마다, 결 무늬는 무리 전체를 한 번에 */
      A.ov(d1 + d2, 'sc-b', true);
      grain += d1 + d2;
    }
    A.ov(grain, 'gr1', true);
  }

  /** 결정 밑동을 덮는 바위 몇 덩이 @param {ArtKit} A @param {number} bx @param {number} by @param {number} w @param {number} l */
  function rubble(A, bx, by, w, l) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const x = bx - w / 2 + w * i / (n - 1) + A.r(-2, 2), s = A.r(4, 7);
      A.p(poly([[x - s, by + 3], [x - s * 0.6, by - s * 0.5], [x + s * 0.2, by - s * 0.85], [x + s, by - s * 0.2], [x + s * 1.1, by + 3]]), A.stone(l + A.r(-0.12, 0.12)), undefined, 'b');
    }
  }

  /* ── 1단계: 캐는 곳 ── */

  /** 배경을 좌우로 뒤집어 그린다(변주용). 색을 맡은 물건은 뒤집지 않고 늘 오른쪽에 둔다. @param {ArtKit} A @param {boolean} on @param {() => void} fn */
  function mirrored(A, on, fn) {
    if (on) A.add('<g transform="translate(100 0) scale(-1 1)">');
    fn();
    if (on) A.add('</g>');
  }

  /** 갱도 입구: 나무 버팀목이 겹겹이 물러나는 굴 @param {ArtKit} A */
  function sceneGallery(A) {
    mirrored(A, A.v % 2 === 1, () => {
      tess(A, 0, 0, 100, 104, 4, 4, 0.3, (cx, cy) => A.stone(0.36 + cy / 420 + (cx > 50 ? 0.08 : 0), 0.09));
      const ox = A.r(8, 16), w = 36, top = 50, bot = 104;
      const vx = ox + w * 0.55, vy = top + 30;
      A.p(poly([[ox + 3, bot], [ox + 4, top + 3], [ox + w - 4, top + 3], [ox + w - 3, bot]]), A.dark(0.03), -1);
      for (let i = 2; i >= 0; i--) {
        const k = 1 - i * 0.27;
        /** @param {number} x @param {number} y */
        const q = (x, y) => [vx + (x - vx) * k, vy + (y - vy) * k];
        const lit = 0.66 - i * 0.18;
        if (i > 0) A.p(poly([q(ox + 4, bot), q(ox + 5, top + 3), q(ox + w - 5, top + 3), q(ox + w - 4, bot)]), A.dark(0.07 - i * 0.02), -1);
        A.p(poly([q(ox, bot), q(ox + 1.2, top + 2), q(ox + 6, top + 2), q(ox + 5.5, bot)]), A.wood(lit), 1, 'r');
        A.p(poly([q(ox + w - 5.5, bot), q(ox + w - 6, top + 2), q(ox + w - 1.2, top + 2), q(ox + w, bot)]), A.wood(lit - 0.1), 1, 'l');
        A.p(poly([q(ox - 3, top - 3), q(ox + w + 3, top - 3), q(ox + w + 2, top + 3.5), q(ox - 2, top + 3.5)]), A.wood(lit + 0.08), 0, 'b');
      }
      tess(A, 0, 104, 100, 140, 3, 2, 0.25, (cx, cy) => A.wood(0.34 + cy / 900, 0.07), 0.2);
      /* 레일과 침목 */
      const rl = [[vx - 3, vy + 14], [ox - 4, 140]], rr = [[vx + 3, vy + 14], [ox + w + 2, 140]];
      A.fine(() => {
        for (let i = 0; i < 4; i++) {
          const t = 0.45 + i * 0.16, t2 = t + 0.045;
          /** @param {number[][]} L @param {number} u */
          const on = (L, u) => [L[0][0] + (L[1][0] - L[0][0]) * u, L[0][1] + (L[1][1] - L[0][1]) * u];
          const a = on(rl, t), b = on(rr, t), c = on(rr, t2), d = on(rl, t2);
          A.p(poly([[a[0] - 2, a[1]], [b[0] + 2, b[1]], [c[0] + 2, c[1]], [d[0] - 2, d[1]]]), A.wood(0.5), 0);
        }
        A.add(line(rl, A.stone(0.8), 0.8) + line(rr, A.stone(0.8), 0.8));
        const lx = ox + w * 0.32;
        A.add('<circle cx="' + f(lx) + '" cy="' + f(top + 12) + '" r="9" fill="url(#ix-halo-l)" stroke="none" opacity=".7"/>');
        A.add(line([[lx, top + 3], [lx, top + 9]], A.raw(0.1), 0.6));
        A.p(poly([[lx, top + 8.5], [lx + 2.4, top + 12], [lx, top + 15.5], [lx - 2.4, top + 12]]), A.pale(1), -1);
      });
    });
    const bx = A.r(68, 73), by = A.r(101, 106);
    crystals(A, bx, by, 1.16, A.r(-12, 4), 6);
    if (A.v % 2 === 0) crystals(A, 92, 62, 0.44, -62, 3, true);
    rubble(A, bx, by, 34, 0.42);
  }

  /** 광석 수레: 굴 안 레일 위 수레에 원석이 실려 있다 @param {ArtKit} A */
  function sceneCart(A) {
    tess(A, 0, 0, 100, 98, 4, 4, 0.3, (cx, cy) => A.stone(0.3 + cy / 380, 0.09));
    /* 굴 안쪽: 둥근 천장으로 물러나는 어둠과 버팀목 */
    const ax = A.v % 2 ? 27 : 34;
    A.p(arch(ax - 22, ax + 22, 64, 98), A.dark(0.06), -1);
    A.p(arch(ax - 13, ax + 13, 68, 98), A.dark(0.025), -1);
    A.p(poly([[ax - 25, 98], [ax - 24, 58], [ax - 19, 58], [ax - 19.5, 98]]), A.wood(0.56), 1, 'r');
    A.p(poly([[ax + 19.5, 98], [ax + 19, 58], [ax + 24, 58], [ax + 25, 98]]), A.wood(0.44), 1, 'l');
    A.p(poly([[ax - 28, 52], [ax + 28, 52], [ax + 27, 59], [ax - 27, 59]]), A.wood(0.66), 0, 'b');
    tess(A, 0, 98, 100, 140, 3, 2, 0.25, (cx, cy) => A.wood(0.32 + cy / 900, 0.07), 0.2);
    const rl = [[ax - 5, 98], [ax - 30, 140]], rr = [[ax + 5, 98], [ax + 16, 140]];
    A.fine(() => A.add(line(rl, A.stone(0.8), 0.8) + line(rr, A.stone(0.8), 0.8)));
    /* 수레 */
    const cx = ax - 3, cy = A.v % 2 ? 86 : 90;
    A.p(poly([[cx - 15, cy - 13], [cx + 15, cy - 13], [cx + 11.5, cy + 6], [cx - 11.5, cy + 6]]), A.wood(0.52), 1, 'b');
    A.fine(() => {
      for (let i = -1; i <= 1; i++) A.add(line([[cx + i * 7, cy - 12], [cx + i * 5.6, cy + 5.5]], A.raw(0.1), 0.5));
    });
    A.p(poly([[cx - 16.5, cy - 15.5], [cx + 16.5, cy - 15.5], [cx + 15.8, cy - 12], [cx - 15.8, cy - 12]]), A.stone(0.2), 0);
    A.p(ell(cx - 8, cy + 8, 4.6), A.stone(0.16), 4);
    A.p(ell(cx + 8, cy + 8, 4.6), A.stone(0.16), 5);
    A.add('<circle cx="' + f(cx - 8) + '" cy="' + f(cy + 8) + '" r="1.5" fill="' + A.stone(0.8) + '"/><circle cx="' + f(cx + 8) + '" cy="' + f(cy + 8) + '" r="1.5" fill="' + A.stone(0.8) + '"/>');
    /* 수레에 실린 원석 */
    crystals(A, cx - 2, cy - 14, 0.4, 4, 4, true);
    A.p(poly([[cx - 13, cy - 15], [cx - 9, cy - 19], [cx - 4, cy - 15]]), A.stone(0.5), undefined);
    A.p(poly([[cx + 4, cy - 15], [cx + 9, cy - 19.5], [cx + 13.5, cy - 15]]), A.stone(0.38), undefined);
    const bx = A.r(70, 75), by = A.r(101, 106);
    crystals(A, bx, by, 1.14, A.r(-8, 6), 6);
    rubble(A, bx, by, 34, 0.4);
  }

  /** 절벽과 설산: 바깥 절벽 턱에서 자란 결정, 멀리 눈 덮인 산과 권양기 @param {ArtKit} A */
  function sceneCliff(A) {
    const flip = A.v % 2 === 1;
    const snow = A.mood.id !== 'dusk';
    mirrored(A, flip, () => {
      sky(A, 92);
      mountains(A, 96, [[A.r(8, 22), A.r(48, 58), 26], [A.r(40, 52), A.r(56, 64), 22], [A.r(70, 82), A.r(44, 52), 24]], 0.5, snow);
      mountains(A, 100, [[A.r(-4, 6), 72, 22], [A.r(28, 40), 78, 20]], 0.34, false);
      /* 절벽 */
      const edge = [[62, 36], [56, 52], [60, 66], [52, 80], [54, 96], [44, 108], [40, 140]];
      for (let i = 0; i < edge.length - 1; i++) {
        const a = edge[i], b = edge[i + 1];
        const mx = 82 + A.r(-6, 6);
        A.p(poly([a, [mx, a[1] + A.r(-2, 2)], [mx + A.r(-3, 3), b[1]], b]), A.stone(0.52 - i * 0.03, 0.06), undefined, 'r');
        A.p(poly([[mx, a[1] - 2], [100, a[1] - 2], [100, b[1] + 2], [mx, b[1] + 2]]), A.stone(0.38 - i * 0.02, 0.06), undefined);
      }
      /* 권양기: 삼각대와 두레박 */
      A.fine(() => {
        const wx = A.r(14, 24);
        A.add(line([[wx - 9, 106], [wx, 72]], A.wood(0.3), 1.4) + line([[wx + 9, 106], [wx, 72]], A.wood(0.22), 1.4) + line([[wx + 1, 104], [wx, 72]], A.wood(0.4), 1.2));
        A.add(line([[wx, 74], [wx, 92]], A.raw(0.08), 0.5));
        A.p(poly([[wx - 3, 92], [wx + 3, 92], [wx + 2.2, 98], [wx - 2.2, 98]]), A.wood(0.56), 1);
      });
    });
    /* 앞 비탈과 눈 */
    A.p(poly([[0, 104], [20, 100], [46, 106], [100, 100], [100, 140], [0, 140]]), snow ? A.raw(Math.min(1, A.mood.hi + 0.04)) : A.wood(0.56), 0, 'b');
    A.p(poly([[0, 120], [24, 113], [50, 122], [100, 114], [100, 140], [0, 140]]), A.wood(0.36), 3, 'b');
    const bx = A.r(66, 71), by = A.r(104, 109);
    crystals(A, bx, by, 1.16, flip ? A.r(-4, 10) : A.r(-18, -6), 6);
    if (!flip) crystals(A, 87, 60, 0.42, -70, 3, true);
    rubble(A, bx, by, 32, 0.46);
  }

  /** 종유굴: 고드름 돌과 고인 물, 물에 비친 결정 @param {ArtKit} A */
  function sceneCavern(A) {
    mirrored(A, A.v % 2 === 1, () => {
      tess(A, 0, 0, 100, 96, 4, 3, 0.3, (cx, cy) => A.stone(0.22 + cy / 300, 0.08));
      /* 바깥으로 뚫린 구멍 */
      const hx = A.r(16, 26), hy = 62;
      A.p(poly([[hx - 12, hy + 12], [hx - 14, hy - 4], [hx - 6, hy - 14], [hx + 6, hy - 15], [hx + 14, hy - 5], [hx + 12, hy + 12]]), A.pale(Math.max(0.6, A.mood.sky[1])), 0);
      A.p(poly([[hx - 12, hy + 12], [hx - 4, hy], [hx + 3, hy + 6], [hx + 9, hy + 1], [hx + 12, hy + 12]]), A.stone(0.62), 2);
      /* 종유석 */
      const n = 6;
      for (let i = 0; i < n; i++) {
        const x = 6 + i * 17 + A.r(-4, 4), len = A.r(14, 30), w = A.r(4, 7);
        A.p(poly([[x - w, 30], [x + w * 0.2, 30], [x + 0.6, 34 + len]]), A.stone(0.5), 1, 't');
        A.p(poly([[x + w * 0.2, 30], [x + w, 30], [x + 0.6, 34 + len]]), A.stone(0.3), 1, 't');
      }
      /* 석순 */
      A.p(poly([[30, 100], [35, 76], [41, 100]]), A.stone(0.42), 1, 'b');
    });
    /* 고인 물: 가로 띠 */
    for (let i = 0; i < 4; i++) {
      const y = 96 + i * 11;
      A.p(poly(wavy(A, 0, 100, y, 1.4, 5).concat([[100, 140], [0, 140]])), A.stone(0.44 - i * 0.07), -1);
    }
    A.add('<path d="' + rect(0, 94.5, 100, 46) + '" fill="url(#ix-gr0)" stroke="none"/>');
    const bx = A.r(66, 72), by = 102;
    /* 물에 비친 모습 */
    A.fine(() => {
      for (let i = 0; i < 4; i++) {
        const x = bx - 12 + i * 8 + A.r(-2, 2), len = A.r(8, 20);
        A.c(poly([[x - 2.6, by + 5], [x + 2.6, by + 5], [x + 1, by + 5 + len], [x - 0.6, by + 5 + len * 0.8]]), 1, 0);
      }
    });
    crystals(A, bx, by, 1.16, A.r(-8, 8), 6);
    rubble(A, bx, by, 34, 0.36);
  }

  /* ── 2단계: 옮기고 다듬는 곳 — 염색한 천이 색을 맡는다 ── */

  /** 바다: 물결 띠 @param {ArtKit} A @param {number} y0 @param {number} n */
  function sea(A, y0, n) {
    const step = (140 - y0) / n;
    for (let i = 0; i < n; i++) {
      A.p(poly(wavy(A, 0, 100, y0 + i * step, 1.3, 6).concat([[100, 140], [0, 140]])), A.stone(0.56 - i * 0.07 + (i % 2) * 0.05), -1, i === 0 ? 't' : '');
    }
    A.add('<path d="' + rect(0, y0 - 1.5, 100, 142 - y0) + '" fill="url(#ix-gr0)" stroke="none"/>');
  }

  /**
   * 바람 받은 네모 돛: 세로 폭 몇 장을 이어 붙인 천(폭마다 농담이 다르다).
   * @param {ArtKit} A @param {number} cx @param {number} y0 @param {number} y1 @param {number} w0 @param {number} w1 @param {number} n
   */
  function sail(A, cx, y0, y1, w0, w1, n) {
    const tones = [3, 2, 2, 1];
    for (let k = 0; k < n; k++) {
      const u0 = k / n, u1 = (k + 1) / n;
      /** @param {number} u @param {number} w */
      const xa = (u, w) => cx - w + 2 * w * u;
      const bulge = (/** @type {number} */ u) => Math.sin(Math.PI * u) * (y1 - y0) * 0.16;
      A.c(poly([[xa(u0, w0), y0], [xa(u1, w0), y0], [xa(u1, w1) + 0, y1 + bulge(u1)], [xa(u0, w1), y1 + bulge(u0)]]), tones[Math.min(3, Math.round(k * 3 / Math.max(1, n - 1)))], 1, k === n - 1 ? 'r' : k === 0 ? '+l' : '');
    }
    A.add(line([[cx - w0 - 1.5, y0 - 0.4], [cx + w0 + 1.5, y0 - 0.4]], A.raw(0.1), 1));
  }

  /** 범선과 항구 @param {ArtKit} A */
  function sceneShip(A) {
    const hy = 96;
    sky(A, hy);
    mirrored(A, A.v % 2 === 1, () => {
      /* 먼 언덕과 등대, 부두 */
      A.p(poly([[58, hy], [72, hy - 9], [86, hy - 5], [100, hy - 11], [100, hy]]), A.stone(0.5), 0);
      A.p(poly([[0, hy - 5], [24, hy - 5], [28, hy], [0, hy]]), A.stone(0.42), 0);
      A.p(poly([[7, hy - 5], [8.4, hy - 30], [14.6, hy - 30], [16, hy - 5]]), A.stone(0.66), 1, 'r');
      A.p(poly([[6.6, hy - 30], [16.4, hy - 30], [15.2, hy - 34], [7.8, hy - 34]]), A.wood(0.4), 0);
      A.p(poly([[8.4, hy - 34], [14.6, hy - 34], [11.5, hy - 41]]), A.wood(0.28), 2);
      A.fine(() => A.add('<rect x="10.3" y="' + (hy - 27) + '" width="2.4" height="4" fill="' + A.raw(0.05) + '"/>'));
    });
    sea(A, hy, 5);
    const sx = A.r(58, 63), wl = hy + 7;
    /* 선체: 뒤쪽(오른쪽)에 선미루 */
    A.p('M' + f(sx - 31) + ' ' + f(wl - 11) + 'L' + f(sx - 23) + ' ' + f(wl - 12) + 'L' + f(sx + 17) + ' ' + f(wl - 12) + 'L' + f(sx + 18) + ' ' + f(wl - 20) + 'L' + f(sx + 32) + ' ' + f(wl - 21) +
      'L' + f(sx + 29) + ' ' + f(wl - 2) + 'Q' + f(sx) + ' ' + f(wl + 5) + ' ' + f(sx - 25) + ' ' + f(wl - 1) + 'Z', A.wood(0.3), 0, 'b');
    A.p(poly([[sx - 29, wl - 9.5], [sx + 31, wl - 15], [sx + 30.5, wl - 11.5], [sx - 27.5, wl - 6.5]]), A.wood(0.62), 0);
    A.p(poly([[sx - 31, wl - 11], [sx - 22, wl - 17], [sx - 19, wl - 12]]), A.wood(0.42), 2);
    A.add(line([[sx - 27, wl - 14], [sx - 41, wl - 23]], A.wood(0.2), 1.1));
    if (A.v % 2 === 0) {
      /* 네모 돛 세 대박이 */
      A.p(rect(sx - 0.9, 39, 1.8, wl - 12 - 39), A.wood(0.24), 1);
      A.p(rect(sx - 18.7, 56, 1.5, wl - 12 - 56), A.wood(0.24), 1);
      A.p(rect(sx + 23.3, 60, 1.4, wl - 20 - 60), A.wood(0.24), 1);
      sail(A, sx, 42, 55, 9.5, 12, 3);
      sail(A, sx, 58.5, 82, 13.5, 15.5, 4);
      sail(A, sx - 18, 61, 80, 7, 8.2, 2);
      A.c(poly([[sx + 16, 64], [sx + 31.5, 83], [sx + 22, 85.5]]), 2, 3, 'b');
      A.add(line([[sx + 14.5, 62], [sx + 33, 85]], A.raw(0.1), 0.9));
    } else {
      /* 세모 돛(라틴 돛) 두 대박이 */
      A.p(rect(sx - 4.9, 46, 1.8, wl - 12 - 46), A.wood(0.24), 1);
      A.p(rect(sx + 20.3, 58, 1.4, wl - 20 - 58), A.wood(0.24), 1);
      const pk = [sx + 7, 40], a0 = [sx - 24, 80], a1 = [sx + 9, 84];
      for (let k = 0; k < 3; k++) {
        const u0 = k / 3, u1 = (k + 1) / 3, bl = (/** @type {number} */ u) => Math.sin(Math.PI * u) * 3;
        A.c(poly([pk, [a0[0] + (a1[0] - a0[0]) * u0, a0[1] + (a1[1] - a0[1]) * u0 + bl(u0)], [a0[0] + (a1[0] - a0[0]) * u1, a0[1] + (a1[1] - a0[1]) * u1 + bl(u1)]]), [3, 2, 1][k], 2, 'b');
      }
      A.add(line([[sx - 26, 82], [sx + 9, 37.5]], A.raw(0.1), 1));
      A.c(poly([[sx + 30, 54], [sx + 13, 80], [sx + 24, 82.5]]), 2, 3, 'b');
      A.c(poly([[sx + 30, 54], [sx + 24, 82.5], [sx + 33, 83.5]]), 1, 3, 'b');
      A.add(line([[sx + 11.5, 82], [sx + 31.4, 51.6]], A.raw(0.1), 0.9));
    }
    A.c(poly([[sx + 0.9, 39.4], [sx + 11, 38], [sx + 5.5, 41.2], [sx + 11, 44.4], [sx + 0.9, 43]]), 2, -1);
    A.fine(() => {
      const ink = A.raw(A.mood.id === 'night' ? 0.5 : 0.12);
      A.add(line([[sx, 40], [sx - 28, wl - 13]], ink, 0.35) + line([[sx, 40], [sx + 30, wl - 21]], ink, 0.35) + line([[sx - 18, 56], [sx - 38, wl - 21]], ink, 0.35));
      /* 물에 비친 돛 */
      for (let i = 0; i < 4; i++) {
        const x = sx - 12 + i * 7 + A.r(-1.5, 1.5), y = wl + 8 + i % 2 * 5 + A.r(0, 3);
        A.c(poly([[x - 5, y], [x + 5, y - 0.6], [x + 3.6, y + 1.8], [x - 3.8, y + 2]]), 1, 0);
      }
    });
  }

  /** 부두의 짐꾸러미: 염색한 천으로 싸서 밧줄로 묶은 짐 @param {ArtKit} A */
  function sceneBales(A) {
    sky(A, 74);
    mirrored(A, A.v % 2 === 1, () => {
      /* 먼 방파제와 기중기(디딤바퀴식) */
      A.p(poly([[0, 66], [100, 64], [100, 76], [0, 76]]), A.stone(0.46), 0, 'b');
      A.fine(() => { for (let i = 0; i < 9; i++) A.p(rect(2 + i * 11.5, 62.4 + (i % 2) * 0.5, 5, 3.4), A.stone(0.46), 0); });
      const kx = A.r(12, 20);
      A.p(poly([[kx - 3, 66], [kx - 2, 44], [kx + 2, 44], [kx + 3, 66]]), A.wood(0.34), 1);
      A.p(poly([[kx - 6, 50], [kx + 7, 50], [kx + 6, 60], [kx - 5, 60]]), A.wood(0.5), 0, 'b');
      A.add(line([[kx, 45], [kx + 20, 39]], A.wood(0.22), 1.3) + line([[kx + 19.5, 39.5], [kx + 19.5, 56]], A.raw(0.1), 0.4));
      A.p(poly([[kx + 17.5, 56], [kx + 21.5, 56], [kx + 21, 60], [kx + 18, 60]]), A.wood(0.5), -1);
    });
    A.p(rect(0, 74, 100, 9), A.stone(0.56), 0, 't');
    /* 부두 돌바닥 */
    tess(A, 0, 82, 100, 140, 4, 3, 0.16, (cx, cy) => A.stone(0.52 - (cy - 82) / 260, 0.07), 0.1);
    /* 뒤쪽 통 */
    const bx = A.v % 2 ? 84 : 18;
    for (let i = 0; i < 4; i++) {
      const x0 = bx - 9 + i * 4.5, bow = (i === 0 || i === 3) ? 1.2 : 0;
      A.p(poly([[x0 + bow, 62], [x0 + 4.5 - (i === 3 ? bow : 0), 62], [x0 + 4.5 + (i === 3 ? 1 : 0), 76], [x0 + 4.5 - (i === 3 ? bow : 0), 90], [x0 + bow, 90], [x0 - (i === 0 ? 1 : 0), 76]]), A.wood(0.42 + (i % 2) * 0.12), 1);
    }
    A.p(rect(bx - 9.6, 66, 19.2, 2.2), A.raw(0.12), 0);
    A.p(rect(bx - 9.6, 84, 19.2, 2.2), A.raw(0.12), 0);
    /* 짐꾸러미(색): 변주에 따라 큰 것 하나, 또는 두 개를 포개서 */
    let y1;
    if (A.v % 2 === 0) {
      const x0 = A.r(40, 44), y0 = A.r(70, 74);
      y1 = y0 + A.r(38, 42);
      bale(A, x0, x0 + A.r(42, 46), y0, y1, 8);
    } else {
      const x0 = A.r(38, 42), y0 = A.r(88, 91);
      y1 = y0 + A.r(24, 27);
      bale(A, x0, x0 + A.r(46, 50), y0, y1, 8);
      const x2 = x0 + A.r(7, 12);
      bale(A, x2, x2 + A.r(28, 32), y0 - A.r(27, 30), y0 - 7.4, 7);
    }
    const rope = A.raw(0.86);
    /* 앞에 누운 천 두루마리(색) */
    const ry = y1 + A.r(9, 13);
    A.c(poly([[56, ry - 4], [93, ry - 8], [95, ry + 2.5], [58, ry + 7]]), 2, 0, 'b');
    A.c(ell(57, ry + 1.5, 3.6, 5.6), 3, -1);
    A.fine(() => {
      A.add('<ellipse cx="57" cy="' + f(ry + 1.5) + '" rx="1.6" ry="2.6" fill="none" stroke="' + A.dye(0) + '" stroke-width=".5"/>');
      A.add(line([[70, ry - 5.4], [71.4, ry + 5.2]], rope, 1.1) + line([[84, ry - 6.8], [85.4, ry + 3.6]], rope, 1.1));
    });
  }

  /** 염색한 천으로 싸서 밧줄로 묶은 짐: 앞면 두 폭·윗면·옆면 @param {ArtKit} A @param {number} x0 @param {number} x1 @param {number} y0 @param {number} y1 @param {number} dx */
  function bale(A, x0, x1, y0, y1, dx) {
    const dy = -dx;
    const xm = x0 + (x1 - x0) * A.r(0.42, 0.56);
    A.add('<ellipse cx="' + f((x0 + x1) / 2 + 6) + '" cy="' + f(y1 + 1) + '" rx="' + f((x1 - x0) * 0.62) + '" ry="4.6" fill="#000" opacity=".32" stroke="none"/>');
    A.c(poly([[x0, y0], [x1, y0 - 1.5], [x1 + dx, y0 + dy - 1.5], [x0 + dx + 1, y0 + dy]]), 3, 0, 'b');
    A.c(poly([[x1, y0 - 1.5], [x1 + dx, y0 + dy - 1.5], [x1 + dx + 1, y1 + dy - 2], [x1 + 1.5, y1 - 2]]), 1, 1, 'b');
    A.c(poly([[x0, y0], [xm, y0 - 0.7], [xm + 1, y1 + 1], [x0 + 1.5, y1 + 2.5]]), 2, 1, 'l');
    A.c(poly([[xm, y0 - 0.7], [x1, y0 - 1.5], [x1 + 1.5, y1 - 2], [xm + 1, y1 + 1]]), 2, 4, 'r');
    const rope = A.raw(0.86), ym = y0 + (y1 - y0) * 0.5;
    A.p(poly([[x0 + 0.6, ym - 1.5], [x1 + 0.8, ym - 3.2], [x1 + dx + 0.6, ym + dy - 3.2], [x1 + dx + 0.7, ym + dy - 0.6], [x1 + 0.9, ym - 0.6], [x0 + 0.7, ym + 1.1]]), rope, -1);
    A.p(poly([[xm - 1.2, y0 - 0.7], [xm + dx - 1, y0 + dy - 0.8], [xm + dx + 1.6, y0 + dy - 0.9], [xm + 1.4, y0 - 0.8], [xm + 2.4, y1 + 0.8], [xm - 0.3, y1 + 1.2]]), rope, -1);
    A.p(ell(xm + 0.8, ym - 1.3, 2.1), A.raw(0.7), -1);
  }

  /** 깎은 돌 하나(작은 보석): 면 넷 @param {ArtKit} A @param {number} x @param {number} y @param {number} s */
  function stone(A, x, y, s) {
    A.c(poly([[x - s, y], [x - s * 0.4, y - s * 0.75], [x, y - s * 0.1], [x - s * 0.3, y + s * 0.6]]), 3, -1);
    A.c(poly([[x - s * 0.4, y - s * 0.75], [x + s * 0.5, y - s * 0.7], [x, y - s * 0.1]]), 4, -1);
    A.c(poly([[x + s * 0.5, y - s * 0.7], [x + s, y + s * 0.05], [x + s * 0.35, y + s * 0.65], [x, y - s * 0.1]]), 2, -1);
    A.c(poly([[x - s * 0.3, y + s * 0.6], [x, y - s * 0.1], [x + s * 0.35, y + s * 0.65]]), 1, -1);
  }

  /** 세공 작업대: 돌림 숫돌·확대경·벨벳 깔개 위의 깎다 만 원석 @param {ArtKit} A */
  function sceneBench(A) {
    /* 널빤지 벽 */
    for (let i = 0; i < 5; i++) A.p(rect(i * 20, 0, 20, 90), A.wood(0.4 + (i % 2) * 0.08, 0.06), 1, i % 2 ? '' : 'b');
    mirrored(A, A.v % 2 === 1, () => {
      /* 아치 창 */
      const wx = A.r(8, 12);
      A.p(arch(wx - 2.5, wx + 26.5, 56, 86), A.stone(0.74), 0);
      A.p(arch(wx, wx + 24, 56, 84), A.pale(Math.max(0.55, A.mood.sky[1])), 0);
      A.p(poly([[wx, 84], [wx + 8, 74], [wx + 16, 79], [wx + 24, 71], [wx + 24, 84]]), A.stone(0.5), 2);
      A.add(line([[wx + 12, 44], [wx + 12, 84]], A.raw(0.12), 1) + line([[wx, 64], [wx + 24, 64]], A.raw(0.12), 1));
      /* 선반과 단지 */
      A.p(rect(54, 54, 44, 2.6), A.wood(0.7), 0, 'b');
      A.fine(() => {
        A.p(poly([[58, 54], [59, 45], [64, 45], [65, 54]]), A.stone(0.6), 1);
        A.p(rect(68, 47.5, 8, 6.5), A.wood(0.28), 0);
        A.p(poly([[80, 54], [80, 46], [82, 43.5], [85, 43.5], [87, 46], [87, 54]]), A.stone(0.42), 1);
        A.p(rect(90, 49, 6, 5), A.wood(0.6), 0);
      });
    });
    /* 작업대 */
    A.p(poly([[4, 88], [96, 88], [104, 120], [-4, 120]]), A.wood(0.66), 0, 'b');
    A.p(rect(0, 120, 100, 20), A.wood(0.34), 0, 't');
    /* 돌림 숫돌 */
    const gx = 23, gy = 82;
    A.p(poly([[gx - 3, gy], [gx - 12, 104], [gx - 8, 104], [gx, gy + 6]]), A.wood(0.3), 1);
    A.p(poly([[gx + 3, gy], [gx + 12, 104], [gx + 8, 104], [gx, gy + 6]]), A.wood(0.24), 1);
    A.p(ell(gx, gy, 12.5, 13.5), A.stone(0.72), 2, 'br');
    A.p(ell(gx, gy, 3, 3.2), A.wood(0.3), -1);
    A.fine(() => {
      A.add('<ellipse cx="' + gx + '" cy="' + gy + '" rx="8.4" ry="9" fill="none" stroke="' + A.raw(0.3) + '" stroke-width=".4"/>');
      A.add(line([[gx, gy], [gx + 9, gy - 13]], A.raw(0.12), 1) + line([[gx + 9, gy - 13], [gx + 14, gy - 13]], A.raw(0.12), 1.4));
    });
    /* 벨벳 깔개(색) */
    const mx0 = 40, mx1 = 92;
    A.c(poly([[mx0 + 3, 93], [mx1, 93], [mx1 + 5, 115], [mx0 - 1, 115]]), 2, 0, 'b');
    A.c(poly([[mx0 + 3, 93], [mx1, 93], [mx1 + 0.8, 96.4], [mx0 + 2.4, 96.4]]), 3, 0);
    A.c(poly([[mx0 - 1, 115], [mx1 + 5, 115], [mx1 + 5.6, 118.4], [mx0 - 1.6, 118.4]]), 1, 0);
    /* 깎다 만 원석과 작은 돌들 */
    const sx = A.r(62, 70);
    A.add('<ellipse cx="' + f(sx + 2) + '" cy="109" rx="11" ry="2.6" fill="#000" opacity=".35" stroke="none"/>');
    stone(A, sx, 102, 9.5);
    A.add('<circle cx="' + f(sx) + '" cy="99" r="16" fill="url(#ix-glow-' + A.color + ')" stroke="none" opacity=".5"/>');
    stone(A, sx + 17, 108, 3.6);
    stone(A, sx - 15, 110, 3);
    stone(A, sx + 21, 100, 2.6);
    /* 확대경 */
    A.fine(() => {
      A.add(line([[86, 121], [94, 129]], A.wood(0.3), 2));
      A.add('<circle cx="82" cy="117" r="5.4" fill="' + A.raw(0.96) + '" fill-opacity=".35" stroke="' + A.raw(0.82) + '" stroke-width="1.5"/>');
    });
  }

  /** 상인의 천칭: 접시에 얹은 보석, 탁자를 덮은 염색 천 @param {ArtKit} A */
  function sceneScales(A) {
    /* 징두리 판벽 */
    A.p(rect(0, 0, 100, 100), A.wood(0.46), 1);
    for (let i = 0; i < 3; i++) {
      const x = 3 + i * 32.5;
      A.p(rect(x, 43, 29, 50), A.wood(0.36), 1, 'o');
      A.p(rect(x + 4, 47, 21, 42), A.wood(0.54), i % 2 ? 2 : 3, 'tl');
    }
    A.p(rect(0, 92, 100, 4), A.wood(0.66), 0, 'b');
    /* 탁자와 덮개 천(색) */
    A.p(poly([[0, 97], [100, 97], [100, 107], [0, 107]]), A.wood(0.62), 0, 'b');
    A.p(rect(0, 107, 100, 33), A.wood(0.3), 1, 't');
    const cx0 = A.v % 2 ? 40 : 46;
    A.c(poly([[cx0 + 3, 96.6], [100, 96.6], [100, 107], [cx0, 107]]), 3, 0);
    const nf = 5, fw = (100 - cx0) / nf;
    for (let i = 0; i < nf; i++) {
      const a = cx0 + i * fw, b = a + fw;
      A.c(poly([[a, 107], [b, 107], [b + (i % 2 ? -1 : 1.4), 140], [a + (i % 2 ? 1.4 : -1), 140]]), i % 2 ? 1 : 2, 1, i % 2 ? 'l' : 'r');
    }
    A.fine(() => A.add(line([[cx0, 130], [100, 130]], A.dye(4), 0.9) + line([[cx0, 132.4], [100, 132.4]], A.dye(0), 0.5)));
    /* 천칭 */
    const bx = 63, brass = A.raw(0.8), brass2 = A.raw(0.62), tilt = A.r(-3.5, 3.5);
    A.p(poly([[bx - 9, 97], [bx + 9, 97], [bx + 5.5, 91.5], [bx - 5.5, 91.5]]), brass2, 0, 'b');
    A.p(rect(bx - 1.3, 52, 2.6, 40), brass, 1, 'r');
    A.p(ell(bx, 50, 2.8), brass, -1);
    A.p(bar(bx - 25, 56 + tilt, bx + 25, 56 - tilt, 2), brass, 0);
    for (const s of [-1, 1]) {
      const ex = bx + s * 25, ey = 56 - s * tilt, py = 82 - s * tilt * 1.6;
      A.add(line([[ex, ey], [ex - 9, py]], A.raw(0.14), 0.4) + line([[ex, ey], [ex + 9, py]], A.raw(0.14), 0.4));
      A.p('M' + f(ex - 10.5) + ' ' + f(py) + 'L' + f(ex + 10.5) + ' ' + f(py) + 'Q' + f(ex) + ' ' + f(py + 8.5) + ' ' + f(ex - 10.5) + ' ' + f(py) + 'Z', brass, 0, 'b');
      if (s > 0) { stone(A, ex - 3.5, py - 2.6, 3.4); stone(A, ex + 3.6, py - 2.2, 3); stone(A, ex + 0.2, py - 6, 2.8); }
      else { A.p(rect(ex - 5, py - 5.5, 4.6, 5.5), A.stone(0.3), 1); A.p(rect(ex + 0.6, py - 4, 3.6, 4), A.stone(0.42), 1); }
    }
    /* 탁자 위: 겹 추, 낱알 보석 */
    A.p(rect(9, 91, 9, 6), A.stone(0.34), 1);
    A.p(rect(10.4, 87, 6.2, 4), A.stone(0.44), 1);
    stone(A, 84, 95.5, 2.6);
    stone(A, 91, 94.5, 2.2);
    A.add('<circle cx="' + (bx + 25) + '" cy="78" r="13" fill="url(#ix-glow-' + A.color + ')" stroke="none" opacity=".45"/>');
  }

  /* ── 3단계: 파는 곳 — 차양·깃발·진열 벨벳이 색을 맡는다 ── */

  /** 줄무늬 차양(색 줄 + 밝은 줄) @param {ArtKit} A @param {number[]} a 왼위 @param {number[]} b 오른위 @param {number} drop @param {number} n @param {number} flare */
  function awning(A, a, b, drop, n, flare) {
    let all = '';
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n;
      const x0 = a[0] + (b[0] - a[0]) * u0, x1 = a[0] + (b[0] - a[0]) * u1;
      const y0 = a[1] + (b[1] - a[1]) * u0, y1 = a[1] + (b[1] - a[1]) * u1;
      const f0 = -flare + 2 * flare * u0, f1 = -flare + 2 * flare * u1;
      const d = 'M' + f(x0) + ' ' + f(y0) + 'L' + f(x1) + ' ' + f(y1) + 'L' + f(x1 + f1) + ' ' + f(y1 + drop) +
        'Q' + f((x0 + x1 + f0 + f1) / 2) + ' ' + f((y0 + y1) / 2 + drop + 3.2) + ' ' + f(x0 + f0) + ' ' + f(y0 + drop) + 'Z';
      A.c(d, i % 2 === 0 ? 2 : 4, -1);
      all += d;
    }
    A.ov(all, 'gr1', true);
    A.ov(all, 'sc-b', true);
  }

  /** 깃대에 건 세로 깃발(제비꼬리, 색) @param {ArtKit} A @param {number} x @param {number} y @param {number} w @param {number} hh */
  function banner(A, x, y, w, hh) {
    A.add(line([[x - w / 2 - 2, y], [x + w / 2 + 2, y]], A.raw(0.1), 1.2));
    const t = w / 3;
    A.c(poly([[x - w / 2, y + 0.6], [x - w / 2 + t, y + 0.6], [x - w / 2 + t, y + hh - 4], [x - w / 2 + t / 2, y + hh - 8], [x - w / 2, y + hh]]), 2, 1, 'b');
    A.c(poly([[x - w / 2 + t, y + 0.6], [x + w / 2 - t, y + 0.6], [x + w / 2 - t, y + hh - 4], [x, y + hh - 9], [x - w / 2 + t, y + hh - 4]]), 3, 1, 'b');
    A.c(poly([[x + w / 2 - t, y + 0.6], [x + w / 2, y + 0.6], [x + w / 2, y + hh], [x + w / 2 - t / 2, y + hh - 8], [x + w / 2 - t, y + hh - 4]]), 1, 1, 'b');
  }

  /** 피렌체풍 도시 윤곽: 둥근 지붕과 종탑, 앞에는 깃발과 차양 @param {ArtKit} A */
  function sceneSkyline(A) {
    sky(A, 90);
    mirrored(A, A.v % 2 === 1, () => {
      A.p(poly([[0, 84], [18, 77], [42, 83], [70, 75], [100, 81], [100, 92], [0, 92]]), A.stone(0.56), 0);
      /* 뒷줄 집들 */
      let x = -2;
      A.batch(() => { while (x < 100) {
        const w = A.r(8, 13), y = A.r(70, 80);
        A.p(rect(x, y, w, 94 - y), A.wood(0.5 + A.r(-0.08, 0.1)), 1, 'b');
        A.p(poly([[x - 0.8, y], [x + w + 0.8, y], [x + w * 0.5, y - A.r(2.5, 4.5)]]), A.wood(0.3), 0);
        x += w;
      } });
      /* 둥근 지붕: 북통 + 갈빗대로 나뉜 쪽들 + 꼭대기 등 */
      const dx = A.r(26, 32), base = 72, R = 14, H = 24;
      const faces = [0.62, 0.72, 0.5];
      for (let i = 0; i < 3; i++) A.p(rect(dx - 12 + i * 8, base, 8, 10), A.stone(faces[i]), 1);
      const ribs = [-1, -0.5, 0.05, 0.6, 1];
      /** @param {number} u @param {number} t */
      const dp = (u, t) => [dx + u * R * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.9))), base - H * t];
      const gl = [0.66, 0.54, 0.44, 0.32];
      for (let i = 0; i < 4; i++) {
        const pts = [];
        for (let k = 0; k <= 5; k++) pts.push(dp(ribs[i], k / 5));
        for (let k = 5; k >= 0; k--) pts.push(dp(ribs[i + 1], k / 5));
        A.p(poly(pts), A.wood(gl[i]), i < 2 ? 4 : 5);
      }
      A.p(rect(dx - 1.8, base - H - 6, 3.6, 6.4), A.stone(0.8), 1);
      A.p(poly([[dx - 2.6, base - H - 6], [dx + 2.6, base - H - 6], [dx, base - H - 10]]), A.wood(0.4), 0);
      A.p(ell(dx, base - H - 11, 1.3), A.raw(0.9), -1);
      /* 종탑: 층층이 다른 나무 */
      const tx = dx + A.r(22, 26);
      for (let i = 0; i < 6; i++) A.p(rect(tx, 44 + i * 8, 8, 8), A.stone(i % 2 ? 0.72 : 0.56), i % 2 ? 0 : 1, 'r');
      A.p(poly([[tx - 1, 44], [tx + 9, 44], [tx + 8, 41], [tx, 41]]), A.wood(0.3), 0);
      A.fine(() => { for (let i = 0; i < 4; i++) A.add('<rect x="' + f(tx + 3) + '" y="' + (48 + i * 10) + '" width="2" height="4.4" rx="1" fill="' + A.raw(0.06) + '" stroke="none"/>'); });
      /* 성탑 하나 */
      A.p(rect(tx + 16, 58, 5.5, 36), A.stone(0.5), 1, 'r');
      A.p(poly([[tx + 15, 58], [tx + 22.5, 58], [tx + 22.5, 54.5], [tx + 20.5, 54.5], [tx + 20.5, 56], [tx + 17, 56], [tx + 17, 54.5], [tx + 15, 54.5]]), A.stone(0.42), -1);
    });
    /* 앞 지붕들 */
    A.p(poly([[0, 96], [34, 92], [40, 104], [0, 110]]), A.wood(0.44), 2, 'b');
    A.p(poly([[30, 94], [70, 90], [76, 102], [36, 106]]), A.wood(0.56), 3, 'b');
    A.p(poly([[66, 92], [100, 88], [100, 102], [72, 104]]), A.wood(0.4), 2, 'b');
    A.p(poly([[0, 108], [100, 100], [100, 140], [0, 140]]), A.stone(0.5), 0, 't');
    A.fine(() => { for (let i = 0; i < 4; i++) A.p(rect(6 + i * 13, 118 + i * -0.8, 6, 9), A.raw(0.1), -1); });
    /* 깃발과 깃대 */
    const px = A.r(78, 84);
    A.add(line([[px, 41], [px, 106]], A.raw(0.12), 1.3));
    A.p(ell(px, 40.5, 1.5), A.raw(0.86), -1);
    banner(A, px, 47, A.r(22, 25), A.r(40, 46));
    A.fine(() => {
      /* 줄에 건 작은 삼각 깃발 */
      const x0 = 30, y0 = 46, x1 = px - 1;
      for (let i = 0; i < 5; i++) {
        const u = (i + 0.5) / 5.6, x = x0 + (x1 - x0) * u, y = y0 + Math.sin(Math.PI * u) * 7 + (41 - y0) * u;
        A.c(poly([[x - 2.3, y], [x + 2.3, y - 0.3], [x + 0.2, y + 5.4]]), i % 2 ? 3 : 2, -1);
      }
      A.add('<path d="M' + x0 + ' ' + y0 + 'Q' + f((x0 + x1) / 2) + ' ' + (y0 + 9) + ' ' + f(x1) + ' 41.6" fill="none" stroke="' + A.raw(0.1) + '" stroke-width=".4"/>');
    });
    /* 가게 차양 */
    awning(A, [46, 108], [98, 103.5], 11, 6, 2);
    A.add(line([[47, 120], [47, 140]], A.raw(0.14), 1.1));
  }

  /** 운하 위 아치 다리: 다리 위 가게들의 차양, 짐 실은 거룻배 @param {ArtKit} A */
  function sceneBridge(A) {
    sky(A, 72);
    mirrored(A, A.v % 2 === 1, () => {
      /* 건너편 집들 */
      let x = -2;
      A.batch(() => { while (x < 100) {
        const w = A.r(9, 15), y = A.r(50, 60);
        A.p(rect(x, y, w, 74 - y), A.wood(0.54 + A.r(-0.1, 0.1)), 1, 'b');
        A.p(poly([[x - 0.8, y], [x + w + 0.8, y], [x + w * 0.5, y - A.r(2.5, 4.5)]]), A.wood(0.32), 0);
        x += w;
      } });
      A.p(rect(A.r(62, 74), 40, 7, 34), A.stone(0.6), 1, 'r');
    });
    sea(A, 72, 6);
    /* 다리: 아치 셋 */
    const y0 = 80, y1 = 104;
    A.p(rect(0, y0, 100, y1 - y0), A.stone(0.64), 0, 'b');
    for (const cx of [17, 50, 83]) {
      A.p(arch(cx - 12.5, cx + 12.5, y1 - 4, y1 + 1), A.stone(0.84), 0);
      A.p(arch(cx - 10.5, cx + 10.5, y1 - 4, y1 + 1), A.dark(0.07), -1);
    }
    A.p(poly([[0, y1], [100, y1], [100, y1 + 3], [0, y1 + 3]]), A.stone(0.22), 0);
    for (const cx of [33.5, 66.5]) A.p(poly([[cx - 4, y1 + 3], [cx - 3.4, y0 + 8], [cx + 3.4, y0 + 8], [cx + 4, y1 + 3]]), A.stone(0.74), 1, 'r');
    A.p(rect(0, y0 - 2, 100, 3), A.stone(0.8), 0, 'b');
    /* 다리 위 가게들과 차양(색) */
    const shops = [[2, 18], [21, 17], [62, 17], [80, 18]];
    for (let i = 0; i < shops.length; i++) {
      const sx = shops[i][0], sw = shops[i][1], sy = 58 + (i % 2) * 2;
      A.p(rect(sx, sy, sw, y0 - 2 - sy), A.wood(0.56 + (i % 2) * 0.1), 1, 'b');
      A.p(poly([[sx - 1, sy], [sx + sw + 1, sy], [sx + sw - 1.4, sy - 4], [sx + 1.4, sy - 4]]), A.wood(0.32), 0);
      awning(A, [sx + 0.6, sy + 4], [sx + sw - 0.6, sy + 4], 8, 4, 1.4);
    }
    /* 가운데 트인 회랑 */
    A.p(rect(40, 60, 20, 4), A.stone(0.76), 0, 'b');
    for (let i = 0; i < 3; i++) A.p(arch(41.5 + i * 6, 46.5 + i * 6, 70, 78), A.raw(Math.max(0.5, A.mood.sky[1] - 0.1)), -1);
    /* 가운데 아치에 드리운 큰 깃발(색) */
    banner(A, 50, y0 - 1, 19, 27);
    /* 거룻배와 천 덮은 짐(색) */
    const bx = A.r(58, 63), by = A.r(122, 127);
    A.fine(() => {
      for (let i = 0; i < 4; i++) { const xx = 14 + i * 22 + A.r(-3, 3), yy = 110 + (i % 2) * 5; A.c(poly([[xx - 6, yy], [xx + 6, yy - 0.5], [xx + 4, yy + 1.8], [xx - 4.4, yy + 2]]), 1, 0); }
    });
    A.p('M' + f(bx - 6) + ' ' + f(by) + 'L' + f(bx + 36) + ' ' + f(by - 2) + 'L' + f(bx + 31) + ' ' + f(by + 7) + 'Q' + f(bx + 14) + ' ' + f(by + 10) + ' ' + f(bx - 1) + ' ' + f(by + 7) + 'Z', A.wood(0.28), 0, 'b');
    A.c('M' + f(bx + 1) + ' ' + f(by - 0.4) + 'Q' + f(bx + 3) + ' ' + f(by - 17) + ' ' + f(bx + 14) + ' ' + f(by - 17) + 'L' + f(bx + 15.5) + ' ' + f(by - 1) + 'Z', 3, 1, 'b');
    A.c('M' + f(bx + 14) + ' ' + f(by - 17) + 'Q' + f(bx + 29) + ' ' + f(by - 17.5) + ' ' + f(bx + 31) + ' ' + f(by - 1.8) + 'L' + f(bx + 15.5) + ' ' + f(by - 1) + 'Z', 2, 4, 'r');
    A.add(line([[bx + 8, by - 15.4], [bx + 8.6, by - 0.8]], A.raw(0.86), 0.9) + line([[bx + 23, by - 16], [bx + 24, by - 1.4]], A.raw(0.86), 0.9));
    A.add(line([[bx + 40, by - 20], [bx + 38.6, by + 12]], A.wood(0.3), 1.6));
  }

  /** 반듯한 돌쌓기 벽 @param {ArtKit} A @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} rh @param {number} bw @param {number} l */
  function ashlar(A, x0, y0, x1, y1, rh, bw, l) {
    A.batch(() => {
      let j = 0;
      for (let y = y0; y < y1; y += rh, j++) {
        for (let x = x0 - (j % 2 ? bw / 2 : 0); x < x1; x += bw) {
          const a = Math.max(x0, x), b = Math.min(x1, x + bw);
          if (b - a > 0.5) A.p(rect(a, y, b - a, Math.min(rh, y1 - y)), A.stone(l, 0.07), A.rnd() < 0.7 ? 0 : 2);
        }
      }
    });
  }

  /** 아치 창 너머 보석상 진열장: 계단식 벨벳 위의 보석, 줄무늬 차양 @param {ArtKit} A */
  function sceneWindow(A) {
    ashlar(A, 0, 0, 100, 140, 14, 25, 0.52);
    const cx = A.v % 2 ? 60 : 56, hw = 27, ys = 74, yb = 113;
    /* 덧문 */
    const sh = cx - hw - 15;
    A.p(rect(sh, 62, 11, 51), A.wood(0.42), 1, 'l');
    A.fine(() => { A.p(rect(sh + 1.6, 66, 7.8, 19), A.wood(0.54), 1); A.p(rect(sh + 1.6, 89, 7.8, 19), A.wood(0.54), 1); });
    /* 아치 홍예석 */
    for (let k = 0; k < 9; k++) {
      const a0 = Math.PI + k * Math.PI / 9, a1 = a0 + Math.PI / 9;
      A.p(poly([[cx + hw * Math.cos(a0), ys + hw * Math.sin(a0)], [cx + (hw + 6.5) * Math.cos(a0), ys + (hw + 6.5) * Math.sin(a0)],
        [cx + (hw + 6.5) * Math.cos(a1), ys + (hw + 6.5) * Math.sin(a1)], [cx + hw * Math.cos(a1), ys + hw * Math.sin(a1)]]), A.stone(k % 2 ? 0.5 : 0.8), k % 2 ? 2 : 3);
    }
    A.p(rect(cx - hw - 6.5, ys, 6.5, yb - ys), A.stone(0.76), 1, 'r');
    A.p(rect(cx + hw, ys, 6.5, yb - ys), A.stone(0.62), 1, 'l');
    A.p(arch(cx - hw, cx + hw, ys, yb), A.dark(0.045), -1);
    A.p(arch(cx - hw + 5, cx + hw - 5, ys + 2, yb), A.dark(0.1), -1);
    A.fine(() => {
      A.add('<circle cx="' + cx + '" cy="70" r="12" fill="url(#ix-halo-l)" stroke="none" opacity=".6"/>');
      A.add(line([[cx, 47], [cx, 66]], A.raw(0.3), 0.4));
      A.p(poly([[cx - 2, 66], [cx + 2, 66], [cx + 3, 71], [cx - 3, 71]]), A.pale(0.96), -1);
    });
    /* 계단식 진열 벨벳(색) */
    A.c(poly([[cx - 17, 84], [cx + 17, 84], [cx + 19.5, 88], [cx - 19.5, 88]]), 3, 0);
    A.c(poly([[cx - 19.5, 88], [cx + 19.5, 88], [cx + 19.5, 98], [cx - 19.5, 98]]), 1, 0, 'b');
    A.c(poly([[cx - 23, 98], [cx + 23, 98], [cx + 26.4, 103], [cx - 26.4, 103]]), 3, 0);
    A.c(poly([[cx - 26.4, 103], [cx + 26.4, 103], [cx + 26.4, yb], [cx - 26.4, yb]]), 2, 0, 'b');
    /* 진열된 보석 */
    stone(A, cx - 9, 83, 3.4); stone(A, cx + 1, 82.4, 4.2); stone(A, cx + 10.5, 83.2, 3);
    stone(A, cx - 16, 98, 3.6); stone(A, cx - 5, 97.6, 3); stone(A, cx + 6, 97.4, 4); stone(A, cx + 17, 98.2, 3.2);
    A.fine(() => { A.add(sparkle(cx + 1, 79, 3.2, 0.9) + sparkle(cx + 6, 94, 2.6, 0.85) + sparkle(cx - 16, 95, 2.2, 0.8)); });
    /* 창턱 */
    A.p(rect(cx - hw - 9, yb, hw * 2 + 18, 5), A.wood(0.74), 0, 'b');
    A.p(rect(cx - hw - 6, yb + 5, hw * 2 + 12, 2.4), A.wood(0.4), 0);
    /* 줄무늬 차양(색) */
    awning(A, [cx - hw - 9, 41], [cx + hw + 9, 41], 15, 7, 3.4);
    A.add(line([[cx - hw - 9.5, 40.6], [cx + hw + 9.5, 40.6]], A.raw(0.12), 1.4));
  }

  /** 금화 더미 @param {ArtKit} A @param {number} x @param {number} y @param {number} n */
  function coins(A, x, y, n) {
    const gold = '#d6b55a', gold2 = '#a8862f', hi = '#f0dc98';
    A.p('M' + f(x - 5) + ' ' + f(y - n * 1.7) + 'L' + f(x - 5) + ' ' + f(y) + 'A5 2.1 0 0 0 ' + f(x + 5) + ' ' + f(y) + 'L' + f(x + 5) + ' ' + f(y - n * 1.7) + 'Z', gold2, -1, 'r');
    A.fine(() => { for (let i = 1; i < n; i++) A.add('<path d="M' + f(x - 5) + ' ' + f(y - i * 1.7) + 'A5 2.1 0 0 0 ' + f(x + 5) + ' ' + f(y - i * 1.7) + '" fill="none" stroke="#5d4610" stroke-width=".35"/>'); });
    A.p(ell(x, y - n * 1.7, 5, 2.1), gold, -1);
    A.fine(() => A.add('<ellipse cx="' + f(x) + '" cy="' + f(y - n * 1.7) + '" rx="3.2" ry="1.2" fill="none" stroke="' + hi + '" stroke-width=".4"/>'));
  }

  /** 은행가의 탁자: 덮개 천, 펼친 장부, 플로린 금화, 색유리 창으로 드는 빛 @param {ArtKit} A */
  function sceneBanco(A) {
    A.p(rect(0, 0, 100, 94), A.wood(0.46), 1);
    mirrored(A, A.v % 2 === 1, () => {
      /* 색유리 창: 마름모 유리 조각, 몇 장만 색 */
      const wx = A.r(10, 14), wy = 42, cw = 7.4, ch = 9;
      A.p(rect(wx - 3, wy - 3, cw * 4 + 6, ch * 5 + 6), A.stone(0.74), 1, 'br');
      for (let j = 0; j < 5; j++) {
        for (let i = 0; i < 4; i++) {
          const x = wx + i * cw, y = wy + j * ch;
          const col = (i * 2 + j * 3 + A.v) % 5 === 0;
          const d = poly([[x + cw / 2, y], [x + cw, y + ch / 2], [x + cw / 2, y + ch], [x, y + ch / 2]]);
          A.p(rect(x, y, cw, ch), A.pale(0.84 + A.r(-0.08, 0.1)), 2);
          if (col) A.c(d, (i + j) % 2 ? 3 : 2, -1); else A.p(d, A.pale(0.95), 4);
        }
      }
      /* 창으로 드는 빛 */
      A.add('<path d="' + poly([[wx + cw * 4 + 3, wy + 4], [wx + cw * 4 + 3, wy + ch * 5], [100, 138], [100, 98]]) + '" fill="#fff3d0" opacity=".13" stroke="none"/>');
      /* 벽 선반의 촛대 */
      A.fine(() => {
        A.add('<circle cx="84" cy="56" r="11" fill="url(#ix-halo-l)" stroke="none" opacity=".7"/>');
        A.p(rect(82.8, 58, 2.4, 12), A.pale(0.95), 1);
        A.p(poly([[84, 52.5], [85.4, 56], [84, 58.4], [82.6, 56]]), A.pale(1), -1);
        A.p(poly([[79, 70], [89, 70], [87, 73], [81, 73]]), A.raw(0.7), 0);
      });
    });
    /* 탁자와 덮개 천(색) */
    A.p(poly([[0, 93], [100, 90], [100, 140], [0, 140]]), A.wood(0.4), 0, 't');
    const cl = A.v % 2 ? 30 : 36;
    A.c(poly([[cl, 92.4], [100, 90], [100, 140], [cl + 9, 140]]), 2, 0, 't');
    A.c(poly([[cl, 92.4], [cl + 5, 92.2], [cl + 14, 140], [cl + 9, 140]]), 1, 1);
    A.c(poly([[cl + 5, 92.2], [cl + 8.4, 92.1], [cl + 17.4, 140], [cl + 14, 140]]), 3, 1);
    A.fine(() => {
      for (let i = 0; i < 3; i++) { const x = 52 + i * 15, y = 128 + (i % 2) * 4; A.c(lozenge(x, y, 2.6), 3, -1); }
    });
    /* 보석함 */
    const kx = A.r(62, 68);
    A.p(poly([[kx, 80], [kx + 22, 79], [kx + 24, 92], [kx - 1, 93.4]]), A.wood(0.3), 0, 'b');
    A.p(poly([[kx - 1, 70], [kx + 23, 68.6], [kx + 22, 79], [kx, 80]]), A.wood(0.2), 0);
    A.p(rect(kx + 9.6, 78.6, 3, 14.2), A.raw(0.8), -1);
    stone(A, kx + 5, 79.4, 3.4); stone(A, kx + 11.5, 78.4, 4.2); stone(A, kx + 18, 79, 3.2);
    A.add('<circle cx="' + f(kx + 11) + '" cy="77" r="13" fill="url(#ix-glow-' + A.color + ')" stroke="none" opacity=".5"/>');
    /* 펼친 장부 */
    const lx = A.r(40, 46), ly = 99;
    A.p(poly([[lx - 1.4, ly + 0.8], [lx + 41, ly - 2.6], [lx + 45.4, ly + 21], [lx + 2.4, ly + 25.4]]), A.wood(0.2), 0);
    A.p(poly([[lx, ly], [lx + 19.6, ly - 1.6], [lx + 22, ly + 21.6], [lx + 3, ly + 23.6]]), A.pale(0.95), 0, 'r');
    A.p(poly([[lx + 19.6, ly - 1.6], [lx + 39.6, ly - 3.2], [lx + 43.6, ly + 19.6], [lx + 22, ly + 21.6]]), A.pale(0.9), 0, 'l');
    A.fine(() => {
      for (let i = 0; i < 6; i++) {
        const y = ly + 3 + i * 3.1;
        A.add(line([[lx + 2.6 + i * 0.4, y], [lx + 17.6 + i * 0.4, y - 1.2]], A.raw(0.3), 0.4) + line([[lx + 22.6 + i * 0.4, y - 1.6], [lx + 38.6 + i * 0.5, y - 2.9]], A.raw(0.3), 0.4));
      }
    });
    /* 플로린 금화 */
    coins(A, 91, 108, 5); coins(A, 84, 126, 3); coins(A, 94, 121, 2);
    A.p(ell(72, 131, 5, 2.1), '#d6b55a', -1);
  }

  /** @type {((A:ArtKit) => void)[]} */
  const SCENES_T2 = [sceneShip, sceneBales, sceneBench, sceneScales];
  /** @type {((A:ArtKit) => void)[]} */
  const SCENES_T3 = [sceneSkyline, sceneBridge, sceneWindow, sceneBanco];

  /* ═════════════ 6. 카드·덱·뒷면·빈칸 ═════════════ */

  /** 단계·색 안에서 몇 번째 카드인지(장면 틀과 변주를 고르는 데 쓴다) @type {Record<string, number>|null} */
  let cardIndex = null;
  /** @param {CardDef} def */
  function indexOf(def) {
    if (!cardIndex) {
      cardIndex = {};
      /** @type {Record<string, number>} */
      const seen = {};
      const all = (G.Zap.data && G.Zap.data.cards) || [];
      for (const c of all) {
        const k = c.tier + c.bonus;
        cardIndex[c.id] = seen[k] = (seen[k] === undefined ? 0 : seen[k] + 1);
      }
    }
    const v = cardIndex[def.id];
    return v === undefined ? hash(def.id) % 8 : v;
  }

  /** @type {((A:ArtKit) => void)[][]} */
  const SCENES = [[], [sceneGallery, sceneCart, sceneCliff, sceneCavern], SCENES_T2, SCENES_T3];
  /* 장면이 바깥인지(하늘이 있음): 밝기 고르기에 쓴다 */
  const MOOD_CYCLE = { u: ['gray', 'day', 'dusk'], g: ['dusk', 'gray', 'day'], r: ['gray', 'dusk', 'day'] };

  /** 카드 삽화(틀·정보 바탕 포함)의 SVG 안쪽 글자 @param {CardDef} def */
  function cardArt(def) {
    const ci = COLORS.indexOf(def.bonus);
    const idx = indexOf(def);
    const list = SCENES[def.tier];
    const scene = list[(idx + ci) % list.length];
    const variant = Math.floor(idx / list.length) + (def.tier === 3 ? ci : 0);
    /** @type {Mood} */
    let mood;
    if (def.bonus === 'w') mood = MOODS.night;
    else if (def.bonus === 'k') mood = MOODS.day;
    else mood = MOODS[MOOD_CYCLE[def.bonus][(idx + def.tier) % 3]];
    const { A, out } = makeArt(hash('ix' + def.id), mood, def.bonus, variant);
    scene(A);
    const nCost = COLORS.filter((c) => def.cost[c] > 0).length;
    const two = nCost >= 3;
    const rows = two ? 2 : nCost;
    const sw = two ? 72 : 44, sh = rows * 30 + 18;
    const fw = 3.2;
    const fr = ramp(WOOD, 0.46), fr2 = ramp(WOOD, 0.38);
    return '<g stroke="#1b1209" stroke-width=".45" stroke-linejoin="round">' + out.join('') + '</g>' +
      '<rect width="100" height="140" fill="url(#ix-vig)"/>' +
      /* 점수·보석 띠 */
      '<rect width="100" height="37" fill="url(#ix-band' + (def.bonus === 'k' ? '-k' : '') + ')"/>' +
      '<path d="M0 37.4H100" stroke="' + ramp(WOOD, 0.9) + '" stroke-width=".8"/><path d="M0 38.3H100" stroke="#120c06" stroke-width=".7"/>' +
      (def.bonus === 'w' ? '' : '<circle cx="79.5" cy="20" r="' + (def.bonus === 'k' ? 21 : 19) + '" fill="url(#ix-halo-l)" opacity="' + (def.bonus === 'k' ? 0.8 : def.bonus === 'u' ? 0.5 : 0.34) + '"/>') +
      /* 비용 자리 */
      '<rect x="0" y="' + (140 - sh) + '" width="' + sw + '" height="' + sh + '" fill="url(#ix-costshade)"/>' +
      /* 가장자리 띠 상감: 연귀 맞춤한 네 변 + 밝고 어두운 실선 */
      '<g stroke="#120c06" stroke-width=".35">' +
      '<path d="' + poly([[0, 0], [100, 0], [100 - fw, fw], [fw, fw]]) + '" fill="' + fr + '"/><path d="' + poly([[0, 0], [100, 0], [100 - fw, fw], [fw, fw]]) + '" fill="url(#ix-gr0)"/>' +
      '<path d="' + poly([[0, 140], [100, 140], [100 - fw, 140 - fw], [fw, 140 - fw]]) + '" fill="' + fr2 + '"/><path d="' + poly([[0, 140], [100, 140], [100 - fw, 140 - fw], [fw, 140 - fw]]) + '" fill="url(#ix-gr0)"/>' +
      '<path d="' + poly([[0, 0], [fw, fw], [fw, 140 - fw], [0, 140]]) + '" fill="' + fr + '"/><path d="' + poly([[0, 0], [fw, fw], [fw, 140 - fw], [0, 140]]) + '" fill="url(#ix-gr1)"/>' +
      '<path d="' + poly([[100, 0], [100 - fw, fw], [100 - fw, 140 - fw], [100, 140]]) + '" fill="' + fr2 + '"/><path d="' + poly([[100, 0], [100 - fw, fw], [100 - fw, 140 - fw], [100, 140]]) + '" fill="url(#ix-gr1)"/>' +
      '</g>' +
      '<rect x="' + (fw + 0.5) + '" y="' + (fw + 0.5) + '" width="' + (100 - 2 * fw - 1) + '" height="' + (140 - 2 * fw - 1) + '" fill="none" stroke="#d3b872" stroke-width=".9"/>' +
      '<rect x="' + (fw + 1.5) + '" y="' + (fw + 1.5) + '" width="' + (100 - 2 * fw - 3) + '" height="' + (140 - 2 * fw - 3) + '" fill="none" stroke="#120c06" stroke-width=".5"/>' +
      '<rect width="100" height="140" fill="url(#ix-varnish)"/>';
  }

  /** @type {Map<string, HTMLElement>} */
  const cardCache = new Map();

  /** 앞면 카드. 폭은 --card-w. @param {CardDef} def @returns {HTMLElement} */
  function card(def) {
    ensureDefs();
    const hit = cardCache.get(def.id);
    if (hit) return /** @type {HTMLElement} */ (hit.cloneNode(true));
    const el = h('div', 'ix-card ix-card--' + def.bonus + ' ix-card--t' + def.tier);
    el.setAttribute('data-card-id', def.id);
    el.setAttribute('data-color', def.bonus);
    el.setAttribute('data-tier', String(def.tier));
    const body = h('div', 'ix-card__body');
    const art = svg('0 0 100 140', 'ix-card__art', cardArt(def));
    art.setAttribute('preserveAspectRatio', 'none');
    body.appendChild(art);
    const top = h('div', 'ix-card__top');
    if (def.points > 0) top.appendChild(numeral(def.points, 'ix-card__pts'));
    const gm = gem(def.bonus, 0);
    gm.classList.add('ix-card__gem');
    top.appendChild(gm);
    body.appendChild(top);
    const need = COLORS.filter((c) => def.cost[c] > 0);
    const costs = h('div', 'ix-card__costs ix-card__costs--n' + need.length);
    for (const c of need) {
      const chip = chipFace(c, '', 'ix-cost');
      chip.setAttribute('data-color', c);
      chip.appendChild(h('b', 'ix-chip__n', String(def.cost[c])));
      costs.appendChild(chip);
    }
    body.appendChild(costs);
    body.appendChild(h('i', 'ix-card__sheen'));
    el.appendChild(body);
    cardCache.set(def.id, el);
    return /** @type {HTMLElement} */ (el.cloneNode(true));
  }

  /* 뒷면: 단계 색으로 물들인 나무 + 쪽매 별 + 점 1~3개. 채도는 낮게(보석 색과 겨루지 않게). */
  const TIER_WOOD = { 1: ['#2c3b27', '#3e5236', '#566b49', '#7d9069'], 2: ['#6b5626', '#8f7537', '#ab9150', '#cdb67b'], 3: ['#25364a', '#34506c', '#4a6a88', '#7895ae'] };

  function backDefs() {
    let d = '';
    for (const t of [1, 2, 3]) {
      const c = TIER_WOOD[/** @type {1|2|3} */ (t)];
      let s = '<g id="ix-back-' + t + '">' +
        '<rect width="100" height="140" fill="' + c[1] + '"/><rect width="100" height="140" fill="url(#ix-gr1)"/>';
      /* 마름모 쪽매 바탕 */
      let dark = '', light = '';
      for (let j = 0; j < 9; j++) {
        for (let i = 0; i < 6; i++) {
          const x = 10 + i * 16 + (j % 2 ? 8 : 0), y = 12 + j * 14.5;
          const pth = poly([[x, y - 7.2], [x + 8, y], [x, y + 7.2], [x - 8, y]]);
          if ((i + j) % 2) dark += pth; else light += pth;
        }
      }
      s += '<g clip-path="url(#ix-backclip)"><path d="' + dark + '" fill="' + c[0] + '" opacity=".55"/><path d="' + light + '" fill="' + c[2] + '" opacity=".4"/>' +
        '<path d="' + dark + light + '" fill="none" stroke="#0e0b06" stroke-width=".3" opacity=".6"/></g>';
      /* 가운데 쪽매 별(여덟 꼭지, 면마다 밝고 어둡게) */
      const cx = 50, cy = 54;
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="27" fill="' + c[0] + '" stroke="#0e0b06" stroke-width=".5"/>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="24.6" fill="none" stroke="' + ramp(WOOD, 0.86) + '" stroke-width="1.1"/>';
      for (let i = 0; i < 8; i++) {
        const a0 = (i * 45 - 90) * Math.PI / 180, a1 = a0 + Math.PI / 8, a2 = a0 - Math.PI / 8;
        const tip = [cx + 22 * Math.cos(a0), cy + 22 * Math.sin(a0)];
        const l = [cx + 9.5 * Math.cos(a2), cy + 9.5 * Math.sin(a2)], r = [cx + 9.5 * Math.cos(a1), cy + 9.5 * Math.sin(a1)];
        s += '<polygon points="' + pstr([[cx, cy], l, tip]) + '" fill="' + (i % 2 ? ramp(WOOD, 0.9) : c[3]) + '" stroke="#0e0b06" stroke-width=".35"/>' +
          '<polygon points="' + pstr([[cx, cy], tip, r]) + '" fill="' + (i % 2 ? ramp(WOOD, 0.62) : c[1]) + '" stroke="#0e0b06" stroke-width=".35"/>';
      }
      /* 단계 점 */
      for (let i = 0; i < t; i++) {
        const x = 50 + (i - (t - 1) / 2) * 15;
        s += '<circle cx="' + (x + 0.6) + '" cy="121" r="5.4" fill="#0e0b06" opacity=".7"/>' +
          '<circle cx="' + x + '" cy="120" r="5.2" fill="' + ramp(WOOD, 0.98) + '" stroke="#0e0b06" stroke-width=".6"/>' +
          '<circle cx="' + x + '" cy="120" r="2.6" fill="none" stroke="' + ramp(WOOD, 0.6) + '" stroke-width=".7"/>';
      }
      /* 가장자리 띠 */
      s += '<rect x="1.6" y="1.6" width="96.8" height="136.8" fill="none" stroke="' + c[0] + '" stroke-width="3.2"/>' +
        '<rect x="3.8" y="3.8" width="92.4" height="132.4" fill="none" stroke="' + ramp(WOOD, 0.9) + '" stroke-width=".9"/>' +
        '<rect x="5" y="5" width="90" height="130" fill="none" stroke="#0e0b06" stroke-width=".5"/>' +
        '<rect width="100" height="140" fill="url(#ix-varnish)"/></g>';
      d += s;
    }
    d += '<clipPath id="ix-backclip"><rect x="5" y="5" width="90" height="130"/></clipPath>';
    return d;
  }

  /** 카드 뒷면 한 장 @param {Tier} tier @returns {HTMLElement} */
  function cardBack(tier) {
    ensureDefs();
    const el = h('div', 'ix-back ix-back--t' + tier);
    el.setAttribute('data-tier', String(tier));
    const body = h('div', 'ix-back__body');
    const s = svg('0 0 100 140', 'ix-back__art', '<use href="#ix-back-' + tier + '"/>');
    s.setAttribute('preserveAspectRatio', 'none');
    body.appendChild(s);
    el.appendChild(body);
    return el;
  }

  /** 공개 줄의 빈칸 @returns {HTMLElement} */
  function emptySlot() {
    return h('div', 'ix-slot');
  }

  /** 덱 더미: 남은 장수에 비례한 두께 + 장수 명판. 0장이면 빈 자리. @param {Tier} tier @param {number} count @returns {HTMLElement} */
  function deck(tier, count) {
    ensureDefs();
    const el = h('div', 'ix-deck ix-deck--t' + tier + (count === 0 ? ' is-empty' : ''));
    el.setAttribute('data-tier', String(tier));
    el.setAttribute('data-count', String(count));
    if (count === 0) {
      const slot = emptySlot();
      slot.classList.add('ix-deck__slot');
      el.appendChild(slot);
      return el;
    }
    /* 두께: 40장일 때 가장 두껍다(1단계 덱이 가장 높고 3단계 덱은 절반) */
    el.style.setProperty('--k', f(Math.min(1, count / 40) * 100) + '%');
    el.style.setProperty('--kk', String(Math.round(Math.min(1, count / 40) * 1000) / 1000));
    el.appendChild(h('div', 'ix-deck__side'));
    const top = cardBack(tier);
    top.classList.add('ix-deck__top');
    el.appendChild(top);
    const plate = h('div', 'ix-deck__n', h('b', '', String(count)));
    top.appendChild(plate);
    return el;
  }

  /* ═════════════ 7. 귀족: 곤팔로네(세로 깃발) + 말머리형 방패 문장 ═════════════
   * 그림 좌표 100×115. 왼쪽 띠에 점수 3 과 조건 사각형, 오른쪽에 관·방패·담비 망토·좌우명 띠.
   * 문장의 색 = 요구하는 보석 색. 금(또는 흰 보석을 요구하면 은) 바탕 위에 색을 얹고 색끼리는 맞대지 않는다.
   */

  /* 말머리형 방패(testa di cavallo): 위 양쪽 귀, 잘록한 목, 불룩한 뺨, 뾰족한 코끝 */
  const SHIELD = 'M0 -25.5C-3 -22.6 -8 -21.8 -12 -22.8C-14.8 -23.6 -16.8 -25.6 -18.4 -27.6C-20.4 -23 -19.2 -18 -15.2 -14.4C-13.4 -12.6 -13.2 -11 -14.6 -9.2' +
    'C-19.6 -4 -21.2 3 -19.2 9C-17.6 14 -13.2 17 -10.6 18.6C-8.4 20.2 -4.6 23.6 0 27.4' +
    'C4.6 23.6 8.4 20.2 10.6 18.6C13.2 17 17.6 14 19.2 9C21.2 3 19.6 -4 14.6 -9.2C13.2 -11 13.4 -12.6 15.2 -14.4C19.2 -18 20.4 -23 18.4 -27.6' +
    'C16.8 -25.6 14.8 -23.6 12 -22.8C8 -21.8 3 -22.6 0 -25.5Z';
  const BANNER = [[7, 9], [93, 9], [93, 111], [50, 100], [7, 111]];
  const OR = '#d9b95f', ARGENT = '#eef0f3', SABLE = '#16171b';
  const MOTTOS = ['VIRTVS', 'FIDES', 'FORTVNA', 'CONSTANTIA', 'PRVDENTIA', 'HONOR', 'CONCORDIA', 'SPES', 'IVSTITIA', 'TEMPERANTIA'];

  function nobleDefs() {
    return '<clipPath id="ix-shieldclip"><path d="' + SHIELD + '"/></clipPath>' +
      '<clipPath id="ix-bannerclip"><polygon points="' + pstr(BANNER) + '"/></clipPath>' +
      '<path id="ix-mottopath" d="M-19 36.2Q0 42.6 19 36.2"/>' +
      lin('ix-gilt', [0, 0, 0, 1], [[0, '#fbe9a8'], [0.4, '#d9b352'], [1, '#8d6a1c']]) +
      lin('ix-shieldsh', [0, 0, 1, 1], [[0, '#fff', 0.34], [0.4, '#fff', 0], [0.6, '#000', 0], [1, '#000', 0.42]]) +
      lin('ix-reqsh', [0, 0, 0, 1], [[0, '#fff', 0.3], [0.45, '#fff', 0], [1, '#000', 0.3]]) +
      lin('ix-fold', [0, 0, 1, 0], [[0, '#000', 0.34], [0.18, '#000', 0], [0.42, '#fff', 0.07], [0.6, '#000', 0.2], [0.8, '#000', 0], [1, '#000', 0.36]]);
  }

  /** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {number} w */
  function bar(x1, y1, x2, y2, w) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), nx = -dy / len * w / 2, ny = dx / len * w / 2;
    return poly([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
  }
  /** @param {number} y @param {number} th */
  function chevron(y, th) {
    return poly([[-24, y + 14], [0, y - 9], [24, y + 14], [24, y + 14 + th], [0, y - 9 + th], [-24, y + 14 + th]]);
  }
  /** @param {number} x @param {number} y @param {number} s */
  function lozenge(x, y, s) { return poly([[x, y - s * 1.3], [x + s, y], [x, y + s * 1.3], [x - s, y]]); }
  /** @param {number} x @param {number} y @param {number} r */
  function star5(x, y, r) {
    const p = [];
    for (let i = 0; i < 10; i++) { const a = (i * 36 - 90) * Math.PI / 180, q = i % 2 ? r * 0.42 : r; p.push([x + q * Math.cos(a), y + q * Math.sin(a)]); }
    return poly(p);
  }
  /** @param {number} y @param {number} th */
  function wavyBar(y, th) {
    return 'M-24 ' + y + 'Q-18 ' + (y - 3.4) + ' -12 ' + y + 'T0 ' + y + 'T12 ' + y + 'T24 ' + y + 'L24 ' + (y + th) +
      'Q18 ' + (y + th + 3.4) + ' 12 ' + (y + th) + 'T0 ' + (y + th) + 'T-12 ' + (y + th) + 'T-24 ' + (y + th) + 'Z';
  }

  /** 방패 안 무늬(방패 좌표: 가운데 0,0, 폭 약 ±20, 높이 ±26). 귀족 10명이 모두 다르다. @param {number} idx @param {Color[]} need */
  function arms(idx, need) {
    const metal = need.indexOf('w') >= 0 ? ARGENT : OR;
    /** @type {Record<Color, string>} */
    const T = { w: ARGENT, u: DYE.u[2], g: DYE.g[2], r: DYE.r[2], k: SABLE };
    const cols = need.filter((c) => c !== 'w').map((c) => T[c]);
    const a = cols[0], b = cols[1] || cols[0], c3 = cols[2] || b;
    /** @param {string} d @param {string} col */
    const pc = (d, col) => '<path d="' + d + '" fill="' + col + '"/>';
    let s = '<rect x="-24" y="-30" width="48" height="60" fill="' + metal + '" stroke="none"/>';
    switch (idx) {
      case 0: /* 금 바탕, 붉은 갈매기 무늬, 검은 마름모 셋 */
        s += pc(chevron(0, 8.5), a) + pc(lozenge(-9.5, -13.5, 3.6) + lozenge(9.5, -13.5, 3.6) + lozenge(0, 15, 3.6), b);
        break;
      case 1: /* 금 바탕, 세로 띠 셋(초록·빨강·검정) */
        s += pc(rect(-15.5, -30, 7, 60), a) + pc(rect(-3.5, -30, 7, 60), b) + pc(rect(8.5, -30, 7, 60), c3);
        break;
      case 2: /* 금 바탕, 붉은 십자, 초록 마름모 넷 */
        s += pc(rect(-4, -30, 8, 60) + rect(-24, -6.5, 48, 8), b) +
          pc(lozenge(-11.5, -15.5, 3.1) + lozenge(11.5, -15.5, 3.1) + lozenge(-11, 10.5, 3.1) + lozenge(11, 10.5, 3.1), a);
        break;
      case 3: /* 금 바탕, 파란 X 십자, 위아래 빨강·좌우 초록 마름모 */
        s += pc(bar(-24, -26, 24, 24, 7) + bar(24, -26, -24, 24, 7), a) +
          pc(lozenge(0, -16, 3) + lozenge(0, 14, 3), c3) + pc(lozenge(-13, -1, 3) + lozenge(13, -1, 3), b);
        break;
      case 4: /* 금 바탕, 파란 사선 띠, 양옆 초록 가는 띠 */
        s += pc(bar(-24, -27, 24, 25, 10), a) + pc(bar(-24, -17, 24, 35, 2.6) + bar(-24, -37, 24, 15, 2.6), b);
        break;
      case 5: /* 은 바탕, 붉은 십자, 검은 막대 흩뿌림 */
        s += pc(rect(-3.6, -30, 7.2, 60) + rect(-24, -6.5, 48, 7.2), a) +
          pc(rect(-12, -17, 3, 5.6) + rect(9, -17, 3, 5.6) + rect(-14, 4, 3, 5.6) + rect(11, 4, 3, 5.6) + rect(-8.5, 12, 3, 5.6) + rect(5.5, 12, 3, 5.6), b);
        break;
      case 6: /* 은 바탕, 파란 가로 띠, 검은 별 셋 */
        s += pc(rect(-24, -5.5, 48, 9), a) + pc(star5(-8.5, -14.5, 4.6) + star5(8.5, -14.5, 4.6) + star5(0, 13, 4.6), b);
        break;
      case 7: /* 은 바탕, 갈매기 무늬 둘(파랑·초록) */
        s += pc(chevron(-8, 6.5), a) + pc(chevron(6, 6.5), b);
        break;
      case 8: { /* 은·검정 바둑판 */
        let d = '';
        for (let j = -4; j < 4; j++) for (let i = -3; i < 3; i++) if ((i + j) % 2 === 0) d += rect(i * 8.4, j * 8.4 + 3, 8.4, 8.4);
        s += pc(d, a);
        break;
      }
      default: /* 은 바탕, 파란 물결 띠 셋 */
        s += pc(wavyBar(-15, 5.6) + wavyBar(-2.5, 5.6) + wavyBar(10, 5.6), a);
    }
    return s;
  }

  /** 방패 위 관 세 가지(좌표: 밑변 가운데 0,0). 관의 보석은 요구하는 보석 색. @param {number} kind @param {Color[]} need */
  function crown(kind, need) {
    const gold = '#d9b352', hi = '#f6e2a0', lo = '#8d6a1c', pearl = '#f6f1e3';
    /** @type {Record<Color, string>} */
    const T = { w: '#f4f6f9', u: DYE.u[2], g: DYE.g[2], r: DYE.r[2], k: '#16171b' };
    let s = '';
    if (kind === 0) {
      s += '<path d="M-12 -4.4L-13.4 -12L-8.6 -8L-6.4 -13.6L-3.4 -8L0 -15.2L3.4 -8L6.4 -13.6L8.6 -8L13.4 -12L12 -4.4Z" fill="' + hi + '"/>';
      for (const p of [[-13.4, -12.6], [-6.4, -14.3], [0, -16], [6.4, -14.3], [13.4, -12.6]]) s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.5" fill="' + pearl + '"/>';
    } else if (kind === 1) {
      s += '<path d="M-12 -4.4L-12.6 -7.5H12.6L12 -4.4Z" fill="' + hi + '"/>';
      for (let i = -3; i <= 3; i++) {
        const x = i * 4.1, top = i % 2 ? -10 : -12.4;
        s += '<path d="M' + f(x - 0.9) + ' -7.4L' + f(x) + ' ' + f(top) + 'L' + f(x + 0.9) + ' -7.4Z" fill="' + gold + '"/><circle cx="' + f(x) + '" cy="' + f(top - 1.3) + '" r="1.55" fill="' + pearl + '"/>';
      }
    } else {
      s += '<path d="M-12 -4.4Q-15 -13.5 0 -12.6Q15 -13.5 12 -4.4Z" fill="' + lo + '"/>' +
        '<path d="M-12 -4.4Q-15 -13.5 0 -12.6L0 -10.2Q-10.6 -10.8 -9.2 -4.4Z" fill="' + hi + '"/>' +
        '<path d="M12 -4.4Q15 -13.5 0 -12.6L0 -10.2Q10.6 -10.8 9.2 -4.4Z" fill="' + gold + '"/>' +
        '<path d="M-1.3 -4.4L-1.3 -12.4H1.3L1.3 -4.4Z" fill="' + hi + '"/>' +
        '<circle cx="0" cy="-14.6" r="2.3" fill="' + hi + '"/>' +
        '<path class="ix-fine" d="M-0.5 -19.6H0.5V-18.4H1.7V-17.4H0.5V-16.4H-0.5V-17.4H-1.7V-18.4H-0.5Z" fill="' + hi + '"/>';
    }
    s += '<rect x="-12.4" y="-4.6" width="24.8" height="4.8" rx=".8" fill="' + gold + '"/>' +
      '<path d="M-12.4 -3.9H12.4" stroke="' + hi + '" stroke-width=".7" fill="none"/>';
    const xs = need.length === 2 ? [-5, 5] : [-7, 0, 7];
    need.forEach((c, i) => {
      s += '<path d="' + lozenge(xs[i], -2.2, 1.7) + '" fill="' + T[c] + '" stroke-width=".3"/>';
    });
    return s;
  }

  /** 조건 사각형의 면 색: 칩·보너스와 같은 밝기 단계(흰 > 초록 > 빨강 > 파랑 > 검정) @type {Record<Color, string>} */
  const REQ_FILL = { w: '#f6f4ec', u: '#193ca8', g: '#22ad6e', r: '#d32a3d', k: '#191a1e' };

  /** @param {NobleDef} def @param {number} idx @param {Color[]} need */
  function nobleArt(def, idx, need) {
    const cloth = [ramp(WOOD, 0.2), ramp(STONE, 0.24), ramp(WOOD, 0.14), ramp(STONE, 0.3)][idx % 4];
    const pale = ramp(WOOD, 0.92), ink = '#120c06';
    const bp = pstr(BANNER);
    let s = '';
    /* 깃발 천: 두께 → 바탕 → 세로 주름 → 왼쪽 정보 띠 → 술 장식 */
    s += '<polygon points="' + pstr(BANNER.map((p) => [p[0] + 0.6, p[1] + 2])) + '" fill="#0a0704"/>' +
      '<polygon points="' + bp + '" fill="' + cloth + '"/><polygon points="' + bp + '" fill="url(#ix-gr1)"/>' +
      '<polygon class="ix-fine" points="' + bp + '" fill="url(#ix-fold)"/>' +
      '<g clip-path="url(#ix-bannerclip)"><rect x="7" y="9" width="24.5" height="106" fill="#0d0a07" opacity=".62"/>' +
      '<path d="M31.5 9V115" stroke="' + pale + '" stroke-width=".7" opacity=".85"/><path d="M32.5 9V115" stroke="' + ink + '" stroke-width=".5"/></g>' +
      '<polygon points="' + pstr([[8.6, 10.6], [91.4, 10.6], [91.4, 108.2], [50, 97.6], [8.6, 108.2]]) + '" fill="none" stroke="' + pale + '" stroke-width=".7" opacity=".8"/>' +
      '<path class="ix-fine" d="M7 111L50 100L93 111" fill="none" stroke="#d9b352" stroke-width="2.6" stroke-dasharray=".9 1.1" transform="translate(0 1.6)"/>' +
      '<polygon points="' + bp + '" fill="none" stroke="' + ink + '" stroke-width=".7" stroke-linejoin="round"/>';
    /* 금박 가로대, 고리, 술 */
    s += '<g stroke="' + ink + '" stroke-width=".5">';
    for (const x of [14, 32, 50, 68, 86]) s += '<rect class="ix-fine" x="' + (x - 3.2) + '" y="2.4" width="6.4" height="8.4" rx="1" fill="' + cloth + '"/>';
    s += '<rect x="1.5" y="3.6" width="97" height="5" rx="2.2" fill="url(#ix-gilt)"/>' +
      '<circle cx="3.4" cy="6.1" r="3.3" fill="url(#ix-gilt)"/><circle cx="96.6" cy="6.1" r="3.3" fill="url(#ix-gilt)"/>' +
      '<g class="ix-fine"><path d="M3.4 9.4V18M96.6 9.4V18" fill="none" stroke="#d9b352" stroke-width=".9"/>' +
      '<path d="M3.4 17.2L5.6 26.5H1.2ZM96.6 17.2L98.8 26.5H94.4Z" fill="#d9b352"/><circle cx="3.4" cy="17.6" r="1.4" fill="#f6e2a0"/><circle cx="96.6" cy="17.6" r="1.4" fill="#f6e2a0"/></g>' +
      '</g>';
    /* 문장: 망토 → 방패 → 관 → 좌우명 띠 */
    s += '<g transform="translate(62.5 55)" stroke="' + ink + '" stroke-width=".5" stroke-linejoin="round">' +
      '<path d="M-17 -25Q0 -32 17 -25C23 -18 27.5 -4 28 14C23 22 15 26.5 9 27.5L0 21L-9 27.5C-15 26.5 -23 22 -28 14C-27.5 -4 -23 -18 -17 -25Z" fill="#b89546" transform="scale(1.07)"/>' +
      '<path d="M-17 -25Q0 -32 17 -25C23 -18 27.5 -4 28 14C23 22 15 26.5 9 27.5L0 21L-9 27.5C-15 26.5 -23 22 -28 14C-27.5 -4 -23 -18 -17 -25Z" fill="' + ramp(WOOD, 0.985) + '"/>' +
      '<path d="M-17 -25Q0 -32 17 -25C23 -18 27.5 -4 28 14C23 22 15 26.5 9 27.5L0 21L-9 27.5C-15 26.5 -23 22 -28 14C-27.5 -4 -23 -18 -17 -25Z" fill="url(#ix-sc-o)" stroke="none" opacity=".55"/>';
    /* 담비 꼬리 무늬 */
    let erm = '';
    for (const p of [[-22.5, -6], [-23.5, 7], [-19, 17], [22.5, -6], [23.5, 7], [19, 17], [-18.5, -17], [18.5, -17], [-12, 22], [12, 22]]) {
      erm += 'M' + f(p[0]) + ' ' + f(p[1] - 1.4) + 'L' + f(p[0] + 1.1) + ' ' + f(p[1] + 2.4) + 'L' + f(p[0]) + ' ' + f(p[1] + 1.6) + 'L' + f(p[0] - 1.1) + ' ' + f(p[1] + 2.4) + 'Z' +
        ell(p[0], p[1] - 2.2, 0.55) + ell(p[0] - 1.3, p[1] - 1.4, 0.5) + ell(p[0] + 1.3, p[1] - 1.4, 0.5);
    }
    s += '<path class="ix-fine" d="' + erm + '" fill="#17130e" stroke="none"/>';
    s += '<path d="' + SHIELD + '" fill="#000" opacity=".45" stroke="none" transform="translate(1.2 1.8)"/>' +
      '<path d="' + SHIELD + '" fill="url(#ix-gilt)" stroke-width=".7"/>' +
      '<g transform="scale(.89)"><g clip-path="url(#ix-shieldclip)" stroke-width=".45">' + arms(idx, need) +
      '<rect x="-24" y="-30" width="48" height="60" fill="url(#ix-gr' + (idx % 6) + ')" stroke="none"/>' +
      '<rect x="-24" y="-30" width="48" height="60" fill="url(#ix-shieldsh)" stroke="none"/></g>' +
      '<path d="' + SHIELD + '" fill="none" stroke-width=".6"/></g>';
    s += '<g transform="translate(0 -26.4)">' + crown(idx % 3, need) + '</g>';
    s += '<g><path d="M-21 29.4L-27 26.6L-25.4 31.4L-27.6 35.4L-21 36.6Z" fill="' + ramp(WOOD, 0.62) + '"/><path d="M21 29.4L27 26.6L25.4 31.4L27.6 35.4L21 36.6Z" fill="' + ramp(WOOD, 0.62) + '"/>' +
      '<path d="M-21.5 29.2Q0 36 21.5 29.2L21.5 37Q0 43.8 -21.5 37Z" fill="' + ramp(WOOD, 0.96) + '"/>' +
      '<text class="ix-noble__motto ix-fine" stroke="none" text-anchor="middle" style="font-size:' + f(Math.min(5, 33 / MOTTOS[idx % MOTTOS.length].length)) + 'px"><textPath href="#ix-mottopath" startOffset="50%">' + MOTTOS[idx % MOTTOS.length] + '</textPath></text></g>' +
      '</g>';
    /* 점수 3: 왼쪽 위, 틀 없는 큰 숫자 */
    const t = String(def.points);
    s += '<svg x="6.2" y="11" width="26" height="26" viewBox="0 0 40 40">' +
      '<text x="21.2" y="35" text-anchor="middle" class="ix-num__s">' + t + '</text>' +
      '<text x="20" y="33" text-anchor="middle" class="ix-num__o">' + t + '</text>' +
      '<text x="20" y="33" text-anchor="middle" class="ix-num__f">' + t + '</text></svg>';
    /* 조건: 모서리 둥근 사각형(작은 카드), 아래에서부터 쌓는다 */
    const q = 20.4, gap = 2.3, x0 = 9.2;
    let y = 103.4 - need.length * q - (need.length - 1) * gap;
    for (const c of need) {
      const fill = REQ_FILL[c];
      const edge = c === 'w' ? '#7d8694' : c === 'k' ? '#8a8d98' : DYE[c][4];
      s += '<g class="ix-noble__req" data-color="' + c + '">' +
        '<rect x="' + (x0 + 1.5) + '" y="' + f(y - 1.2) + '" width="' + q + '" height="' + q + '" rx="3.4" fill="' + (c === 'w' ? '#aeb5c0' : DYE[c][0]) + '" stroke="' + ink + '" stroke-width=".4"/>' +
        '<rect x="' + x0 + '" y="' + f(y) + '" width="' + q + '" height="' + q + '" rx="3.4" fill="' + fill + '" stroke="' + ink + '" stroke-width=".5"/>' +
        '<rect x="' + x0 + '" y="' + f(y) + '" width="' + q + '" height="' + q + '" rx="3.4" fill="url(#ix-reqsh)"/>' +
        '<rect x="' + (x0 + 1.5) + '" y="' + f(y + 1.5) + '" width="' + (q - 3) + '" height="' + (q - 3) + '" rx="2.2" fill="none" stroke="' + edge + '" stroke-width=".7" opacity=".9"/>' +
        '<text x="' + (x0 + q / 2) + '" y="' + f(y + q / 2 + 5.6) + '" text-anchor="middle" class="ix-noble__reqn ix-noble__reqn--' + c + '">' + def.require[c] + '</text></g>';
      y += q + gap;
    }
    return s;
  }

  /** @type {Map<string, HTMLElement>} */
  const nobleCache = new Map();

  /** 귀족 타일. 폭은 --noble-w. @param {NobleDef} def @returns {HTMLElement} */
  function noble(def) {
    ensureDefs();
    const hit = nobleCache.get(def.id);
    if (hit) return /** @type {HTMLElement} */ (hit.cloneNode(true));
    const need = COLORS.filter((c) => def.require[c] > 0);
    const idx = parseInt(def.id.replace(/\D/g, ''), 10) || 0;
    const el = h('div', 'ix-noble');
    el.setAttribute('data-noble-id', def.id);
    const body = h('div', 'ix-noble__body');
    body.appendChild(svg('0 0 100 115', 'ix-noble__art', nobleArt(def, idx % 10, need)));
    el.appendChild(body);
    nobleCache.set(def.id, el);
    return /** @type {HTMLElement} */ (el.cloneNode(true));
  }

  /* ═════════════ 8. 승자 메달 ═════════════
   * 놋쇠 테두리 안에 결 다른 나무 조각으로 짠 별(나침반 장미)과 월계관을 박은 메달 + V자 비단 리본 + 나무·놋쇠 이름판.
   * 그림 좌표 100×146: 위 0~56 리본과 걸쇠, 아래 원판(가운데 50,98 반지름 46). 이름판은 HTML(글자 크기를 이름 길이에 맞춘다).
   */

  /** @type {string|null} */
  let medalSvg = null;

  /** 메달 그림(모든 메달이 같다, 한 번 만들어 둔다) */
  function medalArt() {
    if (medalSvg) return medalSvg;
    const cx = 50, cy = 98, ink = '#140d06';
    const W = (/** @type {number} */ l) => ramp(WOOD, l);
    let s = '';
    /* ── 리본: 두 가닥이 원판 뒤에서 V 로 만난다. 채도 낮춘 올리브 벨벳 + 상아 실선 + 놋쇠빛 비단 가운데 줄 ── */
    const velvet = '#353a2b', velvet2 = '#2a2e22', silk = '#b79a55', ivory = '#e4d9bd';
    /** @param {number[][]} q 왼위, 오른위, 오른아래, 왼아래 @param {boolean} front */
    const strap = (q, front) => {
      const bands = [[0, 0.28, velvet], [0.28, 0.34, ivory], [0.34, 0.66, silk], [0.66, 0.72, ivory], [0.72, 1, velvet]];
      /** @param {number[]} a @param {number[]} b @param {number} t */
      const lp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      let o = '';
      for (const b of bands) {
        o += '<path d="' + poly([lp(q[0], q[1], /** @type {number} */ (b[0])), lp(q[0], q[1], /** @type {number} */ (b[1])), lp(q[3], q[2], /** @type {number} */ (b[1])), lp(q[3], q[2], /** @type {number} */ (b[0]))]) + '" fill="' + b[2] + '"/>';
      }
      o += '<path d="' + poly(q) + '" fill="url(#ix-ribsheen)"/>' +
        '<path d="' + poly(q) + '" fill="url(#ix-sc-' + (front ? 'b' : 'br') + ')"/>' +
        '<path d="' + poly(q) + '" fill="none" stroke="' + ink + '" stroke-width=".5"/>';
      return o;
    };
    s += '<g stroke="none">' + strap([[17, 7], [41, 7], [61, 66], [37, 66]], false) +
      '<path d="' + poly([[45, 40], [56, 40], [61, 66], [42, 66]]) + '" fill="#000" opacity=".28"/>' +
      strap([[59, 7], [83, 7], [63, 66], [39, 66]], true) + '</g>';
    /* 걸쇠: 놋쇠 막대 */
    s += '<g stroke="' + ink + '" stroke-width=".5">' +
      '<rect x="12" y="1.4" width="76" height="7" rx="3.2" fill="url(#ix-gilt)"/>' +
      '<path d="M15 3.4H85" stroke="#fbeec0" stroke-width=".7" fill="none" opacity=".8"/>' +
      '<circle cx="12.6" cy="4.9" r="3.9" fill="url(#ix-gilt)"/><circle cx="87.4" cy="4.9" r="3.9" fill="url(#ix-gilt)"/>' +
      '</g>';
    /* ── 원판 ── */
    s += '<circle cx="' + (cx + 1.6) + '" cy="' + (cy + 4.4) + '" r="46.4" fill="#000" opacity=".45"/>' +
      '<circle cx="' + cx + '" cy="' + (cy + 2.8) + '" r="46" fill="#5a420e"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="46" fill="url(#ix-mdrim)"/>' +
      /* 꼰 줄 무늬 테 */
      '<circle cx="' + (cx + 0.4) + '" cy="' + (cy + 0.5) + '" r="42.6" fill="none" stroke="#6b4f12" stroke-width="2.6" stroke-dasharray="2.4 1.1"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="42.6" fill="none" stroke="#f7e3a0" stroke-width="2.1" stroke-dasharray="2.4 1.1"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="39.8" fill="none" stroke="url(#ix-mdbevel)" stroke-width="1.6"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="46" fill="none" stroke="' + ink + '" stroke-width=".8"/>';
    /* 상감 바탕: 호두나무 + 테두리 실선 */
    s += '<g stroke="' + ink + '" stroke-width=".4" stroke-linejoin="round">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="38.8" fill="' + W(0.24) + '"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="38.8" fill="url(#ix-gr2)" stroke="none"/>' +
      (() => {
        /* 바둑판 띠 상감: 밝은 나무·흑단을 번갈아 */
        let lt = '', dk = '';
        const n = 56;
        for (let i = 0; i < n; i++) {
          const t0 = i / n * Math.PI * 2, t1 = (i + 1) / n * Math.PI * 2;
          const q = poly([[cx + 36.6 * Math.cos(t0), cy + 36.6 * Math.sin(t0)], [cx + 38.8 * Math.cos(t0), cy + 38.8 * Math.sin(t0)],
            [cx + 38.8 * Math.cos(t1), cy + 38.8 * Math.sin(t1)], [cx + 36.6 * Math.cos(t1), cy + 36.6 * Math.sin(t1)]]);
          if (i % 2) dk += q; else lt += q;
        }
        return '<path d="' + lt + '" fill="' + W(0.94) + '" stroke="none"/><path d="' + dk + '" fill="' + W(0.06) + '" stroke="none"/>';
      })() +
      '<circle cx="' + cx + '" cy="' + cy + '" r="36.4" fill="none" stroke="' + ink + '" stroke-width=".5"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="38.8" fill="url(#ix-mdwell)" stroke="none"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="26.4" fill="' + W(0.14) + '" stroke="' + W(0.8) + '" stroke-width=".8"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="26.4" fill="url(#ix-gr3)" stroke="none"/>';
    /* 월계관: 양쪽 가지, 잎마다 밝은 반쪽·그을린 반쪽 */
    let stems = '', leaves = '';
    for (const side of [-1, 1]) {
      const a0 = 104, a1 = 250, n = 9;
      /* 왼가지 각도를 오른가지로 뒤집는다 */
      /** @param {number} a @param {number} r */
      const at = (a, r) => { const t = a * Math.PI / 180, x = r * Math.cos(t), y = r * Math.sin(t); return [cx + (side < 0 ? x : -x), cy + y]; };
      stems += 'M' + at(a0, 31.6).map(f).join(' ');
      for (let a = a0 + 6; a <= a1 + 4; a += 6) stems += 'L' + at(a, 31.6).map(f).join(' ');
      for (let k = 0; k < n; k++) {
        const a = a0 + 6 + k * (a1 - a0 - 10) / (n - 1);
        for (const off of [-1, 1]) {
          if (k === n - 1 && off > 0) continue;
          const base = at(a, 31.6 + off * 0.8);
          const tipA = a + 10, tipR = 31.6 + off * 4.4;
          const tip = at(tipA, tipR);
          const mx = (base[0] + tip[0]) / 2, my = (base[1] + tip[1]) / 2;
          const dx = tip[0] - base[0], dy = tip[1] - base[1], len = Math.hypot(dx, dy);
          const nx = -dy / len * 3.6, ny = dx / len * 3.6;
          const half1 = 'M' + f(base[0]) + ' ' + f(base[1]) + 'Q' + f(mx + nx) + ' ' + f(my + ny) + ' ' + f(tip[0]) + ' ' + f(tip[1]) + 'Z';
          const half2 = 'M' + f(base[0]) + ' ' + f(base[1]) + 'Q' + f(mx - nx) + ' ' + f(my - ny) + ' ' + f(tip[0]) + ' ' + f(tip[1]) + 'Z';
          const lightFirst = (side < 0) === (off < 0);
          leaves += '<path d="' + half1 + '" fill="' + W(lightFirst ? 0.95 : 0.7) + '"/>' +
            '<path d="' + half2 + '" fill="' + W(lightFirst ? 0.72 : 0.93) + '"/>';
        }
      }
    }
    s += '<path d="' + stems + '" fill="none" stroke="' + W(0.62) + '" stroke-width="1.2"/><g stroke-width=".25">' + leaves + '</g>';
    /* 나침반 장미 별: 짧은 꼭지 8 → 중간 4 → 긴 4, 꼭지마다 밝은 반·어두운 반 */
    /** @param {number} a 도 @param {number} r 꼭지 길이 @param {number} w 밑동 반폭(도) @param {number} hi @param {number} lo */
    const point = (a, r, w, hi, lo) => {
      const t = (a - 90) * Math.PI / 180, tl = (a - 90 - w) * Math.PI / 180, tr = (a - 90 + w) * Math.PI / 180;
      const tip = [cx + r * Math.cos(t), cy + r * Math.sin(t)];
      const bl = [cx + 5.6 * Math.cos(tl), cy + 5.6 * Math.sin(tl)], br = [cx + 5.6 * Math.cos(tr), cy + 5.6 * Math.sin(tr)];
      /* 빛은 왼위에서: 꼭지 방향에 따라 어느 반쪽이 밝은지 바꾼다 */
      const leftLit = Math.sin(t + Math.PI / 4) >= 0;
      const a1 = poly([[cx, cy], bl, tip]), a2 = poly([[cx, cy], tip, br]);
      return '<path d="' + a1 + '" fill="' + W(leftLit ? hi : lo) + '"/><path d="' + a2 + '" fill="' + W(leftLit ? lo : hi) + '"/>' +
        '<path d="' + a1 + a2 + '" fill="url(#ix-gr1)" stroke="none"/>';
    };
    for (let i = 0; i < 8; i++) s += point(22.5 + i * 45, 14.5, 30, 0.62, 0.36);
    for (let i = 0; i < 4; i++) s += point(45 + i * 90, 20.5, 34, 0.84, 0.5);
    for (let i = 0; i < 4; i++) s += point(i * 90, 26, 34, 0.99, 0.66);
    /* 가운데 놋쇠 꼭지(별 새김) */
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="6.4" fill="url(#ix-gilt)"/>' +
      '<path d="' + star5(cx, cy + 0.3, 3.8) + '" fill="#7a5a14" stroke="none" transform="translate(.4 .5)"/>' +
      '<path d="' + star5(cx, cy + 0.3, 3.8) + '" fill="#fbe9a6" stroke="none"/>' +
      '</g>';
    /* 니스 광택(원판 안) */
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="38.8" fill="url(#ix-varnish)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="46" fill="url(#ix-mdgloss)"/>';
    /* 빛 스침 */
    s += '<g clip-path="url(#ix-medalclip)"><polygon class="ix-gem__glint" points="-36,40 -16,40 -46,150 -66,150" fill="url(#ix-glintfill)"/></g>';
    medalSvg = s;
    return s;
  }

  function medalDefs() {
    return '<clipPath id="ix-medalclip"><circle cx="50" cy="98" r="46"/></clipPath>' +
      lin('ix-mdrim', [0, 0, 1, 1], [[0, '#fff2bf'], [0.3, '#e1bd5e'], [0.62, '#b48a2d'], [1, '#7a5813']]) +
      lin('ix-mdbevel', [0, 0, 1, 1], [[0, '#6b4f12'], [0.5, '#a9842e'], [1, '#fbe7a4']]) +
      rad('ix-mdgloss', [0.3, 0.22, 0.6], [[0, '#fff', 0.32], [0.5, '#fff', 0.06], [1, '#fff', 0]]) +
      lin('ix-mdwell', [0, 0, 0, 1], [[0, '#000', 0.5], [0.22, '#000', 0], [0.85, '#fff', 0], [1, '#fff', 0.1]]) +
      lin('ix-ribsheen', [0, 0, 1, 1], [[0, '#fff', 0.2], [0.45, '#fff', 0.03], [1, '#000', 0.2]]);
  }

  /** 글자 폭 어림(한글·한자 1em, 그 밖 0.6em) @param {string} t */
  function textEm(t) {
    let w = 0;
    for (const ch of t) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 1 : 0.62;
    return w;
  }

  /**
   * 판 끝 승자 메달: 리본 달린 상감 메달 + 아래 이름판(이름·점수·산 카드 수). px 는 메달 지름.
   * 자리 폭은 이름판에 따라 px×1.3~1.62, 높이는 약 px×2.0. shared 면 class 'is-shared'(나란히 여러 개).
   * @param {{name:string, score:number, cards:number, shared:boolean, px:number}} o @returns {HTMLElement}
   */
  function medal(o) {
    ensureDefs();
    const px = o.px || 160;
    const name = String(o.name || '').slice(0, 12);
    const el = h('div', 'ix-medal' + (o.shared ? ' is-shared' : ''));
    el.style.setProperty('--px', px + 'px');
    el.setAttribute('data-score', String(o.score));
    el.setAttribute('data-cards', String(o.cards));
    const art = svg('0 0 100 146', 'ix-medal__art', medalArt());
    el.appendChild(art);
    /* 이름: 기본 크기는 px×0.15, 이름판 안쪽 최대 폭 px×1.42 를 넘으면 줄인다(가장 작아도 px×0.1) */
    const em = Math.max(1, textEm(name));
    const size = Math.max(px * 0.1, Math.min(px * 0.15, px * 1.42 / em));
    const nm = h('div', 'ix-medal__name', name);
    nm.style.fontSize = f(size) + 'px';
    const score = h('div', 'ix-medal__score', numeral(o.score, 'ix-medal__pts'), h('span', 'ix-medal__unit', '점'));
    const cards = h('div', 'ix-medal__cards', '카드 ' + o.cards + '장');
    el.appendChild(h('div', 'ix-medal__plate', nm, score, cards));
    return el;
  }

  /* ═════════════ 등록 ═════════════ */

  const prev = G.Zap.skins.intarsia;
  /* SkinAPI(design/skin-api.js) 의 모든 항목. */
  const api = {
    id: 'intarsia',
    label: '상감풍',
    cssClass: 'skin-intarsia',
    fontCss: (prev && prev.fontCss) || '',
    card, deck, cardBack, emptySlot, noble, gem, costChip, chipStack, bonusTile, pointsBadge, medal,
  };
  G.Zap.skins.intarsia = api;
  if (typeof document !== 'undefined') {
    ensureTextures();
    if (document.body) ensureDefs();
    else document.addEventListener('DOMContentLoaded', ensureDefs);
  }
})();
