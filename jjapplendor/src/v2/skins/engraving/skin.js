// @ts-check
// 생성됨: tools/sync-v2.js 가 design/ 에서 복사한 파일 — 직접 고치지 말 것(원본을 고친 뒤 다시 복사).
/*
 * 짭플렌더 v2 시안 — 판화풍 스킨 (Zap.skins.engraving)
 *
 * 동판·목판화처럼 잉크 선을 겹쳐 명암을 내는 삽화, 양피지 카드, 호두나무 탁자, 금박 테두리.
 * 채도 높은 색은 보석 색에만 쓴다: 삽화에서는 "색을 맡은 물건"(1단계 결정, 2단계 염색한 천, 3단계 차양·깃발·벨벳)만 칠한다.
 *
 * 파일: skin.js(이 파일, 그림 전부) · skin.css(모양) · fonts.js(글꼴 data URI, tools/build-fonts.cjs 가 생성. 이 파일 앞뒤 어디서 불러도 됨).
 * 약속은 design/skin-api.js 의 SkinAPI. 모든 함수는 값을 받아 DOM 요소를 돌려주고 동작은 부르는 쪽이 붙인다.
 * 공통 그라데이션·무늬·보석 원본은 문서에 한 번만 넣는 숨은 <svg id="eg-defs"> 에 두고 각 그림은 <use> 와 url(#…) 로 가져다 쓴다.
 *
 * 셸이 알아 둘 것
 *  - 'is-glint' 는 보석 요소뿐 아니라 그 조상(카드, 칩 더미)에 붙여도 안의 보석에 빛이 한 번 스친다. 다시 재생하려면 뗐다 붙인다.
 *  - 카드는 :hover(마우스가 있는 기기)와 .is-lifted 에서 들린다. 뒷면 카드는 .is-lifted 만.
 *  - 칩 더미: --stack-dir(column 기본 | row)로 숫자를 아래/옆에, --stack-max(기본 7)로 더미 자리 높이, --stack-ink 로 숫자 색을 바꿀 수 있다(부모에 지정).
 *  - 테마 값은 skin-api.js 의 것 외에 --table-ink / --table-ink-soft(탁자 위 글자색)를 더 준다. --ink 는 --panel 위 글자색.
 *  - 색 검사 결과는 color-check.json, color-check-result.js(Zap.skins._engravingColorCheck).
 *
 * 차례: 1 도우미 · 2 색 · 3 공유 defs(보석 포함) · 4 보석/칩/작은 부품 · 5 삽화 · 6 카드/덱 · 7 귀족 · 7½ 승자 메달 · 8 등록
 */
(function () {
  const G = /** @type {any} */ (globalThis);
  G.Zap = G.Zap || {};
  G.Zap.skins = G.Zap.skins || {};
  const NS = 'http://www.w3.org/2000/svg';

  /* ───────────── 1. 도우미 ───────────── */

  /** @param {string} cls @param {string} [text] @returns {HTMLElement} */
  function d(cls, text) {
    const e = document.createElement('div');
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /** @param {string} cls @param {string} viewBox @param {string} inner @returns {SVGSVGElement} */
  function svgEl(cls, viewBox, inner) {
    const s = /** @type {SVGSVGElement} */ (document.createElementNS(NS, 'svg'));
    s.setAttribute('class', cls);
    s.setAttribute('viewBox', viewBox);
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = inner;
    return s;
  }

  /** 소수 한 자리로 줄인 좌표 글자 @param {number} n */
  function f(n) { return String(Math.round(n * 10) / 10); }
  /** 점 목록 → "x,y x,y" @param {number[][]} pts */
  function pp(pts) { return pts.map((p) => f(p[0]) + ',' + f(p[1])).join(' '); }

  /** @param {string} str @returns {number} */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  /** 씨앗으로 정해지는 난수(같은 카드는 늘 같은 그림) @param {number} seed @returns {() => number} */
  function prng(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** @param {string} h @returns {number[]} */
  function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  /** @param {string} a @param {string} b @param {number} t @returns {string} */
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    let s = '#';
    for (let i = 0; i < 3; i++) s += Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0');
    return s;
  }
  /** 여러 단계 색 사이를 t(0~1)로 고름 @param {string[]} stops @param {number} t */
  function ramp(stops, t) {
    const x = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
    const i = Math.floor(x);
    return mix(stops[i], stops[i + 1], x - i);
  }

  /* ───────────── 2. 색 ───────────── */

  const INK = '#2e2018';
  /**
   * 보석 색 단계(어두움 → 밝음). 채도 높은 색은 여기에만 있다.
   * 흑백에서도 여섯 색이 갈리도록 보석·칩의 평균 밝기(CIELAB L*)를 사다리로 맞춘다:
   * 흰 ≥ 약 88 · 황금 72 · 초록 60 · 빨강 46 · 파랑 32 · 검정 ≤ 18 (tools/lum-check.cjs 로 잰다).
   * @type {Record<string, string[]>}
   */
  const GEM = {
    w: ['#5a636c', '#8b959e', '#c2cad1', '#e9edf0', '#ffffff'],
    u: ['#06153f', '#0d2678', '#173fae', '#3f77e4', '#a9c9ff'],
    g: ['#064a2a', '#0e7541', '#1ea55a', '#52cf8d', '#c2f7da'],
    r: ['#5c0911', '#a81824', '#da3038', '#f66a61', '#ffc9be'],
    k: ['#040405', '#0e0d10', '#1c1a20', '#3a373f', '#85828e'],
    gold: ['#6f4c0c', '#bd8e26', '#e8bc44', '#f9df7c', '#fff8cf'],
  };
  /** 삽화에서 "색을 맡은 물건"에 쓰는 색: [가장 어두움, 그늘, 본색, 밝은 면, 하이라이트] @type {Record<string, string[]>} */
  const DYE = {
    w: ['#8d8a80', '#c9c5b6', '#f4f0e2', '#fdfbf3', '#ffffff'],
    u: ['#0b2466', '#153a9c', '#1f55c8', '#4c84ea', '#a9c8fb'],
    g: ['#06401f', '#0d6235', '#168a4c', '#3db878', '#a3e6c0'],
    r: ['#5a0a10', '#931520', '#c5222c', '#e8514c', '#fbb0a4'],
    k: ['#060506', '#121113', '#1f1d20', '#3b383d', '#7e7a82'],
  };

  /* ───────────── 3. 공유 defs ───────────── */

  /** 보석 윤곽(그림자·빛 스침 자르기에 같이 씀) @type {Record<string, string>} */
  const SHAPE = {
    w: '<polygon points="50,5 95,50 50,95 5,50"',
    u: '<ellipse cx="50" cy="50" rx="35" ry="45"',
    g: '<polygon points="20,17 80,17 97,34 97,66 80,83 20,83 3,66 3,34"',
    r: '<circle cx="50" cy="50" r="45"',
    k: '<polygon points="50,4 89.8,27 89.8,73 50,96 10.2,73 10.2,27"',
    gold: '<circle cx="50" cy="50" r="46"',
  };

  /** 바닥에 떨어지는 부드러운 그림자(필터 없이 윤곽을 세 번 겹침) @param {string} c */
  function gemShadow(c) {
    return SHAPE[c] + ' transform="translate(1.5 3)" fill="#000" opacity=".22"/>' +
      SHAPE[c] + ' transform="translate(3 6)" fill="#000" opacity=".13"/>' +
      SHAPE[c] + ' transform="translate(4.5 9)" fill="#000" opacity=".07"/>';
  }
  /** @param {string} c @param {number} [w] */
  function gemOutline(c, w) {
    return SHAPE[c] + ' fill="none" stroke="' + (c === 'k' ? '#000' : INK) + '" stroke-width="' + (w || 2.6) + '" stroke-linejoin="round"/>';
  }
  /** @param {number[][]} pts @param {string} fill */
  function facet(pts, fill) {
    return '<polygon points="' + pp(pts) + '" fill="' + fill + '" stroke="' + fill + '" stroke-width=".4" stroke-linejoin="round"/>';
  }

  /** 흰 — 테이블 컷 다이아몬드(마름모) */
  function symDiamond() {
    const W = GEM.w;
    const T = [50, 5], R = [95, 50], B = [50, 95], L = [5, 50];
    const t = [50, 28], r = [72, 50], b = [50, 72], l = [28, 50], c = [50, 50];
    let s = gemShadow('w');
    s += facet([T, t, l], '#ffffff') + facet([T, l, L], '#f8fafb');
    s += facet([T, r, t], '#eef2f5') + facet([T, R, r], '#e1e7ec');
    s += facet([L, l, b], '#dde3e8') + facet([L, b, B], '#cdd4db');
    s += facet([R, B, b], '#b7bfc7') + facet([R, b, r], '#c8cfd6');
    // 테이블: 아래 면이 비쳐 보이는 네 삼각 + 가운데 큘렛
    s += facet([t, r, c], '#f8fafb') + facet([r, b, c], '#dfe5ea') + facet([b, l, c], '#edf1f4') + facet([l, t, c], '#ffffff');
    s += facet([[50, 40], [60, 50], [50, 60], [40, 50]], '#ccd4db');
    s += facet([[50, 40], [60, 50], [50, 50]], '#f4f7f9') + facet([[40, 50], [50, 50], [50, 60]], '#bfc7ce');
    s += '<polygon points="' + pp([t, r, b, l]) + '" fill="none" stroke="#fff" stroke-width="1.4" opacity=".9"/>';
    s += '<g fill="none" stroke="' + W[0] + '" stroke-width=".6" opacity=".4"><path d="M50 5V28M95 50H72M50 95V72M5 50H28M28 50 72 50M50 28V72"/><polygon points="' + pp([t, r, b, l]) + '"/></g>';
    // 반짝임
    s += '<path d="M33 20l2.2 9.8 9.8 2.2-9.8 2.2L33 44l-2.2-9.8L21 32l9.8-2.2z" fill="#fff"/>';
    s += '<path d="M72 62l1.2 4.8 4.8 1.2-4.8 1.2L72 74l-1.2-4.8L66 68l4.8-1.2z" fill="#fff" opacity=".9"/>';
    s += SHAPE.w + ' fill="none" stroke="#5f5a55" stroke-width="2.200" stroke-linejoin="round"/>';
    return s;
  }

  /** 파랑 — 세로 타원 카보숑 사파이어 */
  function symSapphire() {
    let s = gemShadow('u');
    s += SHAPE.u + ' fill="url(#eg-g-u)"/>';
    // 돔 가장자리의 어두운 띠와 아래쪽으로 스미는 빛
    s += SHAPE.u + ' fill="url(#eg-g-u2)"/>';
    // 별빛(성채) 아주 옅게
    s += '<ellipse cx="58" cy="66" rx="22" ry="26" fill="url(#eg-g-u3)"/>';
    // 아래 오른쪽 테두리 빛
    s += '<path d="M79 68C72 86 58 93 46 92c14-2 25-10 33-24z" fill="#9cc2ff" opacity=".7"/>';
    // 창문 모양 하이라이트
    s += '<path d="M27 33C29 21 38 12 49 11c4-.3 8 2 5 5-6 6-13 10-18 22-2 4-10 1-9-5z" fill="#fff" opacity=".88"/>';
    s += '<ellipse cx="34" cy="50" rx="2.6" ry="4" fill="#fff" opacity=".7"/>';
    s += gemOutline('u');
    return s;
  }

  /** 초록 — 가로로 긴 팔각 스텝 컷 에메랄드 */
  function symEmerald() {
    const C = GEM.g;
    /** @param {number} k 안쪽으로 들어간 정도 @returns {number[][]} */
    const oct = (k) => {
      const x0 = 3 + k, x1 = 97 - k, y0 = 17 + k, y1 = 83 - k, cut = 17 - k * 0.42;
      return [[x0 + cut, y0], [x1 - cut, y0], [x1, y0 + cut], [x1, y1 - cut], [x1 - cut, y1], [x0 + cut, y1], [x0, y1 - cut], [x0, y0 + cut]];
    };
    const o = oct(0), m = oct(9), n = oct(18), tb = oct(25);
    // 변 순서: 위, 오른위 모서리, 오른쪽, 오른아래, 아래, 왼아래, 왼쪽, 왼위
    const s1 = [0.88, 0.66, 0.44, 0.22, 0.3, 0.5, 0.74, 1.0];
    const s2 = [0.68, 0.84, 0.58, 0.34, 0.18, 0.4, 0.58, 0.92];
    const s3 = [0.78, 0.58, 0.48, 0.28, 0.4, 0.66, 0.86, 0.96];
    let s = gemShadow('g');
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8;
      s += facet([o[i], o[j], m[j], m[i]], ramp(C, s1[i]));
      s += facet([m[i], m[j], n[j], n[i]], ramp(C, s2[i]));
      s += facet([n[i], n[j], tb[j], tb[i]], ramp(C, s3[i]));
    }
    s += '<polygon points="' + pp(tb) + '" fill="url(#eg-g-g)"/>';
    // 테이블에 비친 빛 줄기
    s += '<polygon points="28,54 28,47 37,42 55,42 34,58" fill="#d8ffe9" opacity=".55"/>';
    s += '<polygon points="60,58 72,46 72,52 66,58" fill="#d8ffe9" opacity=".3"/>';
    s += '<g fill="none" stroke="' + C[0] + '" stroke-width=".6" opacity=".5">';
    for (const ring of [m, n, tb]) s += '<polygon points="' + pp(ring) + '"/>';
    for (let i = 0; i < 8; i++) s += '<path d="M' + f(o[i][0]) + ' ' + f(o[i][1]) + 'L' + f(tb[i][0]) + ' ' + f(tb[i][1]) + '"/>';
    s += '</g>';
    s += '<polygon points="' + pp([o[7], o[0], m[0], m[7]]) + '" fill="#fff" opacity=".75"/>';
    s += '<path d="M' + f(m[0][0]) + ' ' + f(m[0][1]) + 'L' + f(m[1][0]) + ' ' + f(m[1][1]) + '" stroke="#eafff3" stroke-width="1.2" opacity=".8"/>';
    s += gemOutline('g');
    return s;
  }

  /** 빨강 — 원형 로즈 컷 루비(삼각 면이 꼭대기로 모임) */
  function symRuby() {
    const C = GEM.r;
    const rnd = prng(77);
    const cx = 50, cy = 50, R = 44.5, r1 = 23;
    /** @type {number[][]} */ const inner = [];
    /** @type {number[][]} */ const outer = [];
    for (let i = 0; i < 6; i++) { const a = (i * 60 - 90) * Math.PI / 180; inner.push([cx + r1 * Math.cos(a), cy + r1 * Math.sin(a), 22]); }
    for (let i = 0; i < 12; i++) { const a = (i * 30 - 90) * Math.PI / 180; outer.push([cx + R * Math.cos(a), cy + R * Math.sin(a), 0]); }
    const apex = [cx - 2, cy - 2, 34];
    const Lx = -0.48, Ly = -0.64, Lz = 0.6;
    /** @param {number[]} a @param {number[]} b @param {number[]} c */
    const tri = (a, b, c) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const len = Math.hypot(nx, ny, nz);
      const lam = Math.max(0, (nx * Lx + ny * Ly + nz * Lz) / len);
      let t = 0.26 + 0.6 * Math.pow(lam, 1.4) + (rnd() - 0.5) * 0.28;
      if (lam > 0.93) t = 0.97;
      return facet([a, b, c], ramp(C, t));
    };
    let s = gemShadow('r');
    s += SHAPE.r + ' fill="' + C[1] + '"/>';
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      s += tri(inner[i], outer[2 * i], outer[2 * i + 1]);
      s += tri(inner[j], outer[2 * i + 1], outer[(2 * i + 2) % 12]);
      s += tri(inner[i], inner[j], outer[2 * i + 1]);
    }
    for (let i = 0; i < 6; i++) s += tri(apex, inner[i], inner[(i + 1) % 6]);
    s += SHAPE.r + ' fill="url(#eg-g-r)"/>';
    s += '<g fill="none" stroke="' + C[0] + '" stroke-width=".55" opacity=".45"><polygon points="' + pp(inner) + '"/>';
    for (let i = 0; i < 6; i++) s += '<path d="M' + f(apex[0]) + ' ' + f(apex[1]) + 'L' + f(inner[i][0]) + ' ' + f(inner[i][1]) + 'L' + f(outer[2 * i][0]) + ' ' + f(outer[2 * i][1]) + '"/>';
    s += '</g>';
    s += '<path d="M24 34C28 22 38 14 50 12c-9 5-16 12-20 24-1 3-7 1-6-2z" fill="#fff" opacity=".8"/>';
    s += '<path d="M83 66C76 82 62 90 48 90c14-3 26-10 35-24z" fill="#ffb9ae" opacity=".55"/>';
    s += '<path d="M47 44l1.4 4.6 4.6 1.4-4.6 1.4L47 56l-1.4-4.6L41 50l4.6-1.4z" fill="#fff" opacity=".95"/>';
    s += gemOutline('r');
    return s;
  }

  /** 검정 — 육각 음각 판 오닉스(카메오처럼 새긴 판, 흰 띠) */
  function symOnyx() {
    /** @param {number} R @returns {number[][]} */
    const hex = (R) => { const o = []; for (let i = 0; i < 6; i++) { const a = (i * 60 - 90) * Math.PI / 180; o.push([50 + R * Math.cos(a), 50 + R * Math.sin(a)]); } return o; };
    const o = hex(46), m = hex(36);
    // 변 순서: 오른위, 오른쪽, 오른아래, 왼아래, 왼쪽, 왼위
    const sh = ['#35323a', '#151418', '#050506', '#0a090b', '#25232a', '#66626d'];
    let s = gemShadow('k');
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; s += facet([o[i], o[j], m[j], m[i]], sh[i]); }
    s += '<polygon points="' + pp(m) + '" fill="url(#eg-g-k)"/>';
    // 비스듬한 광택
    s += '<polygon points="' + pp([m[5], [m[5][0] + 13, m[5][1] - 7.5], [m[3][0] - 13, m[3][1] - 7.5 + 0], m[4]]) + '" fill="#fff" opacity=".1"/>';
    s += '<polygon points="' + pp(hex(31)) + '" fill="none" stroke="#e4dfd2" stroke-width="1.200" opacity=".8"/>';
    // 음각 꽃무늬(여섯 잎): 밝은 아래 모서리 → 어두운 위 모서리 → 파낸 면
    let petals = '';
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 - 90) * Math.PI / 180;
      const x = 50 + 22 * Math.cos(a), y = 50 + 22 * Math.sin(a);
      petals += 'M50 50A22 22 0 0 1 ' + f(x) + ' ' + f(y) + 'A22 22 0 0 1 50 50Z';
    }
    s += '<path d="' + petals + '" transform="translate(.9 1.2)" fill="#cfcabd" opacity=".6"/>';
    s += '<path d="' + petals + '" transform="translate(-.7 -.9)" fill="#000"/>';
    s += '<path d="' + petals + '" fill="#45424b"/>';
    s += '<circle cx="50" cy="50" r="3.2" fill="#0b0a0d"/><circle cx="50.6" cy="50.8" r="3.2" fill="none" stroke="#cfcabd" stroke-width=".7" opacity=".7"/>';
    s += '<path d="M' + f(o[5][0]) + ' ' + f(o[5][1]) + 'L' + f(o[0][0]) + ' ' + f(o[0][1]) + '" stroke="#c9c5d2" stroke-width="1.4" opacity=".7" stroke-linecap="round"/>';
    s += '<g fill="none" stroke="#000" stroke-width=".6" opacity=".6"><polygon points="' + pp(m) + '"/></g>';
    s += gemOutline('k', 2.8);
    // 어두운 바탕에서도 윤곽이 보이게 바깥에 아주 가는 밝은 선
    s += '<polygon points="' + pp(hex(48.2)) + '" fill="none" stroke="#b9b3a4" stroke-width=".8" opacity=".55"/>';
    return s;
  }

  /** 백합 문양(피렌체 길리오 풍, 직접 그린 것). 가운데 50,50 기준 */
  const LILY =
    'M50 21C56 29 60 38 56 48H44C40 38 44 29 50 21Z' +
    'M43 48C42 41 38 35 31 35 24 35 20 41 22 47 23.500 51 29 52 30 48 30.500 45.500 27.500 44.500 27 47 26 42 30 40 34 42 38 44 39 47 39.500 48Z' +
    'M57 48C58 41 62 35 69 35 76 35 80 41 78 47 76.500 51 71 52 70 48 69.500 45.500 72.500 44.500 73 47 74 42 70 40 66 42 62 44 61 47 60.500 48Z' +
    'M37 50H63V55H37Z' +
    'M46 57H54C54 64 52 70 50 79 48 70 46 64 46 57Z' +
    'M44 57C43 63 38 68 31 66 36 65 38 61 39 57Z' +
    'M56 57C57 63 62 68 69 66 64 65 62 61 61 57Z';

  /** 황금 — 플로린 금화(구슬 테두리, 백합 문양) */
  function symFlorin() {
    const C = GEM.gold;
    let s = gemShadow('gold');
    s += '<circle cx="50" cy="52.5" r="46" fill="' + C[0] + '"/>';
    s += '<circle cx="50" cy="50" r="46" fill="url(#eg-g-au)"/>';
    s += '<circle cx="50" cy="50" r="41.500" fill="none" stroke="' + C[1] + '" stroke-width="1.2"/>';
    s += '<circle cx="50.6" cy="50.8" r="41.500" fill="none" stroke="' + C[4] + '" stroke-width=".8" opacity=".8"/>';
    let beads = '', beadsHi = '';
    for (let i = 0; i < 30; i++) {
      const a = i * 12 * Math.PI / 180;
      const x = 50 + 37.6 * Math.cos(a), y = 50 + 37.6 * Math.sin(a);
      beads += '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="2.3"/>';
      beadsHi += '<circle cx="' + f(x - 0.6) + '" cy="' + f(y - 0.7) + '" r="1"/>';
    }
    s += '<g fill="' + C[1] + '" stroke="' + C[0] + '" stroke-width=".5">' + beads + '</g><g fill="' + C[4] + '">' + beadsHi + '</g>';
    s += '<circle cx="50" cy="50" r="33" fill="url(#eg-g-au2)" stroke="' + C[1] + '" stroke-width=".9"/>';
    s += '<path d="' + LILY + '" transform="translate(1.1 1.5)" fill="' + C[0] + '" opacity=".85"/>';
    s += '<path d="' + LILY + '" transform="translate(-.9 -1.1)" fill="' + C[4] + '"/>';
    s += '<path d="' + LILY + '" fill="url(#eg-g-au3)"/>';
    s += '<path d="M15 38C19 24 31 13 46 11c-12 5-21 14-26 27-1 3-6 2-5 0z" fill="#fff" opacity=".6"/>';
    s += '<circle cx="50" cy="50" r="46" fill="none" stroke="' + mix(C[0], INK, 0.6) + '" stroke-width="2.4"/>';
    return s;
  }

  /**
   * 사선 무늬(해칭) 하나. 잉크 선을 pitch 간격으로.
   * @param {string} id @param {number} pitch @param {number} w @param {number} deg @param {string} [color] @param {boolean} [cross]
   */
  function hatch(id, pitch, w, deg, color, cross) {
    const c = color || INK;
    return '<pattern id="' + id + '" width="' + pitch + '" height="' + pitch + '" patternUnits="userSpaceOnUse" patternTransform="rotate(' + deg + ')">' +
      '<rect width="' + pitch + '" height="' + w + '" fill="' + c + '"/>' + (cross ? '<rect width="' + w + '" height="' + pitch + '" fill="' + c + '"/>' : '') + '</pattern>';
  }

  /** 하늘 그라데이션 @param {string} id @param {string[]} stops */
  function vgrad(id, stops) {
    let s = '<linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">';
    stops.forEach((c, i) => { s += '<stop offset="' + f(i / (stops.length - 1)) + '" stop-color="' + c + '"/>'; });
    return s + '</linearGradient>';
  }

  function buildDefs() {
    const u = GEM.u, g = GEM.g, k = GEM.k, au = GEM.gold;
    let s = '';
    // 보석 그라데이션
    s += '<radialGradient id="eg-g-u" cx=".6" cy=".7" r=".8"><stop offset="0" stop-color="#4f8cf0"/><stop offset=".28" stop-color="' + u[2] + '"/><stop offset=".7" stop-color="' + u[1] + '"/><stop offset="1" stop-color="' + u[0] + '"/></radialGradient>';
    s += '<radialGradient id="eg-g-u2" cx=".42" cy=".4" r=".62"><stop offset="0" stop-color="#03103a" stop-opacity=".0"/><stop offset=".45" stop-color="#03103a" stop-opacity=".25"/><stop offset=".8" stop-color="#03103a" stop-opacity="0"/><stop offset="1" stop-color="#020a26" stop-opacity=".7"/></radialGradient>';
    s += '<radialGradient id="eg-g-u3"><stop offset="0" stop-color="#8fbcff" stop-opacity=".42"/><stop offset="1" stop-color="#8fbcff" stop-opacity="0"/></radialGradient>';
    s += '<linearGradient id="eg-g-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + g[3] + '"/><stop offset=".5" stop-color="' + g[2] + '"/><stop offset="1" stop-color="' + g[1] + '"/></linearGradient>';
    s += '<radialGradient id="eg-g-r" cx=".68" cy=".74" r=".6"><stop offset="0" stop-color="#ff7a6a" stop-opacity=".5"/><stop offset=".6" stop-color="#ff4a4a" stop-opacity=".05"/><stop offset="1" stop-color="#2a0206" stop-opacity=".3"/></radialGradient>';
    s += '<linearGradient id="eg-g-k" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + k[3] + '"/><stop offset=".35" stop-color="' + k[1] + '"/><stop offset=".7" stop-color="' + k[0] + '"/><stop offset="1" stop-color="' + k[2] + '"/></linearGradient>';
    s += '<radialGradient id="eg-g-au" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="' + au[4] + '"/><stop offset=".35" stop-color="' + au[3] + '"/><stop offset=".75" stop-color="' + au[2] + '"/><stop offset="1" stop-color="' + au[1] + '"/></radialGradient>';
    s += '<radialGradient id="eg-g-au2" cx=".62" cy=".68" r=".8"><stop offset="0" stop-color="' + au[3] + '"/><stop offset=".6" stop-color="' + au[2] + '"/><stop offset="1" stop-color="' + au[1] + '"/></radialGradient>';
    s += '<linearGradient id="eg-g-au3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + au[3] + '"/><stop offset="1" stop-color="' + au[1] + '"/></linearGradient>';
    s += '<linearGradient id="eg-glint" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>';
    // 보석 원본과 윤곽 자르기
    const syms = { w: symDiamond, u: symSapphire, g: symEmerald, r: symRuby, k: symOnyx, gold: symFlorin };
    for (const c of Object.keys(syms)) {
      s += '<symbol id="eg-gem-' + c + '" viewBox="0 0 100 100" overflow="visible">' + syms[c]() + '</symbol>';
      s += '<clipPath id="eg-gclip-' + c + '">' + SHAPE[c] + '/></clipPath>';
    }
    // 해칭 무늬
    s += hatch('eg-hA', 2.3, 0.42, 45) + hatch('eg-hB', 2.3, 0.42, -45) + hatch('eg-hX', 2.3, 0.4, 45, INK, true);
    s += hatch('eg-hH', 2, 0.4, 0) + hatch('eg-hV', 2, 0.4, 90) + hatch('eg-hA2', 1.5, 0.45, 45) + hatch('eg-hX2', 1.6, 0.42, 30, INK, true);
    s += hatch('eg-hL', 2.4, 0.4, 45, '#efe6cc') + hatch('eg-hLH', 2.2, 0.36, 0, '#efe6cc');
    s += '<pattern id="eg-hD" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx=".6" cy=".6" r=".42" fill="' + INK + '"/></pattern>';
    s += ART_DEFS();
    s += NOBLE_DEFS();
    s += MEDAL_DEFS();
    s += BACK_DEFS();
    return s;
  }

  let defsReady = false;
  /** 공유 defs 를 문서에 한 번 넣는다(지워졌으면 다시). */
  function ensureDefs() {
    if (defsReady && document.getElementById('eg-defs')) return;
    const host = /** @type {SVGSVGElement} */ (document.createElementNS(NS, 'svg'));
    host.setAttribute('id', 'eg-defs');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    host.innerHTML = '<defs>' + buildDefs() + '</defs>';
    (document.body || document.documentElement).appendChild(host);
    defsReady = true;
  }

  /* ───────────── 4. 보석 · 칩 · 작은 부품 ───────────── */

  /** @param {string} color @param {string} [cls] @returns {SVGSVGElement} */
  function gemSvg(color, cls) {
    ensureDefs();
    return svgEl('eg-gem eg-gem--' + color + (cls ? ' ' + cls : ''), '0 0 100 100',
      '<use href="#eg-gem-' + color + '"/><g clip-path="url(#eg-gclip-' + color + ')"><rect class="eg-gem__glint" x="-60" y="-30" width="30" height="160" fill="url(#eg-glint)"/></g>');
  }

  /** 보석 하나(황금은 플로린 금화). 요소나 조상에 'is-glint' 가 붙으면 빛이 한 번 스친다. @param {TokenColor} color @param {number} px @returns {Element} */
  function gem(color, px) {
    const s = gemSvg(color);
    s.style.width = px + 'px';
    s.style.height = px + 'px';
    return s;
  }

  /** 칩 한 닢(크기는 CSS --d) @param {string} color @param {string} [cls] @returns {HTMLElement} */
  function chipEl(color, cls) {
    return d('eg-chip eg-chip--' + color + (cls ? ' ' + cls : ''));
  }

  /** 비용 칩(숫자 포함). 크기는 CSS 가 정한다(카드 안) @param {string} color @param {number} n @returns {HTMLElement} */
  function costChipEl(color, n) {
    const el = chipEl(color, 'eg-chip--cost');
    el.setAttribute('data-color', color);
    el.appendChild(d('eg-chip__n', String(n)));
    return el;
  }

  /** @param {Color} color @param {number} n @param {number} px @returns {HTMLElement} */
  function costChip(color, n, px) {
    const el = costChipEl(color, n);
    el.style.setProperty('--d', px + 'px');
    if (px < 26) el.classList.add('eg-chip--tiny');
    return el;
  }

  /** @param {TokenColor} color @param {number} count @param {number} px @returns {HTMLElement} */
  function chipStack(color, count, px) {
    const el = d('eg-stack' + (count === 0 ? ' is-empty' : ''));
    el.setAttribute('data-color', color);
    el.setAttribute('data-count', String(count));
    el.style.setProperty('--d', px + 'px');
    const pile = d('eg-stack__pile');
    const shown = Math.min(count, 7);
    const lift = Math.max(2, Math.round(px * 0.085));
    if (count === 0) {
      const ghost = d('eg-stack__ghost');
      ghost.appendChild(gemSvg(color));
      pile.appendChild(ghost);
    }
    for (let i = 0; i < shown; i++) {
      const top = i === shown - 1;
      const c = chipEl(color, top ? 'eg-chip--top' : 'eg-chip--under');
      const jig = top ? 0 : ((i * 7 + 3) % 5 - 2) * px * 0.012;
      c.style.bottom = (i * lift) + 'px';
      c.style.left = f(jig) + 'px';
      if (top) {
        const well = d('eg-chip__well');
        well.appendChild(gemSvg(color));
        c.appendChild(well);
      }
      pile.appendChild(c);
    }
    el.appendChild(pile);
    el.appendChild(d('eg-stack__n', String(count)));
    return el;
  }

  /** 보너스(산 카드 수): 작은 카드 더미 모양 + 숫자 @param {Color} color @param {number} n @param {number} px @returns {HTMLElement} */
  function bonusTile(color, n, px) {
    const el = d('eg-bonus eg-sq--' + color + (n === 0 ? ' is-zero' : ''));
    el.setAttribute('data-color', color);
    el.style.setProperty('--d', px + 'px');
    el.appendChild(d('eg-bonus__n', String(n)));
    return el;
  }

  /** 플레이어 점수: 틀 없는 큰 숫자 @param {number} n @param {number} px @returns {HTMLElement} */
  function pointsBadge(n, px) {
    const el = d('eg-points' + (n === 0 ? ' is-zero' : ''), String(n));
    el.setAttribute('data-n', String(n));
    el.style.setProperty('--d', px + 'px');
    return el;
  }

  /* ───────────── 5. 삽화 ───────────── */
  /*@@ART@@*/
  /*
   * 삽화는 94×100 좌표의 SVG 글자열로 만든다. 왼쪽 띠(x<27)는 비용 칩이 가리므로 볼거리는 가운데~오른쪽에 둔다.
   * "색을 맡은 물건"(class eg-dye)은 늘 오른쪽 가운데(x 44~92, y 14~88)에 비슷한 넓이로 놓는다.
   * 가는 선·해칭(class eg-fine)은 작은 카드에서 숨긴다.
   * 흰 카드는 어두운 배경(밤·해 질 녘·동굴 안), 검정 카드는 밝은 배경(새벽·설경), 나머지는 차분한 낮·새벽·저녁.
   */

  /**
   * @typedef {Object} Pal
   * @property {string} c 보석 색  @property {string[]} D 물들인 색 단계  @property {string} mode  @property {string} time
   * @property {string} ink  @property {string} dink  @property {string[]} rock  @property {string[]} wood  @property {string} ground
   * @property {string[]} sea  @property {string[]} plaster  @property {string[]} brass  @property {string} dark  @property {string} paper
   * @property {string} far  @property {string} cloud  @property {number} hop 해칭 진하기
   */

  /** @type {Record<string, Partial<Pal>>} */
  const MODES = {
    mid: { ink: '#2e2018', rock: ['#d5cbb5', '#b5aa94', '#8c816e'], wood: ['#bb976c', '#96724b', '#694c2f'], ground: '#c9bda2', sea: ['#d3cbb3', '#ada58d'],
      plaster: ['#e8dcbe', '#cfc19f'], brass: ['#dcc17c', '#aa8b46', '#6e5622'], dark: '#33261b', paper: '#f7efd9', far: '#cbc0a6', cloud: '#f9f2de', hop: 0.5 },
    dark: { ink: '#140d08', rock: ['#84786a', '#5f554a', '#3c352d'], wood: ['#775d41', '#56412c', '#36281a'], ground: '#574d41', sea: ['#625849', '#413a30'],
      plaster: ['#6f6456', '#50473c'], brass: ['#bd9f58', '#826734', '#4a3a1a'], dark: '#15100b', paper: '#e6d9b8', far: '#4c4339', cloud: '#75695a', hop: 0.6 },
    bright: { ink: '#3a2a1e', rock: ['#f1ebdd', '#dcd3bf', '#b9af99'], wood: ['#d0b38c', '#ae9068', '#876c4c'], ground: '#ede6d5', sea: ['#e6dfcc', '#c7bfa9'],
      plaster: ['#f5eedc', '#e0d5bb'], brass: ['#e3cb8a', '#b29450', '#77622c'], dark: '#6a5947', paper: '#fefaf0', far: '#e0d7c2', cloud: '#ffffff', hop: 0.36 },
  };
  const TIMES = { mid: ['day', 'dawn', 'dusk'], dark: ['night', 'eve'], bright: ['snow', 'morn'] };

  /** @param {Color} c @param {number} variant @returns {Pal} */
  function palette(c, variant) {
    const mode = c === 'w' ? 'dark' : c === 'k' ? 'bright' : 'mid';
    const times = TIMES[mode];
    const p = /** @type {Pal} */ (Object.assign({}, MODES[mode]));
    p.c = c; p.D = DYE[c]; p.mode = mode; p.time = times[variant % times.length];
    p.dink = c === 'k' ? '#000' : p.ink;
    if (p.time === 'dusk') { p.rock = ['#c8bca3', '#a69a83', '#7e7361']; p.far = '#b9ac90'; p.ground = '#b9ad92'; p.sea = ['#c4b99d', '#9d937b']; }
    return p;
  }

  /**
   * 그림 도구 묶음(색판에 묶임)
   * @param {Pal} p
   */
  function pen(p) {
    const ink = p.ink;
    return {
      /** 잉크 윤곽이 있는 면 @param {string} dd @param {string} fill @param {number} [sw] */
      p: (dd, fill, sw) => '<path d="' + dd + '" fill="' + fill + '" stroke="' + ink + '" stroke-width="' + (sw === undefined ? 0.7 : sw) + '" stroke-linejoin="round" stroke-linecap="round"/>',
      /** 윤곽 없는 면 @param {string} dd @param {string} fill @param {number} [op] */
      f: (dd, fill, op) => '<path d="' + dd + '" fill="' + fill + '"' + (op !== undefined ? ' opacity="' + op + '"' : '') + '/>',
      /** 선 @param {string} dd @param {number} [sw] @param {number} [op] @param {string} [color] */
      l: (dd, sw, op, color) => '<path d="' + dd + '" fill="none" stroke="' + (color || ink) + '" stroke-width="' + (sw || 0.5) + '" stroke-linecap="round" stroke-linejoin="round"' + (op !== undefined ? ' opacity="' + op + '"' : '') + '/>',
      /** 가는 선(작은 카드에서 숨김) @param {string} dd @param {number} [sw] @param {number} [op] @param {string} [color] */
      fl: (dd, sw, op, color) => '<path class="eg-fine" d="' + dd + '" fill="none" stroke="' + (color || ink) + '" stroke-width="' + (sw || 0.4) + '" stroke-linecap="round" stroke-linejoin="round"' + (op !== undefined ? ' opacity="' + op + '"' : '') + '/>',
      /** 해칭(작은 카드에서 숨김) @param {string} dd @param {string} [pat] @param {number} [op] */
      h: (dd, pat, op) => '<path class="eg-fine" d="' + dd + '" fill="url(#eg-h' + (pat || 'A') + ')" opacity="' + f((op === undefined ? 1 : op) * p.hop) + '"/>',
      /** 색을 맡은 면 @param {string} dd @param {number} tone 0 어두움~4 밝음 @param {number} [sw] */
      dy: (dd, tone, sw) => '<path class="eg-dye" d="' + dd + '" fill="' + p.D[tone] + '" stroke="' + p.dink + '" stroke-width="' + (sw === undefined ? 0.7 : sw) + '" stroke-linejoin="round" stroke-linecap="round"/>',
      /** 색을 맡은 면 위의 해칭(검정에는 밝은 선) @param {string} dd @param {number} [op] @param {string} [pat] */
      dh: (dd, op, pat) => '<path class="eg-fine" d="' + dd + '" fill="url(#eg-h' + (p.c === 'k' ? 'L' : (pat || 'A')) + ')" opacity="' + f((op === undefined ? 0.5 : op) * (p.c === 'k' ? 0.55 : p.c === 'w' ? 0.6 : 1)) + '"/>',
    };
  }
  /** @typedef {ReturnType<typeof pen>} Pen */

  function ART_DEFS() {
    let s = '';
    s += vgrad('eg-sky-day', ['#d6c9a8', '#e8dcbf', '#f4ead2']);
    s += vgrad('eg-sky-dawn', ['#d3c5a6', '#ebdcbb', '#f8e9c3']);
    s += vgrad('eg-sky-dusk', ['#9f8f74', '#c7b28c', '#ecd3a2']);
    s += vgrad('eg-sky-night', ['#26211d', '#3d352e', '#5f5344']);
    s += vgrad('eg-sky-eve', ['#39312a', '#63553f', '#a58c62']);
    s += vgrad('eg-sky-snow', ['#e2dac8', '#f3eee0', '#fcf9f0']);
    s += vgrad('eg-sky-morn', ['#e6dabd', '#f5ecd6', '#fff6dc']);
    for (const c of ['w', 'u', 'g', 'r']) {
      s += '<radialGradient id="eg-glow-' + c + '"><stop offset="0" stop-color="' + DYE[c][3] + '" stop-opacity=".62"/><stop offset=".55" stop-color="' + DYE[c][2] + '" stop-opacity=".2"/><stop offset="1" stop-color="' + DYE[c][2] + '" stop-opacity="0"/></radialGradient>';
    }
    s += '<radialGradient id="eg-glow-k"><stop offset="0" stop-color="#fffdf2" stop-opacity=".95"/><stop offset=".6" stop-color="#fffdf2" stop-opacity=".45"/><stop offset="1" stop-color="#fffdf2" stop-opacity="0"/></radialGradient>';
    s += '<radialGradient id="eg-lamp"><stop offset="0" stop-color="#fff0c0" stop-opacity=".9"/><stop offset=".4" stop-color="#f6dc9a" stop-opacity=".4"/><stop offset="1" stop-color="#f6dc9a" stop-opacity="0"/></radialGradient>';
    s += '<radialGradient id="eg-shade"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>';
    s += '<linearGradient id="eg-fadeD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>';
    return s;
  }

  /** @param {number} x @param {number} y @param {number} w */
  function cloudPath(x, y, w) {
    return 'M' + f(x) + ' ' + f(y) + 'a' + f(w * 0.16) + ' ' + f(w * 0.13) + ' 0 0 1 ' + f(w * 0.27) + ' ' + f(-w * 0.07) +
      'a' + f(w * 0.2) + ' ' + f(w * 0.16) + ' 0 0 1 ' + f(w * 0.4) + ' ' + f(-w * 0.02) + 'a' + f(w * 0.15) + ' ' + f(w * 0.12) + ' 0 0 1 ' + f(w * 0.33) + ' ' + f(w * 0.09) + 'z';
  }

  /**
   * 하늘: 그라데이션 + 가로 판화선 + 해/달 + 구름
   * @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} hz 지평선 y  @param {boolean} [noDisc]
   */
  function sky(k, p, rnd, hz, noDisc) {
    let s = '<rect width="94" height="100" fill="url(#eg-sky-' + p.time + ')"/>';
    s += '<rect class="eg-fine" width="94" height="' + f(hz * 0.5) + '" fill="url(#eg-hH)" opacity="' + (p.mode === 'dark' ? 0.55 : 0.2) + '"/>';
    s += '<rect class="eg-fine" width="94" height="' + f(hz * 0.22) + '" fill="url(#eg-hH)" opacity="' + (p.mode === 'dark' ? 0.5 : 0.18) + '" transform="translate(0 1)"/>';
    const sx = 30 + rnd() * 16, sy = hz * (0.2 + rnd() * 0.32), r = 4.5 + rnd() * 2;
    if (!noDisc && p.time !== 'day' && p.time !== 'snow') {
      if (p.time === 'night') {
        s += '<circle cx="' + f(sx) + '" cy="' + f(sy) + '" r="' + f(r * 2.6) + '" fill="url(#eg-lamp)" opacity=".35"/>';
        s += k.p('M' + f(sx) + ' ' + f(sy - r) + 'a' + f(r) + ' ' + f(r) + ' 0 1 0 ' + f(r * 0.9) + ' ' + f(r * 1.5) + 'a' + f(r * 0.8) + ' ' + f(r * 0.8) + ' 0 1 1 ' + f(-r * 0.9) + ' ' + f(-r * 1.5) + 'z', p.paper, 0.4);
      } else {
        const sy2 = hz - r * (0.3 + rnd() * 1.2);
        s += '<circle cx="' + f(sx) + '" cy="' + f(sy2) + '" r="' + f(r * 3) + '" fill="url(#eg-lamp)" opacity=".7"/>';
        s += '<circle cx="' + f(sx) + '" cy="' + f(sy2) + '" r="' + f(r) + '" fill="' + p.paper + '" stroke="' + p.ink + '" stroke-width=".4"/>';
        let rays = '';
        for (let i = 0; i < 14; i++) { const a = Math.PI + (i + 0.5) * Math.PI / 14; rays += 'M' + f(sx + Math.cos(a) * r * 1.5) + ' ' + f(sy2 + Math.sin(a) * r * 1.5) + 'L' + f(sx + Math.cos(a) * r * (2.2 + (i % 2) * 0.9)) + ' ' + f(sy2 + Math.sin(a) * r * (2.2 + (i % 2) * 0.9)); }
        s += k.fl(rays, 0.3, 0.6);
      }
    }
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const w = 16 + rnd() * 12, x = 26 + rnd() * 50, y = 6 + rnd() * hz * 0.3;
      s += k.p(cloudPath(x, y, w), p.cloud, 0.4);
      s += k.fl('M' + f(x + 2) + ' ' + f(y + 1.3) + 'h' + f(w * 0.8) + 'M' + f(x + 6) + ' ' + f(y + 2.6) + 'h' + f(w * 0.55), 0.3, 0.6);
    }
    return s;
  }

  /** 바위 덩이 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} x @param {number} y @param {number} w @param {number} h */
  function boulder(k, p, rnd, x, y, w, h) {
    const j = () => (rnd() - 0.5) * w * 0.1;
    const a = [x - w / 2, y], b = [x - w * 0.42 + j(), y - h * 0.55 + j()], c = [x - w * 0.12 + j(), y - h + j()], e = [x + w * 0.25 + j(), y - h * 0.84 + j()], g = [x + w / 2, y - h * 0.3 + j()], q = [x + w * 0.46, y];
    const m = [x - w * 0.02 + j(), y - h * 0.42];
    let s = k.p('M' + pp([a, b, c, e, g, q]) + 'Z', p.rock[0], 0.6);
    const dk = 'M' + pp([c, e, g, q, [x + w * 0.04, y], m]) + 'Z';
    s += k.f(dk, p.rock[1]) + k.h(dk, 'A', 0.9);
    s += k.l('M' + pp([c, m, [x + w * 0.04, y]]), 0.4, 0.7);
    return s;
  }

  /**
   * 원석 결정 무리(1단계의 색을 맡은 물건). 색마다 결정 생김새가 다르다.
   * @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} cx @param {number} by 밑동 y @param {number} s 크기(대략 높이)
   */
  function crystals(k, p, rnd, cx, by, s) {
    const c = p.c, D = p.D;
    const habit = { w: 'octa', u: 'spear', g: 'column', r: 'stub', k: 'shard' }[c];
    // 돌에 스미는 빛(검정은 뒤에서 비치는 밝은 빛으로 윤곽을 살린다)
    let out = '<ellipse class="eg-glow" cx="' + f(cx) + '" cy="' + f(by - s * 0.45) + '" rx="' + f(s * 0.8) + '" ry="' + f(s * 0.72) + '" fill="url(#eg-glow-' + c + ')"/>';
    const n = habit === 'octa' ? 6 : habit === 'stub' ? 6 + Math.floor(rnd() * 2) : 6 + Math.floor(rnd() * 3);
    /** @type {{ang:number,len:number,w:number,ox:number}[]} */
    const items = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const ang = (-58 + 116 * t + (rnd() - 0.5) * 12) * Math.PI / 180;
      const len = s * (0.5 + 0.5 * (1 - Math.pow(Math.abs(2 * t - 1), 1.4)) + (rnd() - 0.5) * 0.2);
      items.push({ ang, len, w: s * (0.15 + rnd() * 0.07), ox: (t - 0.5) * s * 0.55 });
    }
    items.sort((a, b) => b.len - a.len);
    for (const it of items) {
      const ux = Math.sin(it.ang), uy = -Math.cos(it.ang), vx = Math.cos(it.ang), vy = Math.sin(it.ang);
      let L = it.len, w = it.w;
      const bx = cx + it.ox;
      /** @param {number} a @param {number} b */
      const P = (a, b) => f(bx + ux * a * L + vx * b * w) + ' ' + f(by + uy * a * L + vy * b * w);
      /** @param {number[][]} pts */
      const poly = (pts) => 'M' + pts.map((q) => P(q[0], q[1])).join('L') + 'Z';
      if (habit === 'spear') {
        const all = poly([[0, -0.36], [0.22, -0.5], [0.7, -0.44], [1, 0], [0.7, 0.44], [0.22, 0.5], [0, 0.36]]);
        const lt = poly([[0, -0.36], [0.22, -0.5], [0.7, -0.44], [1, 0], [0.7, -0.1], [0, -0.1]]);
        const rt = poly([[0, 0.18], [0.7, 0.2], [1, 0], [0.7, 0.44], [0.22, 0.5], [0, 0.36]]);
        out += k.dy(all, 2, 0) + k.dy(lt, 3, 0) + k.dy(rt, 1, 0) + k.dh(rt, 0.7);
        out += k.fl('M' + P(0.7, -0.44) + 'L' + P(0.7, -0.1) + 'L' + P(0.7, 0.2) + 'L' + P(0.7, 0.44) + 'M' + P(0, -0.1) + 'L' + P(0.7, -0.1) + 'L' + P(1, 0) + 'L' + P(0.7, 0.2) + 'L' + P(0, 0.18), 0.35, 0.8, p.dink);
        out += k.l('M' + P(0.1, -0.3) + 'L' + P(0.62, -0.32), 0.7, 0.9, D[4]);
        out += k.l(all, 0.7, 1, p.dink);
      } else if (habit === 'column' || habit === 'stub') {
        if (habit === 'stub') { L *= 0.86; w *= 1.6; }
        const top = habit === 'stub' ? 0.78 : 0.86;
        const lt = poly([[0, -0.5], [top, -0.5], [top, -0.16], [0, -0.16]]);
        const ct = poly([[0, -0.16], [top, -0.16], [top, 0.2], [0, 0.2]]);
        const rt = poly([[0, 0.2], [top, 0.2], [top, 0.5], [0, 0.5]]);
        const cap = habit === 'stub' ? poly([[top, -0.5], [1, -0.14], [0.94, 0.3], [top, 0.5], [top, 0.2], [top, -0.16]]) : poly([[top, -0.5], [0.95, -0.3], [1, 0.05], [0.95, 0.36], [top, 0.5], [top, 0.2], [top, -0.16]]);
        const all = poly([[0, -0.5], [top, -0.5], habit === 'stub' ? [1, -0.14] : [0.95, -0.3], habit === 'stub' ? [0.94, 0.3] : [1, 0.05], habit === 'stub' ? [0.94, 0.3] : [0.95, 0.36], [top, 0.5], [0, 0.5]]);
        out += k.dy(ct, 2, 0) + k.dy(lt, habit === 'stub' ? 2 : 3, 0) + k.dy(rt, 1, 0) + k.dh(rt, 0.7) + k.dy(cap, habit === 'stub' ? 3 : 4, 0);
        if (habit === 'stub') out += k.l('M' + P(0.12, -0.36) + 'L' + P(top - 0.08, -0.36), 0.8, 0.9, D[4]);
        out += k.fl(cap + 'M' + P(0, -0.16) + 'L' + P(top, -0.16) + 'M' + P(0, 0.2) + 'L' + P(top, 0.2), 0.35, 0.8, p.dink);
        out += k.l(all, 0.7, 1, p.dink);
      } else if (habit === 'octa') {
        L *= 0.85; w = L * 0.8;
        const B0 = [0, 0], Lf = [0.5, -0.5], T = [1, 0], Rt = [0.5, 0.5], C = [0.52, -0.04];
        out += k.dy(poly([B0, Lf, C]), 2, 0) + k.dy(poly([Lf, T, C]), 4, 0) + k.dy(poly([T, Rt, C]), 1, 0) + k.dy(poly([Rt, B0, C]), 0, 0);
        out += k.dh(poly([Rt, B0, C]), 0.8) + k.dh(poly([T, Rt, C]), 0.4, 'B');
        out += k.fl('M' + P(0, 0) + 'L' + P(0.52, -0.04) + 'L' + P(1, 0) + 'M' + P(0.5, -0.5) + 'L' + P(0.52, -0.04) + 'L' + P(0.5, 0.5), 0.35, 0.8, p.dink);
        out += k.l(poly([B0, Lf, T, Rt]), 0.7, 1, p.dink);
      } else {
        const all = poly([[0, -0.5], [0.74, -0.5], [1, -0.1], [0.84, 0.5], [0, 0.5]]);
        const lt = poly([[0, -0.5], [0.74, -0.5], [1, -0.1], [0.8, -0.02], [0, -0.05]]);
        out += k.dy(all, 1, 0) + k.dy(lt, 3, 0) + k.dh(all, 0.6);
        out += k.l('M' + P(0.34, -0.5) + 'L' + P(0.36, 0.5) + 'M' + P(0.5, -0.5) + 'L' + P(0.53, 0.5), 0.8, 0.9, '#efe9da');
        out += k.fl('M' + P(0, -0.05) + 'L' + P(0.8, -0.02) + 'L' + P(1, -0.1) + 'M' + P(0.8, -0.02) + 'L' + P(0.84, 0.5), 0.35, 0.8, '#9a968f');
        out += k.l(all, 0.7, 1, p.dink);
      }
    }
    // 반짝임
    const tall = items[0];
    const tx = cx + tall.ox + Math.sin(tall.ang) * tall.len * (habit === 'octa' ? 0.5 : habit === 'stub' ? 0.6 : 0.8) - 2, ty = by - Math.cos(tall.ang) * tall.len * (habit === 'octa' ? 0.5 : habit === 'stub' ? 0.6 : 0.8);
    out += '<path d="M' + f(tx) + ' ' + f(ty - 3.6) + 'l.8 2.8 2.8.8-2.8.8-.8 2.800-.8-2.800-2.800-.8 2.800-.8z" fill="#fff"' + (c === 'w' ? ' stroke="' + p.ink + '" stroke-width=".25"' : '') + '/>';
    // 밑동 바위
    out += boulder(k, p, rnd, cx - s * 0.4, by + s * 0.1, s * 0.5, s * 0.24) + boulder(k, p, rnd, cx + s * 0.36, by + s * 0.12, s * 0.56, s * 0.22) + boulder(k, p, rnd, cx, by + s * 0.2, s * 0.5, s * 0.2);
    return out;
  }

  /** 바닥의 자갈·풀 없는 맨땅 선 @param {Pen} k @param {() => number} rnd @param {number} y0 @param {number} y1 */
  function pebbles(k, rnd, y0, y1) {
    let dd = '';
    for (let i = 0; i < 12; i++) { const x = 28 + rnd() * 64, y = y0 + rnd() * (y1 - y0), w = 1.5 + rnd() * 3; dd += 'M' + f(x) + ' ' + f(y) + 'q' + f(w / 2) + ' ' + f(-w * 0.5) + ' ' + f(w) + ' 0'; }
    return k.fl(dd, 0.4, 0.7);
  }

  /** 나무 기둥·들보(결 선 포함) @param {Pen} k @param {Pal} p @param {number[][]} q 네 꼭짓점 @param {number} [tone] */
  function beam(k, p, q, tone) {
    const dd = 'M' + pp(q) + 'Z';
    let s = k.p(dd, p.wood[tone || 0], 0.65);
    // 결: 긴 변을 따라 두 줄
    const m1 = [(q[0][0] * 2 + q[3][0]) / 3, (q[0][1] * 2 + q[3][1]) / 3], m2 = [(q[1][0] * 2 + q[2][0]) / 3, (q[1][1] * 2 + q[2][1]) / 3];
    const n1 = [(q[0][0] + q[3][0] * 2) / 3, (q[0][1] + q[3][1] * 2) / 3], n2 = [(q[1][0] + q[2][0] * 2) / 3, (q[1][1] + q[2][1] * 2) / 3];
    s += k.fl('M' + pp([m1, m2]) + 'M' + pp([n1, n2]), 0.3, 0.6);
    return s;
  }

  /* ── 1단계: 캐는 곳 ── */

  /** 갱도 입구(나무 버팀목) @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v 변형 */
  function sceneAdit(k, p, rnd, v) {
    let s = sky(k, p, rnd, 30, true);
    // 벼랑
    const top = 'M0 ' + f(20 + rnd() * 8) + 'L16 ' + f(12 + rnd() * 6) + 'L34 ' + f(5 + rnd() * 5) + 'L58 ' + f(8 + rnd() * 6) + 'L78 ' + f(2 + rnd() * 4) + 'L94 ' + f(6 + rnd() * 6);
    s += k.p(top + 'V100H0Z', p.rock[1], 0.7);
    s += k.h(top + 'V100H0Z', 'B', 0.5);
    // 지층 금
    let cr = '';
    for (let i = 0; i < 7; i++) { const y = 14 + i * 9 + rnd() * 4, x = 26 + rnd() * 30; cr += 'M' + f(x) + ' ' + f(y) + 'l' + f(8 + rnd() * 14) + ' ' + f(-2 + rnd() * 4) + 'l' + f(4 + rnd() * 6) + ' ' + f(3 * rnd()); }
    s += k.fl(cr, 0.4, 0.75);
    s += k.f('M60 0H94V100H70Q58 60 66 30Z', p.rock[2], 0.35);
    // 땅
    s += k.p('M0 70Q30 64 56 68T94 66V100H0Z', p.ground, 0.6);
    // 입구
    const ax = 24 + rnd() * 4, aw = 27 + rnd() * 4, ay = 26 + rnd() * 3, ab = 69;
    if (v % 2 === 0) {
      s += k.p('M' + f(ax + 2) + ' ' + ab + 'V' + f(ay + 4) + 'H' + f(ax + aw - 2) + 'V' + ab + 'Z', p.dark, 0.6);
      // 안쪽 버팀목
      s += k.l('M' + f(ax + 8) + ' ' + ab + 'V' + f(ay + 14) + 'H' + f(ax + aw - 8) + 'V' + ab, 1.2, 0.5, p.wood[1]);
      s += k.l('M' + f(ax + 11.5) + ' ' + ab + 'V' + f(ay + 21) + 'H' + f(ax + aw - 11.500) + 'V' + ab, 0.8, 0.35, p.wood[1]);
      s += beam(k, p, [[ax, ab + 1], [ax + 1.5, ay + 3], [ax + 5.5, ay + 3], [ax + 5, ab + 1]], 0);
      s += beam(k, p, [[ax + aw - 5, ab + 1], [ax + aw - 5.5, ay + 3], [ax + aw - 1.5, ay + 3], [ax + aw, ab + 1]], 1);
      s += beam(k, p, [[ax - 3.5, ay + 4.500], [ax - 3, ay - 1], [ax + aw + 3, ay - 1], [ax + aw + 3.500, ay + 4.500]], 0);
      s += k.h('M' + f(ax + aw - 5) + ' ' + f(ab + 1) + 'L' + f(ax + aw - 5.500) + ' ' + f(ay + 3) + 'h4L' + f(ax + aw) + ' ' + f(ab + 1) + 'Z', 'A', 0.9);
    } else {
      // 돌 아치 입구
      const mx = ax + aw / 2, r = aw / 2;
      s += k.p('M' + f(ax - 4) + ' ' + ab + 'V' + f(ay + r + 2) + 'A' + f(r + 4) + ' ' + f(r + 4) + ' 0 0 1 ' + f(ax + aw + 4) + ' ' + f(ay + r + 2) + 'V' + ab + 'Z', p.rock[0], 0.7);
      s += k.p('M' + f(ax) + ' ' + ab + 'V' + f(ay + r + 2) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(ax + aw) + ' ' + f(ay + r + 2) + 'V' + ab + 'Z', p.dark, 0.6);
      let vs = '';
      for (let i = 1; i < 9; i++) { const a = Math.PI + i * Math.PI / 9; vs += 'M' + f(mx + Math.cos(a) * r) + ' ' + f(ay + r + 2 + Math.sin(a) * r) + 'L' + f(mx + Math.cos(a) * (r + 4)) + ' ' + f(ay + r + 2 + Math.sin(a) * (r + 4)); }
      for (let y = ay + r + 7; y < ab; y += 6) vs += 'M' + f(ax - 4) + ' ' + f(y) + 'h4M' + f(ax + aw) + ' ' + f(y) + 'h4';
      s += k.fl(vs, 0.4, 0.85);
      s += k.l('M' + f(ax + 6) + ' ' + ab + 'V' + f(ay + r + 6) + 'A' + f(r - 6) + ' ' + f(r - 6) + ' 0 0 1 ' + f(ax + aw - 6) + ' ' + f(ay + r + 6) + 'V' + ab, 1, 0.4, p.rock[2]);
    }
    // 등불
    if (v % 3 !== 1) {
      const lx = ax + aw + 6, ly = ay + 10;
      s += '<circle cx="' + f(lx) + '" cy="' + f(ly + 3) + '" r="11" fill="url(#eg-lamp)" opacity="' + (p.mode === 'bright' ? 0.5 : 0.85) + '"/>';
      s += k.l('M' + f(lx - 5) + ' ' + f(ly - 4) + 'h5v2.500', 0.6);
      s += k.p('M' + f(lx - 1.8) + ' ' + f(ly + 5.500) + 'V' + f(ly) + 'l1.800-1.800 1.800 1.800V' + f(ly + 5.500) + 'Z', '#fff3c9', 0.5);
    }
    // 레일
    const rx = ax + aw / 2;
    s += k.fl('M' + f(rx - 5) + ' ' + ab + 'L' + f(rx - 20) + ' 100M' + f(rx + 5) + ' ' + ab + 'L' + f(rx + 14) + ' 100', 0.9, 0.9);
    let sl = '';
    for (let i = 0; i < 5; i++) { const t = i / 5, y = ab + 3 + t * t * 26 + i * 1.2, ww = 7 + (y - ab) * 0.62; sl += 'M' + f(rx - 1.5 - ww) + ' ' + f(y) + 'h' + f(ww * 2 - 1); }
    s += k.fl(sl, 1.1, 0.7, p.wood[2]);
    s += pebbles(k, rnd, 74, 98);
    if (p.mode === 'bright') s += k.f('M0 70Q30 64 56 68T94 66V72Q60 70 40 74T0 76Z', '#fff', 0.85);
    s += crystals(k, p, rnd, 61 + rnd() * 3, 84, 40 + rnd() * 4);
    return s;
  }

  /** 갱도 안 레일 위 광석 수레 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneCart(k, p, rnd, v) {
    const vx = 44 + rnd() * 6, vy = 40 + rnd() * 4;
    let s = '<rect width="94" height="100" fill="' + p.rock[2] + '"/>';
    s += '<rect class="eg-fine" width="94" height="100" fill="url(#eg-hX)" opacity="' + f(p.hop * 0.6) + '"/>';
    // 바닥
    s += k.p('M0 100L' + f(vx - 9) + ' ' + f(vy + 12) + 'h18L94 100Z', p.ground, 0.6);
    // 안쪽 어둠
    s += k.p('M' + f(vx - 9) + ' ' + f(vy + 12) + 'V' + f(vy - 8) + 'h18V' + f(vy + 12) + 'Z', p.dark, 0.5);
    if (v % 2 === 1) s += '<circle cx="' + f(vx) + '" cy="' + f(vy + 2) + '" r="8" fill="url(#eg-lamp)" opacity=".8"/>';
    // 버팀목 틀 세 겹(멀리서 가까이)
    for (let i = 0; i < 3; i++) {
      const t = [0.3, 0.58, 1][i];
      const lx = vx - 9 - (vx - 9 + 2) * t, rx = vx + 9 + (94 + 2 - vx - 9) * t, ty = vy - 8 - (vy - 8 + 6) * t, by2 = vy + 12 + (100 - vy - 12) * t;
      const w = 2 + t * 5.5;
      if (v % 2 === 1) {
        // 돌로 쌓은 둥근 천장 갱도
        const r = (rx - lx) / 2, sp = Math.max(ty + r * 0.55, ty + 4);
        const arch = 'M' + f(lx + w / 2) + ' ' + f(by2) + 'V' + f(sp) + 'A' + f(r - w / 2) + ' ' + f((sp - ty) - w / 2) + ' 0 0 1 ' + f(rx - w / 2) + ' ' + f(sp) + 'V' + f(by2);
        s += k.l(arch, w + 1.2, 1, p.ink) + k.l(arch, w, 1, p.rock[i === 2 ? 1 : 0]);
        let vs = '';
        for (let j = 0; j < 9; j++) { const a = Math.PI + (j + 0.5) * Math.PI / 9; const ex = (lx + rx) / 2 + Math.cos(a) * (r - w / 2), ey = sp + Math.sin(a) * (sp - ty - w / 2); vs += 'M' + f(ex - Math.cos(a) * w / 2) + ' ' + f(ey - Math.sin(a) * w / 2) + 'L' + f(ex + Math.cos(a) * w / 2) + ' ' + f(ey + Math.sin(a) * w / 2); }
        for (let y = sp + 4; y < by2; y += 5 + t * 5) vs += 'M' + f(lx) + ' ' + f(y) + 'h' + f(w) + 'M' + f(rx - w) + ' ' + f(y) + 'h' + f(w);
        s += k.fl(vs, 0.35, 0.8);
        continue;
      }
      s += beam(k, p, [[lx, by2], [lx + w * 0.15, ty + w], [lx + w, ty + w], [lx + w * 0.9, by2]], i === 2 ? 1 : 0);
      s += beam(k, p, [[rx - w * 0.9, by2], [rx - w, ty + w], [rx - w * 0.15, ty + w], [rx, by2]], 1);
      s += beam(k, p, [[lx - w * 0.4, ty + w * 1.1], [lx - w * 0.3, ty], [rx + w * 0.3, ty], [rx + w * 0.4, ty + w * 1.1]], 0);
      s += k.h('M' + pp([[rx - w * 0.9, by2], [rx - w, ty + w], [rx - w * 0.15, ty + w], [rx, by2]]) + 'Z', 'A', 0.9);
    }
    // 레일
    s += k.l('M' + f(vx - 3) + ' ' + f(vy + 12) + 'L' + f(vx - 34) + ' 100M' + f(vx + 3) + ' ' + f(vy + 12) + 'L' + f(vx + 8) + ' 100', 0.9, 0.9);
    let sl = '';
    for (let i = 0; i < 6; i++) { const t = (i + 0.4) / 6, y = vy + 12 + t * t * (88 - vy), ww = 4 + (y - vy - 12) * 0.5; const mx = vx - (y - vy - 12) * 0.28; sl += 'M' + f(mx - ww) + ' ' + f(y) + 'h' + f(ww * 2); }
    s += k.fl(sl, 1.1, 0.7, p.wood[2]);
    // 수레
    const cxx = vx - 12 + rnd() * 3, cyy = vy + 30;
    s += k.p('M' + f(cxx - 12) + ' ' + f(cyy - 13) + 'h25l-3 15h-19z', p.wood[1], 0.7);
    s += k.h('M' + f(cxx + 4) + ' ' + f(cyy - 13) + 'h9l-3 15h-7z', 'A', 0.9);
    s += k.fl('M' + f(cxx - 11) + ' ' + f(cyy - 8) + 'h23M' + f(cxx - 10) + ' ' + f(cyy - 3) + 'h21', 0.4, 0.8);
    s += k.l('M' + f(cxx - 5) + ' ' + f(cyy - 13) + 'l1 15M' + f(cxx + 6) + ' ' + f(cyy - 13) + 'l-1 15', 0.9, 0.9, p.wood[2]);
    // 수레 속 광석(회색 덩이 + 결정 조각)
    s += k.p('M' + f(cxx - 11) + ' ' + f(cyy - 13) + 'l3-4 4 1 3-4 5 2 3-3 5 4 2 4z', p.rock[0], 0.6);
    s += k.dy('M' + f(cxx - 4) + ' ' + f(cyy - 13) + 'l2-5 3 1 1 4z', 2, 0.5) + k.dy('M' + f(cxx + 5) + ' ' + f(cyy - 13) + 'l1-4 3-1 2 5z', 3, 0.5);
    s += '<circle cx="' + f(cxx - 5.500) + '" cy="' + f(cyy + 3.500) + '" r="3.600" fill="' + p.wood[2] + '" stroke="' + p.ink + '" stroke-width=".7"/><circle cx="' + f(cxx + 6) + '" cy="' + f(cyy + 3.500) + '" r="3.600" fill="' + p.wood[2] + '" stroke="' + p.ink + '" stroke-width=".7"/>';
    s += k.fl('M' + f(cxx - 5.500) + ' ' + f(cyy)  + 'v7m-3.500-3.500h7M' + f(cxx + 6) + ' ' + f(cyy) + 'v7m-3.500-3.500h7', 0.4, 0.8, p.wood[0]);
    s += pebbles(k, rnd, 78, 98);
    s += crystals(k, p, rnd, 62 + rnd() * 3, 85, 39 + rnd() * 4);
    return s;
  }

  /** 절벽과 설산, 권양기 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function scenePeaks(k, p, rnd, v) {
    const hz = 58;
    let s = sky(k, p, rnd, hz);
    const snow = p.mode === 'dark' ? p.paper : '#fffdf6';
    // 먼 봉우리
    const peaks = v % 2 === 0 ? [[26, 14, 30], [58, 22, 26], [84, 9, 28]] : [[20, 22, 26], [46, 8, 32], [78, 18, 30]];
    for (const [px, py0, w] of peaks) {
      const py = py0 + rnd() * 5;
      s += k.p('M' + f(px - w) + ' ' + (hz + 4) + 'L' + f(px) + ' ' + f(py) + 'L' + f(px + w) + ' ' + (hz + 4) + 'Z', p.far, 0.6);
      s += k.h('M' + f(px) + ' ' + f(py) + 'L' + f(px + w) + ' ' + (hz + 4) + 'H' + f(px + 3) + 'Z', 'A', 0.8);
      // 눈 모자
      const sh = (hz - py) * 0.36;
      s += k.p('M' + f(px) + ' ' + f(py) + 'L' + f(px - w * 0.36) + ' ' + f(py + sh) + 'l' + f(w * 0.12) + ' -2.500 ' + f(w * 0.1) + ' 4 ' + f(w * 0.14) + ' -3 ' + f(w * 0.12) + ' 3.500 ' + f(w * 0.1) + ' -3L' + f(px + w * 0.36) + ' ' + f(py + sh) + 'Z', snow, 0.5);
    }
    // 가운데 비탈과 앞 바위턱
    s += k.p('M0 ' + (hz - 4) + 'Q20 ' + (hz - 10) + ' 40 ' + (hz - 2) + 'T94 ' + (hz - 6) + 'V100H0Z', p.rock[1], 0.6);
    s += k.h('M0 ' + (hz - 4) + 'Q20 ' + (hz - 10) + ' 40 ' + (hz - 2) + 'T94 ' + (hz - 6) + 'V' + (hz + 16) + 'H0Z', 'B', 0.6);
    s += k.p('M0 78Q24 70 50 76T94 72V100H0Z', p.mode === 'bright' ? '#fbf8ee' : p.ground, 0.6);
    // 권양기(수직갱 위 도르래 틀)
    const wx = 30 + rnd() * 6, wy = 74;
    s += k.p('M' + f(wx - 8) + ' ' + (wy + 1) + 'q8 -4 20 0l-2 4q-8 -3 -16 0z', p.dark, 0.5);
    s += beam(k, p, [[wx - 7, wy + 2], [wx - 5.5, wy - 22], [wx - 3, wy - 22], [wx - 4, wy + 2]], 0);
    s += beam(k, p, [[wx + 8.5, wy + 2], [wx + 7.5, wy - 22], [wx + 10, wy - 22], [wx + 11.5, wy + 2]], 1);
    s += beam(k, p, [[wx - 9, wy - 21], [wx - 9, wy - 24.5], [wx + 14, wy - 24.5], [wx + 14, wy - 21]], 0);
    s += k.p('M' + f(wx - 3) + ' ' + f(wy - 15) + 'h10.500v4.500h-10.500z', p.wood[2], 0.6);
    s += k.l('M' + f(wx + 10) + ' ' + f(wy - 12.700) + 'h5v4', 0.8);
    s += k.l('M' + f(wx + 2.500) + ' ' + f(wy - 10.500) + 'V' + f(wy - 4), 0.5);
    s += k.p('M' + f(wx) + ' ' + f(wy - 4) + 'h5l-.8 5h-3.400z', p.wood[1], 0.6);
    if (v % 2 === 1) {
      // 오두막
      const hx = wx + 22, hy = hz + 1;
      s += k.p('M' + f(hx - 6) + ' ' + hy + 'v-7h12v7z', p.wood[0], 0.5) + k.p('M' + f(hx - 8) + ' ' + (hy - 7) + 'l8 -6 8 6z', p.mode === 'bright' ? '#fff' : p.wood[2], 0.5);
      s += k.f('M' + f(hx - 1.5) + ' ' + hy + 'v-4h3v4z', p.dark);
    }
    s += pebbles(k, rnd, 80, 98);
    s += crystals(k, p, rnd, 62 + rnd() * 3, 86, 40 + rnd() * 4);
    return s;
  }

  /** 동굴 안 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneCave(k, p, rnd, v) {
    const ox = 38 + rnd() * 8, oy = 34 + rnd() * 5;
    let s = '<rect width="94" height="100" fill="' + p.rock[2] + '"/>';
    // 밖으로 열린 입: 하늘과 먼 산
    const mouth = 'M' + f(ox - 20) + ' ' + f(oy + 20) + 'Q' + f(ox - 26) + ' ' + f(oy - 6) + ' ' + f(ox - 10) + ' ' + f(oy - 20) + 'Q' + f(ox + 4) + ' ' + f(oy - 28) + ' ' + f(ox + 16) + ' ' + f(oy - 14) + 'Q' + f(ox + 28) + ' ' + f(oy + 2) + ' ' + f(ox + 20) + ' ' + f(oy + 20) + 'Z';
    s += '<path d="' + mouth + '" fill="url(#eg-sky-' + p.time + ')" stroke="' + p.ink + '" stroke-width=".7"/>';
    s += k.p('M' + f(ox - 21) + ' ' + f(oy + 20) + 'l10 -14 7 6 9 -12 15 20z', p.far, 0.5);
    s += k.h('M' + f(ox - 4) + ' ' + f(oy + 12) + 'l9 -12 15 20h-22z', 'A', 0.8);
    if (p.time !== 'day' && p.time !== 'snow') s += '<circle cx="' + f(ox - 4) + '" cy="' + f(oy - 9) + '" r="3.400" fill="' + p.paper + '" stroke="' + p.ink + '" stroke-width=".4"/>';
    s += '<rect class="eg-fine" width="94" height="100" fill="url(#eg-hX2)" opacity="' + f(p.hop * 0.42) + '"/>';
    s += '<path d="' + mouth + '" fill="url(#eg-sky-' + p.time + ')" opacity=".55"/>';
    // 입 둘레의 밝은 바위 테
    s += k.l(mouth, 2.2, 0.5, p.rock[0]) + k.l(mouth, 0.7);
    // 종유석
    let st = '';
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x = 4 + i * 14 + rnd() * 6, w = 3 + rnd() * 4, h2 = 10 + rnd() * 16;
      st += 'M' + f(x - w) + ' 0Q' + f(x - w * 0.3) + ' ' + f(h2 * 0.5) + ' ' + f(x) + ' ' + f(h2) + 'Q' + f(x + w * 0.3) + ' ' + f(h2 * 0.5) + ' ' + f(x + w) + ' 0Z';
    }
    s += k.p(st, p.rock[1], 0.6) + k.h(st, 'A', 0.9);
    // 바닥과 석순
    s += k.p('M0 72Q22 64 44 70T94 66V100H0Z', p.rock[1], 0.6);
    s += k.f('M' + f(ox - 16) + ' 70Q' + f(ox) + ' 64 ' + f(ox + 18) + ' 69L' + f(ox + 26) + ' 100H' + f(ox - 30) + 'Z', p.rock[0], 0.55);
    let sg = '';
    for (const x of [30 + rnd() * 4, 44 + rnd() * 5, 90]) { const w = 2.5 + rnd() * 2.5, h2 = 8 + rnd() * 9; sg += 'M' + f(x - w) + ' 74Q' + f(x - w * 0.2) + ' ' + f(74 - h2 * 0.5) + ' ' + f(x) + ' ' + f(74 - h2) + 'Q' + f(x + w * 0.3) + ' ' + f(74 - h2 * 0.5) + ' ' + f(x + w) + ' 74Z'; }
    s += k.p(sg, p.rock[0], 0.6);
    if (v % 2 === 1) {
      // 둘째 구멍으로 드는 빛
      const hx = ox + 34 + rnd() * 6, hy = 16 + rnd() * 6;
      const hole = 'M' + f(hx - 6) + ' ' + f(hy + 5) + 'q-2 -9 5 -11q8 0 8 7q0 6 -6 7q-5 1 -7 -3z';
      s += '<path d="' + hole + '" fill="url(#eg-sky-' + p.time + ')" stroke="' + p.ink + '" stroke-width=".7"/>' + k.l(hole, 1.6, 0.45, p.rock[0]);
      s += k.f('M' + f(hx - 5) + ' ' + f(hy + 4) + 'L' + f(hx - 22) + ' 74h14L' + f(hx + 6) + ' ' + f(hy + 3) + 'Z', p.paper, 0.13);
      // 고인 물
      s += k.p('M28 90q10 -5 22 -1q4 3 -2 6q-12 4 -22 0q-3 -3 2 -5z', p.sea[0], 0.5);
      s += k.fl('M32 92h10M36 94.500h12M40 90h7', 0.35, 0.7);
    }
    s += pebbles(k, rnd, 80, 98);
    s += crystals(k, p, rnd, 62 + rnd() * 3, 85, 40 + rnd() * 4);
    return s;
  }

  /* ── 2단계: 옮기고 다듬는 곳 (염색한 천이 색을 맡는다) ── */

  /** 잔물결 @param {Pen} k @param {() => number} rnd @param {number} y0 @param {number} y1 @param {number} [x0] */
  function waves(k, rnd, y0, y1, x0) {
    let fine = '', bold = '';
    let y = y0 + 2, step = 2.6;
    while (y < y1) {
      const n = 5 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const x = (x0 || 0) + rnd() * 92, w = 2 + (y - y0) * 0.09 + rnd() * 2;
        const seg = 'M' + f(x) + ' ' + f(y) + 'q' + f(w / 2) + ' ' + f(-w * 0.32) + ' ' + f(w) + ' 0q' + f(w / 2) + ' ' + f(w * 0.3) + ' ' + f(w) + ' 0';
        if (i === 0 && rnd() < 0.6) bold += seg; else fine += seg;
      }
      y += step; step *= 1.16;
    }
    return k.fl(fine, 0.35, 0.7) + k.l(bold, 0.45, 0.6);
  }

  /** 범선(돛이 색을 맡는다) @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneShip(k, p, rnd, v) {
    const hz = 63;
    let s = sky(k, p, rnd, hz);
    // 먼 항구: 방파제와 등대 또는 곶
    if (v % 2 === 0) {
      s += k.p('M0 ' + hz + 'V55Q12 51 24 54h10v-12l2.500 -3.500 2.500 3.500v12l9 2 6 ' + f(hz - 56) + 'Z', p.far, 0.5);
      s += k.fl('M35 46h3M35 50h3', 0.4, 0.7) + k.f('M35.500 43h2v2h-2z', p.mode === 'dark' ? '#f6dc9a' : p.dark);
    } else {
      s += k.p('M0 ' + hz + 'V46l8 -6 7 4 6 -3 8 9 10 5 8 ' + f(hz - 55) + 'Z', p.far, 0.5) + k.h('M21 41l8 9 10 5 8 8H24Z', 'A', 0.7);
    }
    s += k.p('M0 ' + hz + 'H94V100H0Z', p.sea[0], 0.5);
    s += k.h('M0 ' + hz + 'H94V' + (hz + 9) + 'H0Z', 'H', 0.7);
    s += waves(k, rnd, hz, 100);
    const sx = 60 + rnd() * 4, wy = 77 + rnd() * 3;
    const three = v % 3 !== 2;
    let g = '';
    // 돛대와 밧줄
    g += k.fl('M0 10L-23 ' + f(wy - 12) + 'M0 10L22 ' + f(wy - 16) + 'M-14 21L-30 ' + f(wy - 17) + 'M0 12L-14 21' + (three ? 'M15 24L0 14' : ''), 0.3, 0.7);
    g += k.l('M0 ' + f(wy - 8) + 'V8M-14 ' + f(wy - 12) + 'V19' + (three ? 'M15 ' + f(wy - 14) + 'V22' : ''), 1, 1, p.wood[2]);
    g += k.l('M-21 ' + f(wy - 11) + 'L-32 ' + f(wy - 18), 0.9, 1, p.wood[2]);
    // 앞돛
    const fore = 'M-22 33Q-26 42 -23.500 51L-6.500 51Q-9 42 -6 33Z', foreTop = 'M-19.500 22Q-22 26.500 -20.500 31L-8.500 31Q-10 26.500 -8.500 22Z';
    g += k.dy(fore, 2) + k.dy('M-22 33Q-26 42 -23.500 51L-18 51Q-20.500 42 -17 33Z', 3, 0) + k.dy('M-11 33Q-13.500 42 -11.500 51L-6.500 51Q-9 42 -6 33Z', 1, 0) + k.dh('M-11 33Q-13.500 42 -11.500 51L-6.500 51Q-9 42 -6 33Z', 0.8);
    g += k.dy(foreTop, 2) + k.dy('M-12 22Q-13.500 26.500 -12.500 31L-8.500 31Q-10 26.500 -8.500 22Z', 1, 0);
    g += k.l(fore + foreTop, 0.7, 1, p.dink);
    // 큰돛
    const main = 'M-10 27Q-15 39 -11.500 51L11 51Q7.500 39 11 27Z', mainTop = 'M-7 13Q-10 19 -8 25L8.500 25Q6 19 8 13Z';
    g += k.dy(main, 2) + k.dy('M-10 27Q-15 39 -11.500 51L-4 51Q-7.500 39 -3 27Z', 3, 0) + k.dy('M4 27Q0.500 39 4 51L11 51Q7.500 39 11 27Z', 1, 0) + k.dh('M4 27Q0.500 39 4 51L11 51Q7.500 39 11 27Z', 0.8);
    g += k.dy(mainTop, 2) + k.dy('M-7 13Q-10 19 -8 25L-2.500 25Q-4.500 19 -2 13Z', 3, 0) + k.dy('M3.500 13Q1.500 19 3.500 25L8.500 25Q6 19 8 13Z', 1, 0);
    g += k.fl('M-3 27Q-7.500 39 -4 51M4 27Q0.500 39 4 51M-12.700 39H9', 0.35, 0.7, p.dink);
    g += k.l(main + mainTop, 0.7, 1, p.dink);
    // 활대
    g += k.l('M-12 27H13M-9 13H10M-24 33H-4M-21.500 22H-6.500', 1, 1, p.wood[2]);
    if (three) {
      const lat = 'M24 21L9 45Q16 50 23 52Z';
      g += k.dy(lat, 2) + k.dy('M24 21L18 30.500Q20 42 23 52Z', 1, 0) + k.dh('M24 21L18 30.500Q20 42 23 52Z', 0.8) + k.l(lat, 0.7, 1, p.dink);
      g += k.l('M26 18L7 48', 1, 1, p.wood[2]);
    }
    // 깃발
    g += k.dy('M0 8.500q-6 -2.500 -12 -.5q4 1 5 2.500q-3 0 -5 1.200q6 1.500 12 -.4z', 2, 0.5);
    // 선체
    const hull = 'M-24 ' + f(wy - 8) + 'v-4.500h11v4h23v-6l13 -2.500l-1 15Q0 ' + f(wy + 3.500) + ' -20 ' + f(wy - 1) + 'Z';
    g += k.p(hull, p.wood[1], 0.75);
    g += k.h('M-22 ' + f(wy - 4) + 'L22 ' + f(wy - 5) + 'l-.5 5Q0 ' + f(wy + 3.500) + ' -20 ' + f(wy - 1) + 'Z', 'A', 1);
    g += k.fl('M-23 ' + f(wy - 5.500) + 'Q0 ' + f(wy - 2) + ' 22.500 ' + f(wy - 8) + 'M-13 ' + f(wy - 8.500) + 'v3M10 ' + f(wy - 8.500) + 'v3', 0.4, 0.8);
    g += k.f('M12.500 ' + f(wy - 11.500) + 'h2v2h-2zM16.500 ' + f(wy - 12.300) + 'h2v2h-2z', p.mode === 'dark' ? '#f6dc9a' : p.dark);
    g += k.l('M-24 ' + f(wy - 12.500) + 'h11M10 ' + f(wy - 14) + 'l13 -2.500', 0.8, 1, p.wood[0]);
    s += '<g transform="translate(' + f(sx) + ' 0)' + (v % 2 === 1 ? ' scale(-1 1)' : '') + '">' + g + '</g>';
    // 뱃전의 흰 물결
    s += k.l('M' + f(sx - 24) + ' ' + f(wy + 1) + 'q4 -2.500 8 0q4 2.500 8 0q4 -2.500 8 0q4 2.500 8 0q4 -2.500 8 0q4 2 7 0', 0.9, 0.95, p.cloud);
    s += k.fl('M' + f(sx - 26) + ' ' + f(wy + 3.500) + 'q5 -2 10 0q5 2 10 0q5 -2 10 0q5 2 10 0q5 -2 10 0', 0.4, 0.8);
    return s;
  }

  /** 밧줄로 묶은 짐꾸러미 하나 @param {Pen} k @param {Pal} p @param {number} x @param {number} y @param {number} w @param {number} h */
  function bale(k, p, x, y, w, h) {
    const rope = p.mode === 'dark' ? '#cbbd98' : '#e9dcb6';
    const body = 'M' + f(x + 2) + ' ' + f(y) + 'Q' + f(x + w / 2) + ' ' + f(y - 1.8) + ' ' + f(x + w - 2) + ' ' + f(y) + 'Q' + f(x + w + 1.2) + ' ' + f(y + h / 2) + ' ' + f(x + w - 2) + ' ' + f(y + h) + 'Q' + f(x + w / 2) + ' ' + f(y + h + 1.6) + ' ' + f(x + 2) + ' ' + f(y + h) + 'Q' + f(x - 1.2) + ' ' + f(y + h / 2) + ' ' + f(x + 2) + ' ' + f(y) + 'Z';
    const shade = 'M' + f(x + w * 0.62) + ' ' + f(y - 0.6) + 'L' + f(x + w - 2) + ' ' + f(y) + 'Q' + f(x + w + 1.2) + ' ' + f(y + h / 2) + ' ' + f(x + w - 2) + ' ' + f(y + h) + 'Q' + f(x + w / 2) + ' ' + f(y + h + 1.6) + ' ' + f(x + 2) + ' ' + f(y + h) + 'L' + f(x + 1) + ' ' + f(y + h * 0.7) + 'Q' + f(x + w * 0.6) + ' ' + f(y + h * 0.74) + ' ' + f(x + w * 0.62) + ' ' + f(y - 0.6) + 'Z';
    let s = k.dy(body, 2, 0) + k.dy(shade, 1, 0) + k.dh(shade, 0.7);
    s += k.dy('M' + f(x + 3) + ' ' + f(y + 1.5) + 'Q' + f(x + w * 0.3) + ' ' + f(y) + ' ' + f(x + w * 0.56) + ' ' + f(y + 1) + 'L' + f(x + w * 0.54) + ' ' + f(y + 4) + 'Q' + f(x + w * 0.3) + ' ' + f(y + 3) + ' ' + f(x + 2.5) + ' ' + f(y + 5) + 'Z', 3, 0);
    // 주름
    s += k.fl('M' + f(x + w * 0.33) + ' ' + f(y + h * 0.5) + 'q-4 -3 -5 -' + f(h * 0.3) + 'M' + f(x + w * 0.33) + ' ' + f(y + h * 0.5) + 'q-3 3 -5 ' + f(h * 0.32) + 'M' + f(x + w * 0.7) + ' ' + f(y + h * 0.5) + 'q4 -3 5 -' + f(h * 0.3) + 'M' + f(x + w * 0.7) + ' ' + f(y + h * 0.5) + 'q3 3 4 ' + f(h * 0.3) + 'M' + f(x + w * 0.5) + ' ' + f(y + 2) + 'v' + f(h * 0.3), 0.35, 0.75, p.dink);
    s += k.l(body, 0.75, 1, p.dink);
    // 밧줄: 세로 두 줄, 가로 한 줄
    const r1 = 'M' + f(x + w * 0.33) + ' ' + f(y - 0.8) + 'V' + f(y + h + 0.8) + 'M' + f(x + w * 0.7) + ' ' + f(y - 0.8) + 'V' + f(y + h + 0.8) + 'M' + f(x - 0.4) + ' ' + f(y + h * 0.5) + 'H' + f(x + w + 0.4);
    s += k.l(r1, 1.5, 1, p.ink) + k.l(r1, 0.8, 1, rope);
    s += '<circle cx="' + f(x + w * 0.33) + '" cy="' + f(y + h * 0.5) + '" r="1.200" fill="' + rope + '" stroke="' + p.ink + '" stroke-width=".4"/><circle cx="' + f(x + w * 0.7) + '" cy="' + f(y + h * 0.5) + '" r="1.200" fill="' + rope + '" stroke="' + p.ink + '" stroke-width=".4"/>';
    return s;
  }

  /** 통 @param {Pen} k @param {Pal} p @param {number} x @param {number} y @param {number} w @param {number} h */
  function barrel(k, p, x, y, w, h) {
    const dd = 'M' + f(x) + ' ' + f(y) + 'Q' + f(x - w * 0.14) + ' ' + f(y + h / 2) + ' ' + f(x) + ' ' + f(y + h) + 'H' + f(x + w) + 'Q' + f(x + w * 1.14) + ' ' + f(y + h / 2) + ' ' + f(x + w) + ' ' + f(y) + 'Z';
    let s = k.p(dd, p.wood[0], 0.65);
    s += k.h('M' + f(x + w * 0.6) + ' ' + f(y) + 'V' + f(y + h) + 'H' + f(x + w) + 'Q' + f(x + w * 1.14) + ' ' + f(y + h / 2) + ' ' + f(x + w) + ' ' + f(y) + 'Z', 'A', 1);
    s += k.l('M' + f(x - w * 0.06) + ' ' + f(y + h * 0.24) + 'h' + f(w * 1.12) + 'M' + f(x - w * 0.06) + ' ' + f(y + h * 0.76) + 'h' + f(w * 1.12), 1, 0.9, p.wood[2]);
    s += k.fl('M' + f(x + w * 0.3) + ' ' + f(y) + 'v' + f(h) + 'M' + f(x + w * 0.62) + ' ' + f(y) + 'v' + f(h), 0.3, 0.6);
    return s;
  }

  /** 부두의 짐꾸러미와 기중기 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneBales(k, p, rnd, v) {
    const hz = 50;
    let s = sky(k, p, rnd, hz);
    // 먼 바다와 돛대
    s += k.p('M0 ' + hz + 'H94V62H0Z', p.sea[0], 0.4) + k.h('M0 ' + hz + 'H94V62H0Z', 'H', 0.7);
    s += k.fl('M30 ' + hz + 'v-16M27 ' + (hz - 12) + 'h6M27.500 ' + (hz - 7) + 'h5M36 ' + hz + 'v-11M34 ' + (hz - 8) + 'h4', 0.45, 0.7);
    s += k.p('M25 ' + (hz + 1) + 'q8 2.500 15 0l-1 -2.500h-13z', p.far, 0.4);
    if (v % 2 === 0) {
      // 창고 벽과 아치문
      s += k.p('M56 0H94V62H56Z', p.plaster[0], 0.6) + k.h('M74 0H94V62H74Z', 'B', 0.5);
      s += k.p('M66 62V30a10 10 0 0 1 20 0V62Z', p.dark, 0.6);
      s += k.fl('M56 12h10M70 6h12M86 14h8M56 24h7M90 34h4M56 40h8M58 52h6', 0.35, 0.7);
      s += k.l('M56 0V62', 0.9);
    } else {
      // 먼 창고 지붕들
      s += k.p('M58 ' + hz + 'v-14l9 -7 9 7v-5l8 -6 10 7V' + hz + 'Z', p.far, 0.5);
      s += k.h('M76 36v-5l8 -6 10 7V' + hz + 'H76Z', 'A', 0.6) + k.fl('M63 41v4M70 41v4M82 38v5M88 38v5', 0.8, 0.5);
    }
    // 부두 바닥
    s += k.p('M0 62H94V100H0Z', p.ground, 0.6);
    s += k.fl('M0 70H94M0 82H94M10 62L4 70M30 62L27 70M52 62L52 70M74 62L77 70M90 62L94 68M16 70L6 82M40 70L36 82M64 70L66 82M86 70L92 82M24 82L10 100M48 82L46 100M72 82L78 100', 0.35, 0.6);
    s += k.h('M0 62H94V68H0Z', 'H', 0.5);
    // 기중기
    const cx = 34 + rnd() * 3, tip = 62 + rnd() * 5;
    s += beam(k, p, [[cx - 1.8, 72], [cx - 1.4, 9], [cx + 1.4, 9], [cx + 1.8, 72]], 1);
    s += beam(k, p, [[cx - 2, 12.5], [tip, 4], [tip + 0.5, 6.5], [cx - 2, 15.5]], 0);
    s += k.l('M' + f(cx) + ' 32L' + f(cx + (tip - cx) * 0.62) + ' 9', 1.3, 1, p.wood[2]);
    s += k.p('M' + f(cx - 6) + ' 76l6 -8 6 8z', p.wood[2], 0.6);
    // 매달린 꾸러미와 밧줄
    const bx = tip - 13, byy = 28 + rnd() * 4;
    s += k.l('M' + f(tip - 0.5) + ' 6.500V' + f(byy - 8), 0.6);
    s += k.l('M' + f(tip - 0.5) + ' ' + f(byy - 8) + 'L' + f(bx + 3) + ' ' + f(byy) + 'M' + f(tip - 0.5) + ' ' + f(byy - 8) + 'L' + f(bx + 23) + ' ' + f(byy), 0.5);
    s += bale(k, p, bx, byy, 26, 17);
    // 바닥의 꾸러미 둘
    s += '<ellipse cx="66" cy="87" rx="27" ry="3.500" fill="url(#eg-shade)" opacity=".7"/>';
    s += bale(k, p, 66, 62 + rnd() * 2, 25, 22) + bale(k, p, 42 + rnd() * 2, 65, 26, 20);
    // 통
    s += barrel(k, p, 27, 72, 11, 15);
    if (v % 2 === 1) s += barrel(k, p, 80, 86, 10, 12);
    return s;
  }

  /** 드리운 천(탁자·작업대 앞에 늘어진 벨벳) @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} x0 @param {number} x1 @param {number} yt 윗면 위 @param {number} ye 탁자 모서리 @param {number} yb 아래 끝 */
  function drape(k, p, rnd, x0, x1, yt, ye, yb) {
    const top = 'M' + f(x0 + 4) + ' ' + f(yt) + 'H' + f(x1) + 'V' + f(ye) + 'H' + f(x0) + 'Z';
    // 아래 끝은 완만한 물결
    let bot = 'M' + f(x0) + ' ' + f(ye) + 'H' + f(x1) + 'V' + f(yb);
    const n = 5, w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) bot += 'q' + f(-w / 2) + ' ' + f(i % 2 ? 3 : -2.5) + ' ' + f(-w) + ' 0';
    bot += 'Z';
    let s = k.dy(bot, 2) + k.dy(top, 3);
    // 주름: 어두운 골
    for (let i = 0; i < n; i++) {
      const fx = x0 + w * (i + 0.55) + (rnd() - 0.5) * 2, fw = w * (0.24 + rnd() * 0.12);
      const fold = 'M' + f(fx) + ' ' + f(ye) + 'q' + f(fw * 0.6) + ' ' + f((yb - ye) * 0.5) + ' ' + f(-fw * 0.2) + ' ' + f(yb - ye - 1) + 'h' + f(fw) + 'q' + f(fw * 0.7) + ' ' + f(-(yb - ye) * 0.5) + ' ' + f(0.2) + ' ' + f(-(yb - ye - 1)) + 'Z';
      s += k.dy(fold, 1, 0) + k.dh(fold, 0.8);
      s += k.l('M' + f(fx - fw * 0.9) + ' ' + f(ye + 2) + 'q' + f(fw * 0.4) + ' ' + f((yb - ye) * 0.4) + ' ' + f(-fw * 0.2) + ' ' + f(yb - ye - 6), 0.8, 0.8, p.D[4]);
    }
    s += k.l('M' + f(x0) + ' ' + f(ye) + 'H' + f(x1), 0.6, 1, p.dink);
    // 금실 술
    let fr = '';
    for (let x = x0 + 1; x < x1; x += 2.2) fr += 'M' + f(x) + ' ' + f(yb - 0.5) + 'v2.400';
    s += k.fl(fr, 0.5, 0.9, p.brass[1]);
    return s;
  }

  /** 작게 깎은 보석(색을 맡은 물건의 일부) @param {Pen} k @param {Pal} p @param {number} x @param {number} y @param {number} r */
  function cutGem(k, p, x, y, r) {
    let s = k.dy('M' + f(x - r) + ' ' + f(y - r * 0.35) + 'l' + f(r * 0.5) + ' ' + f(-r * 0.6) + 'h' + f(r) + 'l' + f(r * 0.5) + ' ' + f(r * 0.6) + 'L' + f(x) + ' ' + f(y + r) + 'Z', 2, 0.5);
    s += k.dy('M' + f(x - r) + ' ' + f(y - r * 0.35) + 'l' + f(r * 0.5) + ' ' + f(-r * 0.6) + 'h' + f(r * 0.5) + 'l' + f(-r * 0.3) + ' ' + f(r * 0.6) + 'Z', 4, 0) + k.dy('M' + f(x + r * 0.3) + ' ' + f(y - r * 0.35) + 'h' + f(r * 0.7) + 'L' + f(x) + ' ' + f(y + r) + 'Z', 1, 0);
    s += k.fl('M' + f(x - r) + ' ' + f(y - r * 0.35) + 'h' + f(r * 2) + 'M' + f(x - r * 0.3) + ' ' + f(y - r * 0.35) + 'L' + f(x) + ' ' + f(y + r) + 'L' + f(x + r * 0.3) + ' ' + f(y - r * 0.35), 0.3, 0.8, p.dink);
    return s;
  }

  /** 안쪽 벽과 아치 창 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} wx 창 왼쪽 @param {number} ww @param {number} wt @param {number} wb @param {boolean} [city] */
  function wallWindow(k, p, rnd, wx, ww, wt, wb, city) {
    let s = '<rect width="94" height="100" fill="' + p.plaster[0] + '"/>';
    s += '<rect class="eg-fine" x="50" width="44" height="100" fill="url(#eg-hB)" opacity="' + f(p.hop * 0.5) + '"/>';
    s += '<rect class="eg-fine" x="72" width="22" height="100" fill="url(#eg-hA)" opacity="' + f(p.hop * 0.5) + '"/>';
    const r = ww / 2;
    const open = 'M' + f(wx) + ' ' + f(wb) + 'V' + f(wt + r) + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(ww) + ' 0V' + f(wb) + 'Z';
    s += k.p('M' + f(wx - 3) + ' ' + f(wb + 2.5) + 'V' + f(wt + r) + 'a' + f(r + 3) + ' ' + f(r + 3) + ' 0 0 1 ' + f(ww + 6) + ' 0V' + f(wb + 2.5) + 'Z', p.rock[0], 0.6);
    s += '<path d="' + open + '" fill="url(#eg-sky-' + p.time + ')" stroke="' + p.ink + '" stroke-width=".6"/>';
    if (city) {
      // 창밖 도시 윤곽: 둥근 지붕과 탑
      const b = wb, m = wx + r;
      s += k.p('M' + f(wx) + ' ' + f(b) + 'v-7h' + f(r * 0.5) + 'v-4q' + f(r * 0.4) + ' ' + f(-r * 0.7) + ' ' + f(r * 0.8) + ' 0v4h' + f(r * 0.2) + 'v-' + f(r * 1.1) + 'h' + f(r * 0.24) + 'v' + f(r * 1.1 + 2) + 'h' + f(r * 0.26) + 'V' + f(b) + 'Z', p.far, 0.4);
      s += k.fl('M' + f(m - r * 0.1) + ' ' + f(b - 11 - r * 0.36) + 'v-2.500', 0.4, 0.9);
    } else {
      s += k.p('M' + f(wx) + ' ' + f(wb) + 'v-5l' + f(ww * 0.3) + ' -4 ' + f(ww * 0.3) + ' 3 ' + f(ww * 0.4) + ' -5V' + f(wb) + 'Z', p.far, 0.4);
    }
    if (p.time !== 'day' && p.time !== 'snow') s += '<circle cx="' + f(wx + ww * 0.68) + '" cy="' + f(wt + r * 0.9) + '" r="2.300" fill="' + p.paper + '" stroke="' + p.ink + '" stroke-width=".35"/>';
    s += k.l('M' + f(wx + r) + ' ' + f(wt) + 'V' + f(wb) + 'M' + f(wx) + ' ' + f(wt + r + (wb - wt - r) * 0.45) + 'h' + f(ww), 0.8, 1);
    s += k.p('M' + f(wx - 5) + ' ' + f(wb + 1) + 'h' + f(ww + 10) + 'v2.800h' + f(-ww - 10) + 'z', p.rock[0], 0.6);
    // 창으로 드는 빛
    s += k.f('M' + f(wx + ww) + ' ' + f(wt + r) + 'L94 ' + f(wt + r + 26) + 'V' + f(wb + 40) + 'L' + f(wx + ww) + ' ' + f(wb) + 'Z', p.paper, p.mode === 'dark' ? 0.12 : 0.3);
    return s;
  }

  /** 상인의 천칭 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneScale(k, p, rnd, v) {
    let s = wallWindow(k, p, rnd, 28 + rnd() * 3, 17, 8, 44, v % 2 === 1);
    const B = p.brass;
    // 탁자
    s += k.p('M0 64H94V72H0Z', p.wood[0], 0.6) + k.p('M0 72H94V100H0Z', p.wood[1], 0.6) + k.h('M0 72H94V100H0Z', 'A', 0.9);
    s += k.fl('M0 80H94M0 90H94M14 72v8M46 80v10M30 90v10', 0.35, 0.6);
    s += drape(k, p, rnd, 40, 94, 62, 71, 91 + rnd() * 3);
    // 천칭
    const cx = 65 + rnd() * 2, tilt = (v % 2 === 0 ? 1 : -1) * (2 + rnd() * 1.5);
    const lx = cx - 20, rx = cx + 20, ly = 24 + tilt, ry = 24 - tilt;
    s += k.p('M' + f(cx - 9) + ' 67q9 -6 18 0q-9 2.500 -18 0z', B[1], 0.6);
    s += k.p('M' + f(cx - 1.3) + ' 64V26h2.600V64Z', B[0], 0.6) + k.h('M' + f(cx) + ' 64V26h1.300V64Z', 'A', 1);
    s += k.p('M' + f(cx - 2.6) + ' 44h5.200v2.400h-5.200zM' + f(cx - 2.2) + ' 61h4.400v3h-4.400z', B[1], 0.5);
    s += k.p('M' + f(lx) + ' ' + f(ly - 1) + 'L' + f(cx) + ' 21.500L' + f(rx) + ' ' + f(ry - 1) + 'l0 2L' + f(cx) + ' 25.500L' + f(lx) + ' ' + f(ly + 1) + 'Z', B[0], 0.6);
    s += '<circle cx="' + f(cx) + '" cy="23.500" r="2.600" fill="' + B[1] + '" stroke="' + p.ink + '" stroke-width=".6"/>';
    s += k.p('M' + f(cx - 1) + ' 21l1 -5 1 5z', B[1], 0.5);
    for (const [ex, ey, gems] of [[lx, ly, tilt > 0], [rx, ry, tilt <= 0]]) {
      const py = /** @type {number} */ (ey) + 22, x = /** @type {number} */ (ex);
      s += k.l('M' + f(x) + ' ' + f(/** @type {number} */ (ey) + 1) + 'L' + f(x - 7) + ' ' + f(py) + 'M' + f(x) + ' ' + f(/** @type {number} */ (ey) + 1) + 'L' + f(x + 7) + ' ' + f(py) + 'M' + f(x) + ' ' + f(/** @type {number} */ (ey) + 1) + 'V' + f(py), 0.4, 0.9);
      if (gems) s += cutGem(k, p, x - 3, py - 2.4, 3) + cutGem(k, p, x + 3, py - 2.2, 2.8) + cutGem(k, p, x, py - 4.6, 3);
      else s += k.p('M' + f(x - 4) + ' ' + f(py) + 'v-4h3.400v4zM' + f(x + 0.4) + ' ' + f(py) + 'v-6h4v6z', B[1], 0.5) + k.fl('M' + f(x - 4) + ' ' + f(py - 2.6) + 'h3.400M' + f(x + 0.4) + ' ' + f(py - 4) + 'h4', 0.3, 0.8);
      s += k.p('M' + f(x - 8) + ' ' + f(py) + 'h16q-1.500 6 -8 6t-8 -6z', B[0], 0.6);
      s += k.h('M' + f(x) + ' ' + f(py) + 'h8q-1.500 6 -8 6z', 'A', 1);
    }
    // 천 위에 놓인 보석과 추
    s += cutGem(k, p, 48 + rnd() * 3, 66, 2.6) + cutGem(k, p, 84 + rnd() * 3, 66.500, 2.4);
    s += k.p('M' + f(cx + 12) + ' 68v-3.500h3v3.500zM' + f(cx + 15.6) + ' 68v-2.500h2.400v2.500z', B[1], 0.5);
    return s;
  }

  /** 세공 작업대: 돌림 숫돌, 확대경, 깎다 만 원석 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneBench(k, p, rnd, v) {
    let s = wallWindow(k, p, rnd, 60 + rnd() * 6, 15, 5, 30, v % 2 === 0);
    const B = p.brass;
    // 벽에 건 연장
    s += k.l('M26 9H52', 0.9, 1, p.wood[2]);
    s += k.fl('M31 9v9l-1.500 6h3l-1.500 -6M38 9v7m-2 0h4l-.6 8h-2.800zM46 9v6q-3 3 0 8q3 -5 0 -8', 0.5, 0.9);
    // 작업대
    s += k.p('M0 62H94V70H0Z', p.wood[0], 0.6) + k.p('M0 70H94V100H0Z', p.wood[1], 0.6) + k.h('M0 70H94V100H0Z', 'A', 0.9);
    s += k.fl('M0 79H94M0 89H94M20 70v9M8 79v10', 0.35, 0.6);
    s += drape(k, p, rnd, 46, 94, 60, 69, 88 + rnd() * 3);
    // 돌림 숫돌
    const gx = 33 + rnd() * 3, gy = 44;
    s += beam(k, p, [[gx - 11, 62], [gx - 2, gy - 1], [gx + 0.5, gy - 1], [gx - 7.5, 62]], 1) + beam(k, p, [[gx + 7.5, 62], [gx - 0.5, gy - 1], [gx + 2, gy - 1], [gx + 11, 62]], 1);
    s += '<circle cx="' + f(gx) + '" cy="' + gy + '" r="13" fill="' + p.rock[0] + '" stroke="' + p.ink + '" stroke-width=".8"/>';
    s += '<path class="eg-fine" d="M' + f(gx) + ' ' + (gy - 13) + 'a13 13 0 0 1 0 26a16 13 0 0 0 0 -26z" fill="url(#eg-hA)" opacity="' + f(p.hop) + '"/>';
    s += '<circle cx="' + f(gx) + '" cy="' + gy + '" r="9.500" fill="none" stroke="' + p.ink + '" stroke-width=".35" class="eg-fine"/><circle cx="' + f(gx) + '" cy="' + gy + '" r="2.200" fill="' + p.wood[2] + '" stroke="' + p.ink + '" stroke-width=".5"/>';
    s += k.l('M' + f(gx) + ' ' + gy + 'l10 -6v-4', 0.9) + k.l('M' + f(gx + 8.5) + ' ' + (gy - 10) + 'h3.200', 1.6, 1, p.wood[2]);
    // 방석 위의 깎다 만 원석
    const rx = 64 + rnd() * 4, ry = 60;
    s += k.p('M' + f(rx - 6) + ' ' + ry + 'h12l-1.500 2.500h-9z', B[1], 0.5);
    const rough = 'M' + f(rx - 9) + ' ' + f(ry - 5) + 'l2 -8 6 -5 7 1 4 6 -1 7 -5 4h-9z';
    s += k.dy(rough, 2);
    s += k.dy('M' + f(rx - 9) + ' ' + f(ry - 5) + 'l2 -8 6 -5 1 6 -4 6z', 4, 0) + k.dy('M' + f(rx - 1) + ' ' + f(ry - 18) + 'l7 1 -3 6 -3 -1z', 3, 0) + k.dy('M' + f(rx + 6) + ' ' + f(ry - 17) + 'l4 6 -1 7 -5 4 -1 -9z', 1, 0);
    s += k.dh('M' + f(rx + 6) + ' ' + f(ry - 17) + 'l4 6 -1 7 -5 4 -1 -9z', 0.8);
    s += k.fl('M' + f(rx - 4) + ' ' + f(ry - 6) + 'l4 -6 3 1 1 9M' + f(rx - 1) + ' ' + f(ry - 18) + 'l1 6', 0.35, 0.8, p.dink) + k.l(rough, 0.7, 1, p.dink);
    s += '<path d="M' + f(rx - 4) + ' ' + f(ry - 16.500) + 'l.7 2.300 2.300.7-2.300.7-.7 2.300-.7-2.300-2.300-.7 2.300-.7z" fill="#fff"/>';
    // 확대경
    const lx = 84 + rnd() * 3;
    s += k.l('M' + f(lx) + ' 60V48', 1.2, 1, B[2]) + k.p('M' + f(lx - 4) + ' 62q4 -3.500 8 0z', B[1], 0.5);
    s += '<circle cx="' + f(lx) + '" cy="41" r="7" fill="' + p.paper + '" fill-opacity=".55" stroke="' + p.ink + '" stroke-width="2.300"/><circle cx="' + f(lx) + '" cy="41" r="7" fill="none" stroke="' + B[0] + '" stroke-width="1.300"/>';
    s += k.fl('M' + f(lx - 3.5) + ' 38q2 -3 5 -2.500', 0.6, 0.9, '#fff');
    // 다듬은 작은 보석과 연장
    s += cutGem(k, p, 52 + rnd() * 2, 64, 2.4) + cutGem(k, p, 76 + rnd() * 2, 65, 2.2);
    s += k.l('M' + f(rx + 14) + ' 64.500l8 -2', 0.7) + k.l('M' + f(rx - 13) + ' 66l-5 -3', 1.2, 1, p.wood[2]);
    // 촛불
    if (v % 2 === 1) {
      s += '<circle cx="52" cy="40" r="12" fill="url(#eg-lamp)"/>';
      s += k.p('M50.500 60V46h3V60Z', p.paper, 0.5) + k.p('M52 45q-2 -3 0 -6q2 3 0 6z', '#fff3c9', 0.4) + k.p('M48.500 62q3.500 -3.500 7 0z', B[1], 0.5);
    }
    return s;
  }

  /* ── 3단계: 파는 곳 (차양·깃발·진열 벨벳이 색을 맡는다) ── */

  /** 피렌체풍 도시 윤곽과 내건 깃발 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneSkyline(k, p, rnd, v) {
    const hz = 66;
    let s = sky(k, p, rnd, hz);
    // 먼 언덕
    s += k.p('M0 ' + (hz - 8) + 'Q20 ' + (hz - 16) + ' 44 ' + (hz - 9) + 'T94 ' + (hz - 13) + 'V' + hz + 'H0Z', p.far, 0.4);
    const far2 = mix(p.far, p.rock[1], 0.5);
    let city = '';
    // 둥근 지붕(북 모양 받침 + 갈빗대 + 꼭대기 탑)
    const dx = 37 + rnd() * 4;
    city += k.p('M' + f(dx - 12) + ' ' + hz + 'V48h24V' + hz + 'Z', p.far, 0.6);
    city += k.p('M' + f(dx - 12) + ' 48Q' + f(dx - 13) + ' 28 ' + f(dx) + ' 22Q' + f(dx + 13) + ' 28 ' + f(dx + 12) + ' 48Z', far2, 0.7);
    city += k.h('M' + f(dx) + ' 22Q' + f(dx + 13) + ' 28 ' + f(dx + 12) + ' 48H' + f(dx + 2) + 'Q' + f(dx + 3) + ' 30 ' + f(dx) + ' 22Z', 'A', 0.9);
    city += k.fl('M' + f(dx) + ' 22Q' + f(dx - 6) + ' 30 ' + f(dx - 6) + ' 48M' + f(dx) + ' 22Q' + f(dx + 6) + ' 30 ' + f(dx + 6) + ' 48M' + f(dx) + ' 22V48M' + f(dx - 12) + ' 52h24M' + f(dx - 8) + ' 56v5M' + f(dx) + ' 56v5M' + f(dx + 8) + ' 56v5', 0.4, 0.8);
    city += k.p('M' + f(dx - 2) + ' 22v-5h4v5zM' + f(dx - 2.6) + ' 17l2.600 -4.500 2.600 4.500z', p.far, 0.5);
    city += '<circle cx="' + f(dx) + '" cy="11.500" r="1.100" fill="' + p.brass[0] + '" stroke="' + p.ink + '" stroke-width=".35"/>';
    // 종탑
    const tx = v % 2 === 0 ? dx + 17 : dx - 21;
    city += k.p('M' + f(tx) + ' ' + hz + 'V19h7V' + hz + 'Z', p.far, 0.6) + k.p('M' + f(tx - 0.8) + ' 19l4.300 -7 4.300 7z', far2, 0.5);
    city += k.h('M' + f(tx + 4) + ' ' + hz + 'V19h3V' + hz + 'Z', 'A', 0.9);
    city += k.fl('M' + f(tx + 2) + ' 30v-4q1.500 -2 3 0v4M' + f(tx) + ' 34h7M' + f(tx + 2) + ' 44v-3.500q1.500 -2 3 0v3.500M' + f(tx) + ' 48h7M' + f(tx + 3.5) + ' 54v4', 0.4, 0.8);
    // 총안이 있는 망루
    const cx2 = v % 2 === 0 ? dx - 22 : dx + 18;
    city += k.p('M' + f(cx2) + ' ' + hz + 'V32h-1.500v-5h1.500v-2h2v2h2v-2h2v2h1.500v5H' + f(cx2 + 6) + 'V' + hz + 'Z', p.far, 0.6);
    city += k.p('M' + f(cx2 + 1.5) + ' 25V17h3v8z', p.far, 0.5) + k.fl('M' + f(cx2 - 1.5) + ' 30h9M' + f(cx2 + 3) + ' 40v3M' + f(cx2 + 3) + ' 50v3', 0.4, 0.8);
    // 지붕들
    let roofs = '';
    for (let x = 22; x < 96; x += 9 + rnd() * 5) { const h2 = 6 + rnd() * 6, w = 8 + rnd() * 4; roofs += 'M' + f(x) + ' ' + (hz + 1) + 'v-' + f(h2) + 'l' + f(w / 2) + ' -' + f(2.5 + rnd() * 2) + ' ' + f(w / 2) + ' ' + f(2.5 + rnd() * 2) + 'v' + f(h2) + 'Z'; }
    s += city + k.p(roofs, mix(p.far, p.wood[0], 0.35), 0.5) + k.h(roofs, 'B', 0.5);
    // 발코니 난간
    s += k.p('M0 ' + hz + 'H94V100H0Z', p.rock[1], 0.5);
    s += k.p('M0 80H94V84.500H0Z', p.rock[0], 0.65) + k.p('M0 96H94V100H0Z', p.rock[0], 0.65);
    let bal = '';
    for (let x = 3; x < 94; x += 7) bal += 'M' + f(x) + ' 96q-2 -3 0 -5.500q2 -3 0 -6h2.600q-2 3 0 6q2 2.500 0 5.500z';
    s += k.p(bal, p.rock[0], 0.5) + k.h('M0 84.500H94V96H0Z', 'X', 0.55);
    s += k.h('M0 ' + hz + 'H94V80H0Z', 'H', 0.6);
    // 깃대와 깃발
    const bx = 60 + rnd() * 3, bw = 27, top = 13 + rnd() * 2, bot = 70 + rnd() * 4;
    s += k.l('M94 ' + f(top - 1) + 'H' + f(bx - 5), 2, 1, p.ink) + k.l('M94 ' + f(top - 1) + 'H' + f(bx - 5), 1.1, 1, p.wood[0]);
    s += '<circle cx="' + f(bx - 5.5) + '" cy="' + f(top - 1) + '" r="1.700" fill="' + p.brass[0] + '" stroke="' + p.ink + '" stroke-width=".5"/>';
    const tails = v % 2 === 0
      ? 'L' + f(bx + bw / 2) + ' ' + f(bot - 11) + 'L' + f(bx) + ' ' + f(bot)
      : 'L' + f(bx + bw * 0.75) + ' ' + f(bot - 7) + 'L' + f(bx + bw * 0.5) + ' ' + f(bot + 1) + 'L' + f(bx + bw * 0.25) + ' ' + f(bot - 7) + 'L' + f(bx) + ' ' + f(bot);
    const flag = 'M' + f(bx) + ' ' + f(top) + 'H' + f(bx + bw) + 'V' + f(bot) + tails + 'Z';
    s += k.dy(flag, 2);
    s += k.dy('M' + f(bx) + ' ' + f(top) + 'h' + f(bw * 0.24) + 'V' + f(bot - (v % 2 === 0 ? 5 : 6)) + 'L' + f(bx) + ' ' + f(bot) + 'Z', 3, 0);
    const sh = 'M' + f(bx + bw * 0.7) + ' ' + f(top) + 'h' + f(bw * 0.3) + 'V' + f(bot) + 'L' + f(bx + bw * 0.7) + ' ' + f(bot - (v % 2 === 0 ? 6.5 : 6)) + 'Z';
    s += k.dy(sh, 1, 0) + k.dh(sh, 0.8);
    // 깃발 무늬: 같은 색의 밝은 선(테두리와 마름모)
    const my = (top + bot) / 2 - 5, mx = bx + bw / 2;
    s += k.l('M' + f(bx + 3) + ' ' + f(top + 3) + 'H' + f(bx + bw - 3) + 'V' + f(bot - 16), 0.5, 0.8, p.D[4]) + k.l('M' + f(bx + 3) + ' ' + f(top + 3) + 'V' + f(bot - 16), 0.5, 0.8, p.D[4]);
    s += k.dy('M' + f(mx) + ' ' + f(my - 10) + 'l7 10 -7 10 -7 -10z', 3, 0.4) + k.dy('M' + f(mx) + ' ' + f(my - 5) + 'l3.500 5 -3.500 5 -3.500 -5z', p.c === 'w' ? 1 : 4, 0.3);
    s += k.fl('M' + f(bx + bw * 0.24) + ' ' + f(top) + 'V' + f(bot - 6) + 'M' + f(bx + bw * 0.7) + ' ' + f(top) + 'V' + f(bot - 7), 0.35, 0.6, p.dink);
    s += k.l(flag, 0.75, 1, p.dink);
    // 금실 술
    let fr = '';
    for (let x = bx + 1.5; x < bx + bw; x += 3) fr += 'M' + f(x) + ' ' + f(top - 1) + 'v2';
    s += k.fl(fr, 0.7, 1, p.brass[2]);
    // 줄에 단 작은 삼각기
    let pen2 = '';
    for (let i = 0; i < 5; i++) { const t = (i + 0.6) / 5.4; const x = bx - 6 - t * 34, y = top - 1 + Math.sin(t * Math.PI) * 5 - t * 9; pen2 += 'M' + f(x) + ' ' + f(y) + 'l-4.500 .9 1.800 4.600z'; }
    s += k.fl('M' + f(bx - 6) + ' ' + f(top - 1) + 'Q' + f(bx - 24) + ' ' + f(top + 4) + ' ' + f(bx - 40) + ' ' + f(top - 10), 0.35, 0.9) + k.dy(pen2, 2, 0.4);
    return s;
  }

  /** 운하 위 아치 다리와 가게 차양 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneBridge(k, p, rnd, v) {
    const hz = 50, wy = 70;
    let s = sky(k, p, rnd, hz);
    // 먼 집들
    let far = '';
    for (let x = -2; x < 96; x += 10 + rnd() * 5) { const h2 = 16 + rnd() * 16, w = 9 + rnd() * 4; far += 'M' + f(x) + ' ' + wy + 'V' + f(wy - h2) + 'l' + f(w / 2) + ' -3.500 ' + f(w / 2) + ' 3.500V' + wy + 'Z'; }
    s += k.p(far, p.far, 0.5) + k.h(far, 'B', 0.45);
    s += k.fl('M8 46v3M16 52v3M84 44v3M90 50v3M76 52v3', 0.9, 0.5);
    // 물
    s += k.p('M0 ' + wy + 'H94V100H0Z', p.sea[0], 0.5) + k.h('M0 ' + wy + 'H94V' + (wy + 9) + 'H0Z', 'H', 0.8);
    s += waves(k, rnd, wy + 2, 100);
    // 다리
    const a0 = 30 + rnd() * 4, a1 = 88 + rnd() * 3, am = (a0 + a1) / 2, ay = 46 + rnd() * 3;
    const body = 'M0 52Q47 ' + f(ay - 2) + ' 94 52V' + (wy + 1) + 'H' + f(a1) + 'Q' + f(am) + ' ' + f(ay - 6) + ' ' + f(a0) + ' ' + (wy + 1) + 'H0Z';
    s += k.f('M' + f(a0) + ' ' + (wy + 1) + 'Q' + f(am) + ' ' + f(ay - 6) + ' ' + f(a1) + ' ' + (wy + 1) + 'Z', p.dark, p.mode === 'bright' ? 0.5 : 0.75);
    s += k.p(body, p.rock[0], 0.75);
    s += k.h('M0 60H94V' + (wy + 1) + 'H' + f(a1) + 'Q' + f(am) + ' ' + f(ay - 6) + ' ' + f(a0) + ' ' + (wy + 1) + 'H0Z', 'A', 0.7);
    // 아치 돌 금
    let vs = '';
    for (let i = 1; i < 10; i++) { const t = i / 10; const x = a0 + (a1 - a0) * t, y = (1 - t) * (1 - t) * (wy + 1) + 2 * t * (1 - t) * (ay - 6) + t * t * (wy + 1); const nx = (x - am) * 0.12; vs += 'M' + f(x) + ' ' + f(y) + 'l' + f(nx) + ' -3.400'; }
    s += k.fl(vs + 'M0 56Q47 ' + f(ay + 2) + ' 94 56M4 62h10M16 66h8M0 66h6', 0.4, 0.8);
    s += k.l('M0 52Q47 ' + f(ay - 2) + ' 94 52', 1.1);
    // 다리 위 가게들과 차양
    const n = 3;
    for (let i = 0; i < n; i++) {
      const w = 16 + rnd() * 2, x = a0 + 6 + i * 17.5, base = 50.5 - Math.sin((x + w / 2) / 94 * Math.PI) * 2.2, h2 = 13 + rnd() * 5;
      s += k.p('M' + f(x) + ' ' + f(base) + 'v-' + f(h2) + 'h' + f(w) + 'v' + f(h2) + 'Z', p.plaster[0], 0.6);
      s += k.p('M' + f(x - 1) + ' ' + f(base - h2) + 'l' + f(w / 2 + 1) + ' -' + f(4 + rnd() * 2) + ' ' + f(w / 2 + 1) + ' ' + f(4) + 'Z', p.wood[1], 0.6) + k.h('M' + f(x + w / 2) + ' ' + f(base - h2 - 4) + 'l' + f(w / 2 + 1) + ' 4h-' + f(w / 2 + 1) + 'Z', 'A', 0.9);
      s += k.f('M' + f(x + w * 0.3) + ' ' + f(base - h2 + 2) + 'h' + f(w * 0.4) + 'v3h-' + f(w * 0.4) + 'z', p.dark, 0.8);
      const aw = 'M' + f(x + 0.5) + ' ' + f(base - 10.5) + 'h' + f(w - 1) + 'l2 8.500q-' + f((w + 3) / 6) + ' 2.600 -' + f((w + 3) / 3) + ' 0t-' + f((w + 3) / 3) + ' 0t-' + f((w + 3) / 3) + ' 0z';
      s += k.dy(aw, 2);
      s += k.fl('M' + f(x + w * 0.25) + ' ' + f(base - 10.5) + 'l-.9 8.500M' + f(x + w * 0.5) + ' ' + f(base - 10.5) + 'v8.500M' + f(x + w * 0.75) + ' ' + f(base - 10.5) + 'l.9 8.500', 1.5, 0.75, p.D[p.c === 'w' ? 1 : 4]);
      s += k.l(aw, 0.6, 1, p.dink);
      s += k.f('M' + f(x + 2) + ' ' + f(base - 2) + 'h' + f(w - 4) + 'v2h-' + f(w - 4) + 'z', p.dark, 0.5);
    }
    // 난간에 내건 큰 천
    const hx = am - 10 + rnd() * 3, hy = 52 - 2.4;
    const cloth = 'M' + f(hx) + ' ' + f(hy) + 'h20v' + f(20) + 'l-10 -6 -10 6z';
    s += k.dy(cloth, 2) + k.dy('M' + f(hx + 14) + ' ' + f(hy) + 'h6v20l-6 -3.600z', 1, 0) + k.dh('M' + f(hx + 14) + ' ' + f(hy) + 'h6v20l-6 -3.600z', 0.8) + k.dy('M' + f(hx) + ' ' + f(hy) + 'h5v17l-5 3z', 3, 0);
    s += k.dy('M' + f(hx + 10) + ' ' + f(hy + 3.5) + 'l3.500 4.500 -3.500 4.500 -3.500 -4.500z', p.c === 'w' ? 1 : 4, 0.3) + k.l(cloth, 0.7, 1, p.dink);
    // 배와 덮개 천
    const bx = am - 4 + rnd() * 8, by2 = 84 + rnd() * 3;
    s += k.dy('M' + f(bx - 10) + ' ' + f(by2 - 1) + 'v-7q10 -6.500 20 0v7z', 2) + k.dy('M' + f(bx - 10) + ' ' + f(by2 - 1) + 'v-7q4 -2.600 8 -3.200v10.200z', 3, 0) + k.dh('M' + f(bx + 2) + ' ' + f(by2 - 11.2) + 'q4 0 8 3.200v7h-8z', 0.7) + k.l('M' + f(bx - 10) + ' ' + f(by2 - 1) + 'v-7q10 -6.500 20 0v7z', 0.7, 1, p.dink);
    s += k.p('M' + f(bx - 19) + ' ' + f(by2 - 3) + 'q19 5 38 -1l-3 5q-16 4 -32 0z', p.wood[2], 0.7);
    s += k.l('M' + f(bx - 18) + ' ' + f(by2 + 2.5) + 'q4 -1.500 8 0t8 0t8 0t8 0', 0.8, 0.9, p.cloud);
    // 말뚝
    for (const mx of [a0 - 5 + rnd() * 3, 92]) { s += k.p('M' + f(mx - 1.2) + ' 98V' + f(64 + rnd() * 6) + 'h2.400V98Z', p.wood[0], 0.6) + k.fl('M' + f(mx - 1.2) + ' 72l2.400 -2M' + f(mx - 1.2) + ' 80l2.400 -2M' + f(mx - 1.2) + ' 88l2.400 -2', 0.5, 0.8); }
    return s;
  }

  /** 아치 창 너머 보석상 진열장 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneShop(k, p, rnd, v) {
    const B = p.brass;
    let s = '<rect width="94" height="100" fill="' + p.rock[1] + '"/>';
    // 마름돌 벽
    let j = '';
    for (let y = 8; y < 100; y += 11) { j += 'M0 ' + y + 'H94'; for (let x = ((y / 11) % 2) * 9 + 4; x < 94; x += 18) j += 'M' + f(x) + ' ' + y + 'v11'; }
    s += k.fl(j, 0.4, 0.55);
    s += '<rect class="eg-fine" x="0" y="0" width="94" height="100" fill="url(#eg-hB)" opacity="' + f(p.hop * 0.4) + '"/>';
    const x0 = 37 + rnd() * 3, x1 = 89, r = (x1 - x0) / 2, mx = (x0 + x1) / 2, sp = 42, sill = 84;
    // 아치 틀
    s += k.p('M' + f(x0 - 4) + ' ' + (sill + 1) + 'V' + sp + 'a' + f(r + 4) + ' ' + f(r + 4) + ' 0 0 1 ' + f(2 * r + 8) + ' 0V' + (sill + 1) + 'Z', p.rock[0], 0.75);
    let vs = '';
    for (let i = 1; i < 12; i++) { const a = Math.PI + i * Math.PI / 12; vs += 'M' + f(mx + Math.cos(a) * r) + ' ' + f(sp + Math.sin(a) * r) + 'L' + f(mx + Math.cos(a) * (r + 4)) + ' ' + f(sp + Math.sin(a) * (r + 4)); }
    s += k.fl(vs, 0.4, 0.8);
    s += k.p('M' + f(x0) + ' ' + sill + 'V' + sp + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(2 * r) + ' 0V' + sill + 'Z', p.dark, 0.7);
    // 부채꼴 색유리(카드 색과 무채색 유리)
    const N = 6;
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI + i * Math.PI / N, a1 = Math.PI + (i + 1) * Math.PI / N, ri = r - 1.2, rm = r * 0.4;
      const seg = 'M' + f(mx + Math.cos(a0) * rm) + ' ' + f(sp + Math.sin(a0) * rm) + 'L' + f(mx + Math.cos(a0) * ri) + ' ' + f(sp + Math.sin(a0) * ri) + 'A' + f(ri) + ' ' + f(ri) + ' 0 0 1 ' + f(mx + Math.cos(a1) * ri) + ' ' + f(sp + Math.sin(a1) * ri) + 'L' + f(mx + Math.cos(a1) * rm) + ' ' + f(sp + Math.sin(a1) * rm) + 'A' + f(rm) + ' ' + f(rm) + ' 0 0 0 ' + f(mx + Math.cos(a0) * rm) + ' ' + f(sp + Math.sin(a0) * rm) + 'Z';
      if ((i + v) % 2 === 0) s += k.dy(seg, i % 3 === 0 ? 3 : 2, 0.7); else s += k.p(seg, p.mode === 'dark' ? '#cbbf9d' : '#f4ecd2', 0.7);
    }
    s += k.p('M' + f(mx - r * 0.4) + ' ' + sp + 'a' + f(r * 0.4) + ' ' + f(r * 0.4) + ' 0 0 1 ' + f(r * 0.8) + ' 0Z', p.mode === 'dark' ? '#e6d9b8' : '#fff6d9', 0.7);
    s += k.l('M' + f(x0) + ' ' + sp + 'H' + f(x1), 1.6, 1, p.wood[2]);
    // 안으로 드는 빛
    s += k.f('M' + f(mx - r * 0.5) + ' ' + sp + 'L' + f(x0 + 2) + ' ' + sill + 'H' + f(mx + 2) + 'L' + f(mx + r * 0.2) + ' ' + sp + 'Z', '#fff3c9', p.mode === 'bright' ? 0.3 : 0.16);
    // 벨벳을 씌운 계단 진열대
    const st = [[mx - r * 0.42, mx + r * 0.42, 56], [mx - r * 0.68, mx + r * 0.68, 65], [x0 + 1.2, x1 - 1.2, 74]];
    for (let i = 0; i < 3; i++) {
      const [l, rr, y] = st[i];
      const yb = i < 2 ? st[i + 1][2] : sill;
      s += k.dy('M' + f(l) + ' ' + f(y) + 'H' + f(rr) + 'V' + f(yb) + 'H' + f(l) + 'Z', 2, 0.6);
      s += k.dy('M' + f(l + 2.5) + ' ' + f(y - 2.6) + 'H' + f(rr - 2.5) + 'L' + f(rr) + ' ' + f(y) + 'H' + f(l) + 'Z', 3, 0.6);
      const sh = 'M' + f((l + rr) / 2 + (rr - l) * 0.2) + ' ' + f(y) + 'H' + f(rr) + 'V' + f(yb) + 'H' + f((l + rr) / 2 + (rr - l) * 0.12) + 'Z';
      s += k.dy(sh, 1, 0) + k.dh(sh, 0.8);
      s += k.fl('M' + f(l + (rr - l) * 0.2) + ' ' + f(y + 1) + 'q1 ' + f((yb - y) * 0.5) + ' -.5 ' + f(yb - y - 1.5) + 'M' + f(l + (rr - l) * 0.45) + ' ' + f(y + 1) + 'q-1 ' + f((yb - y) * 0.5) + ' .5 ' + f(yb - y - 1.5), 0.35, 0.7, p.dink);
    }
    // 진열된 보석과 금붙이
    s += k.p('M' + f(mx - 2.2) + ' 53.400h4.400l-.8 -2.400h-2.800z', B[1], 0.4) + cutGem(k, p, mx, 46.5, 4.6);
    s += '<path d="M' + f(mx - 3) + ' 42.500l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6z" fill="#fff"/>';
    for (const gx of [mx - r * 0.42, mx + r * 0.4]) { s += '<circle cx="' + f(gx) + '" cy="60" r="2.300" fill="none" stroke="' + p.ink + '" stroke-width="1.500"/><circle cx="' + f(gx) + '" cy="60" r="2.300" fill="none" stroke="' + B[0] + '" stroke-width=".8"/>' + cutGem(k, p, gx, 57, 1.7); }
    s += k.l('M' + f(mx - r * 0.5) + ' 68q' + f(r * 0.5) + ' 6 ' + f(r) + ' 0', 1.5, 1, p.ink) + k.l('M' + f(mx - r * 0.5) + ' 68q' + f(r * 0.5) + ' 6 ' + f(r) + ' 0', 0.8, 1, B[0]) + cutGem(k, p, mx, 71.5, 2);
    s += cutGem(k, p, x0 + 7, 79.5, 2.2) + cutGem(k, p, x1 - 8, 79.5, 2.2) + cutGem(k, p, mx + 1, 80, 1.8);
    // 창턱
    s += k.p('M' + f(x0 - 7) + ' ' + sill + 'H94V' + (sill + 4.5) + 'H' + f(x0 - 7) + 'Z', p.rock[0], 0.7) + k.h('M' + f(x0 - 7) + ' ' + (sill + 4.5) + 'H94v5H' + f(x0 - 5) + 'Z', 'A', 0.9);
    // 차양: 봉에 건 물결 끝 천
    const ax = x0 - 9, aw = 94 - ax, n = 6, sw = aw / n, at = 5, ab = 15 + rnd() * 2;
    let val = 'M' + f(ax) + ' ' + at + 'H94V' + f(ab);
    for (let i = 0; i < n; i++) val += 'q' + f(-sw / 2) + ' 5 ' + f(-sw) + ' 0';
    val += 'Z';
    s += k.h('M' + f(ax) + ' ' + f(ab) + 'H94v9H' + f(ax + 3) + 'Z', 'A', 0.9);
    s += k.dy(val, 2);
    for (let i = 0; i < n; i += 2) s += k.dy('M' + f(94 - sw * i) + ' ' + at + 'V' + f(ab) + 'q' + f(-sw / 2) + ' 5 ' + f(-sw) + ' 0V' + at + 'Z', p.c === 'w' ? 1 : 3, 0);
    s += k.dh('M' + f(94 - sw * 1.6) + ' ' + at + 'H94V' + f(ab + 2) + 'H' + f(94 - sw * 1.6) + 'Z', 0.6);
    s += k.l(val, 0.7, 1, p.dink);
    s += k.l('M' + f(ax - 2) + ' ' + f(at - 0.3) + 'H94', 2, 1, p.ink) + k.l('M' + f(ax - 2) + ' ' + f(at - 0.3) + 'H94', 1.1, 1, B[0]);
    // 걸개 간판
    s += k.l('M' + f(x0 - 5) + ' 30h-12M' + f(x0 - 5) + ' 37l-8 -7', 0.8) + k.l('M' + f(x0 - 15) + ' 30v4', 0.5);
    s += k.p('M' + f(x0 - 15) + ' 34l5 6 -5 6 -5 -6z', B[0], 0.6) + k.fl('M' + f(x0 - 15) + ' 36.500l3 3.500 -3 3.500 -3 -3.500z', 0.35, 0.8);
    return s;
  }

  /** 은행가의 탁자: 장부와 금화 @param {Pen} k @param {Pal} p @param {() => number} rnd @param {number} v */
  function sceneBank(k, p, rnd, v) {
    const B = p.brass;
    let s = wallWindow(k, p, rnd, 30 + rnd() * 3, 20, 5, 42, true);
    // 선반과 장부 등
    s += k.p('M60 24H94v2.600H60Z', p.wood[1], 0.6);
    let bk = '';
    let x = 63;
    const hs = [12, 15, 11, 14, 16, 12, 13];
    for (let i = 0; i < 7 && x < 91; i++) { const w = 3 + rnd() * 1.6; bk += k.p('M' + f(x) + ' 24v-' + hs[i] + 'h' + f(w) + 'v' + hs[i] + 'Z', i % 3 === 0 ? p.wood[0] : i % 3 === 1 ? p.rock[0] : p.wood[2], 0.5) + k.fl('M' + f(x) + ' ' + (24 - hs[i] + 3) + 'h' + f(w) + 'M' + f(x) + ' ' + (24 - 3) + 'h' + f(w), 0.3, 0.8); x += w + 0.3; }
    s += bk;
    // 탁자와 탁자보
    s += k.p('M0 60H94V68H0Z', p.wood[0], 0.6) + k.p('M0 68H94V100H0Z', p.wood[1], 0.6) + k.h('M0 68H94V100H0Z', 'A', 0.9);
    s += drape(k, p, rnd, 34, 94, 57, 67, 90 + rnd() * 3);
    // 펼친 장부
    const lx = 44 + rnd() * 3;
    s += k.p('M' + f(lx - 1) + ' 62l2 -11h24l2 11z', p.wood[2], 0.6);
    s += k.p('M' + f(lx) + ' 61l2 -10q6 -2 11 .5l-.5 10q-6 -2 -12.500 -.5z', p.mode === 'dark' ? '#e6d9b8' : '#fffaea', 0.5) + k.p('M' + f(lx + 12.5) + ' 61.500l.5 -10q6 -2.500 11 -.5l2 10q-7 -1.500 -13.500 .5z', p.mode === 'dark' ? '#d9cba8' : '#f6eed6', 0.5);
    s += k.fl('M' + f(lx + 3) + ' 53.500h8M' + f(lx + 2.7) + ' 55.500h8M' + f(lx + 2.4) + ' 57.500h8M' + f(lx + 2.1) + ' 59.500h6M' + f(lx + 15) + ' 53.500h8M' + f(lx + 15.2) + ' 55.500h8M' + f(lx + 15.4) + ' 57.500h5', 0.3, 0.8);
    // 깃펜과 잉크병
    const qx = lx + 31;
    s += k.p('M' + f(qx - 2.5) + ' 62v-4.500h5v4.500z', p.dark, 0.5) + k.p('M' + f(qx - 1.5) + ' 57.500v-1.500h3v1.500z', B[1], 0.4);
    s += k.p('M' + f(qx) + ' 56q1 -12 9 -22q1 9 -6 18z', p.mode === 'dark' ? '#e6d9b8' : '#fffaea', 0.5) + k.fl('M' + f(qx) + ' 56q3 -12 9 -22M' + f(qx + 3) + ' 46l3 -1M' + f(qx + 4.2) + ' 42l3 -1.500M' + f(qx + 2) + ' 50l3 -.5', 0.3, 0.8);
    // 금화 더미
    /** @param {number} cx @param {number} by @param {number} n */
    const stack = (cx, by, n) => {
      let o = '';
      for (let i = 0; i < n; i++) o += '<ellipse cx="' + f(cx + ((i * 5) % 3 - 1) * 0.3) + '" cy="' + f(by - i * 1.9) + '" rx="4" ry="1.700" fill="' + (i === n - 1 ? B[0] : B[1]) + '" stroke="' + p.ink + '" stroke-width=".45"/>';
      return o;
    };
    s += stack(qx + 13, 63, 5 + Math.floor(rnd() * 3)) + stack(qx + 5.5, 65, 3 + Math.floor(rnd() * 2));
    if (v % 2 === 0) s += stack(qx + 20, 65, 2 + Math.floor(rnd() * 3));
    s += '<ellipse cx="' + f(lx - 4) + '" cy="64.500" rx="4" ry="1.700" fill="' + B[0] + '" stroke="' + p.ink + '" stroke-width=".45"/><ellipse cx="' + f(lx + 30) + '" cy="66" rx="3.600" ry="1.500" fill="' + B[0] + '" stroke="' + p.ink + '" stroke-width=".45"/>';
    // 촛대
    const cx = 38;
    s += '<circle cx="' + cx + '" cy="38" r="13" fill="url(#eg-lamp)"/>';
    s += k.p('M' + (cx - 1.4) + ' 58V44h2.800V58Z', p.paper, 0.5) + k.p('M' + cx + ' 43q-2 -3 0 -6.500q2 3.500 0 6.500z', '#fff3c9', 0.4) + k.p('M' + (cx - 4) + ' 61q4 -4 8 0z', B[1], 0.5) + k.l('M' + (cx - 2.4) + ' 58h4.800', 1, 1, B[2]);
    return s;
  }

  /* ── 카드마다 장면 고르기 ── */

  /** @type {Record<string, number>|null} */
  let ORDER = null;
  /** 같은 단계·색 안에서 몇 번째 카드인지(0부터) @param {CardDef} def */
  function cardIndex(def) {
    if (!ORDER) {
      ORDER = {};
      /** @type {Record<string, number>} */ const cnt = {};
      const cards = (G.Zap.data && G.Zap.data.cards) || [];
      for (const c of cards) { const key = c.tier + c.bonus; cnt[key] = cnt[key] === undefined ? 0 : cnt[key] + 1; ORDER[c.id] = cnt[key]; }
    }
    const i = ORDER[def.id];
    return i === undefined ? hash(def.id) % 8 : i;
  }

  const SCENES = {
    1: [sceneAdit, sceneCart, scenePeaks, sceneCave],
    2: [sceneShip, sceneBales, sceneScale, sceneBench],
    3: [sceneSkyline, sceneBridge, sceneShop, sceneBank],
  };

  /** 카드 삽화(94×100). 같은 카드 id 는 늘 같은 그림. @param {CardDef} def @returns {string} */
  function art(def) {
    const idx = cardIndex(def);
    const ci = 'wugrk'.indexOf(def.bonus);
    const rnd = prng(hash('eg:' + def.id));
    const list = SCENES[def.tier];
    const scene = list[(idx + ci) % list.length];
    const v = Math.floor(idx / list.length) + (def.tier === 3 ? ci : 0);
    const p = palette(def.bonus, idx + (def.tier === 1 ? 0 : ci));
    return scene(pen(p), p, rnd, v);
  }

  /* ───────────── 6. 카드 · 덱 ───────────── */

  /** 뒷면 금박 무늬 */
  function BACK_DEFS() {
    let s = '<symbol id="eg-back" viewBox="0 0 100 140">';
    s += '<g fill="none" stroke="currentColor">';
    s += '<rect x="5.500" y="5.500" width="89" height="129" rx="3.500" stroke-width="1.3"/>';
    s += '<rect x="8.500" y="8.500" width="83" height="123" rx="2" stroke-width=".5"/>';
    // 네 모서리 부채꼴
    for (const [x, y, sx, sy] of [[8.5, 8.5, 1, 1], [91.5, 8.5, -1, 1], [8.5, 131.5, 1, -1], [91.5, 131.5, -1, -1]]) {
      s += '<g transform="translate(' + x + ' ' + y + ') scale(' + sx + ' ' + sy + ')" stroke-width=".6">' +
        '<path d="M0 14A14 14 0 0 0 14 0M0 9.500A9.500 9.500 0 0 0 9.500 0M0 5A5 5 0 0 0 5 0"/><path d="M2.500 2.500 9 9M1.500 6 5 12.500M6 1.500 12.500 5" stroke-width=".4"/></g>';
    }
    // 가운데 마름모 장식과 방사 해칭
    s += '<polygon points="50,28 84,70 50,112 16,70" stroke-width="1.1"/><polygon points="50,33 80,70 50,107 20,70" stroke-width=".5"/>';
    let rays = '';
    for (let i = 0; i < 48; i++) {
      const a = i * 7.5 * Math.PI / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      // 마름모 안쪽 경계까지: |x|/30 + |y|/37 = 1
      const rr = 1 / (Math.abs(ca) / 30 + Math.abs(sa) / 37);
      rays += 'M' + f(50 + 21 * ca) + ' ' + f(70 + 21 * sa) + 'L' + f(50 + rr * ca * 0.96) + ' ' + f(70 + rr * sa * 0.96);
    }
    s += '<path d="' + rays + '" stroke-width=".45" opacity=".8"/>';
    s += '<circle cx="50" cy="70" r="20" stroke-width="1"/><circle cx="50" cy="70" r="17.500" stroke-width=".45"/>';
    s += '<path d="M50 12v12M44 18h12" stroke-width=".7"/>';
    s += '<path d="M14 70h-4M90 70h-4" stroke-width=".7"/>';
    s += '</g>';
    s += '<g fill="currentColor"><circle cx="50" cy="18" r="1.500"/></g>';
    s += '</symbol>';
    return s;
  }

  /** @param {Tier} tier @param {string} [center] 가운데 원 안 내용 @returns {HTMLElement} */
  function backFace(tier, center) {
    ensureDefs();
    const el = d('eg-back eg-back--t' + tier);
    let pips = '';
    const xs = tier === 1 ? [50] : tier === 2 ? [43, 57] : [36, 50, 64];
    for (const x of xs) pips += '<circle cx="' + x + '" cy="' + 122 + '" r="4.300" fill="#3a2a12"/><circle cx="' + x + '" cy="121.300" r="3.700" fill="url(#eg-g-au)"/>';
    el.appendChild(svgEl('eg-back__orn', '0 0 100 140', '<use href="#eg-back"/>' + pips +
      (center || '<g fill="none" stroke="currentColor" stroke-width=".9"><polygon points="50,58 62,70 50,82 38,70"/><path d="M50 58V82M38 70H62" stroke-width=".5"/></g>')));
    return el;
  }

  /** 카드 뒷면 한 장 @param {Tier} tier @returns {HTMLElement} */
  function cardBack(tier) {
    const el = d('eg-card eg-card--back eg-t' + tier);
    el.setAttribute('data-tier', String(tier));
    el.appendChild(backFace(tier));
    return el;
  }

  /** 덱 더미 @param {Tier} tier @param {number} count @returns {HTMLElement} */
  function deck(tier, count) {
    const el = d('eg-deck eg-t' + tier + (count === 0 ? ' is-empty' : ''));
    el.setAttribute('data-tier', String(tier));
    el.setAttribute('data-count', String(count));
    if (count === 0) {
      const dots = d('eg-deck__pips');
      for (let i = 0; i < tier; i++) dots.appendChild(document.createElement('i'));
      el.appendChild(dots);
      return el;
    }
    // 두께: 장수에 비례(카드 폭 대비 %). 1장이면 낱장.
    const thick = Math.min(40, count - 1) * 0.3;
    el.style.setProperty('--eg-thick', f(thick));
    el.appendChild(d('eg-deck__pile'));
    const top = backFace(tier, ' ');
    top.classList.add('eg-deck__top');
    top.appendChild(d('eg-deck__n', String(count)));
    el.appendChild(top);
    return el;
  }

  /** 공개 줄의 빈칸 @returns {HTMLElement} */
  function emptySlot() {
    return d('eg-slot');
  }

  /** 앞면 카드 @param {CardDef} def @returns {HTMLElement} */
  function card(def) {
    ensureDefs();
    const el = d('eg-card eg-c-' + def.bonus + ' eg-t' + def.tier);
    el.setAttribute('data-card-id', def.id);
    el.setAttribute('data-color', def.bonus);
    const face = d('eg-card__face');
    face.appendChild(d('eg-card__frame'));
    const inner = d('eg-card__inner');
    const a = svgEl('eg-card__art', '0 0 94 100', art(def));
    a.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    inner.appendChild(a);
    const fog = d('eg-card__fog');
    inner.appendChild(fog);
    const head = d('eg-card__head');
    if (def.points > 0) {
      const p = d('eg-card__pts', String(def.points));
      p.setAttribute('data-n', String(def.points));
      head.appendChild(p);
    }
    head.appendChild(gemSvg(def.bonus, 'eg-card__gem'));
    inner.appendChild(head);
    const costs = d('eg-card__costs');
    let n = 0;
    for (const c of ['w', 'u', 'g', 'r', 'k']) {
      if (def.cost[c] > 0) { costs.appendChild(costChipEl(c, def.cost[c])); n++; }
    }
    costs.classList.add('eg-costs-' + n);
    fog.classList.add('eg-fog-' + n);
    inner.appendChild(costs);
    face.appendChild(inner);
    el.appendChild(face);
    return el;
  }

  /* ───────────── 7. 귀족 ───────────── */
  /*@@NOBLE@@*/
  /*
   * 귀족 = 사람 없이 문장. 금박 가로대에 술을 달고 아래를 제비꼬리로 자른 세로 깃발(곤팔로네), 담비 털 무늬 천,
   * 그 위에 말머리형 방패(testa di cavallo)와 관, 아래 좌우명 띠. 문장 색 = 요구 보석 색(금·은 바탕 위에, 색끼리 맞대지 않음).
   * 색에는 문장학 해칭(빨강 세로줄, 파랑 가로줄, 초록 사선, 검정 격자, 금 점)을 얹는다.
   */

  const SHIELD = 'M0 -22C3 -22 4.5 -20.5 7 -20C10 -19.5 13 -23 15.5 -21.5C17.5 -20 17 -17 15.5 -15C13.5 -12 12.5 -9 12.5 -6C12.5 -2 17 1 16.5 7C16 13 9 18 0 22' +
    'C-9 18 -16 13 -16.5 7C-17 1 -12.5 -2 -12.5 -6C-12.5 -9 -13.5 -12 -15.5 -15C-17 -17 -17.5 -20 -15.5 -21.5C-13 -23 -10 -19.5 -7 -20C-4.5 -20.5 -3 -22 0 -22Z';
  const MOTTO = { n0: 'VIRTUS', n1: 'FIDES', n2: 'SEMPER', n3: 'LUX', n4: 'HONOR', n5: 'CONSTANS', n6: 'FORTUNA', n7: 'PRUDENS', n8: 'AUDAX', n9: 'VERITAS' };

  function NOBLE_DEFS() {
    let s = '<clipPath id="eg-shc"><path d="' + SHIELD + '"/></clipPath>';
    s += '<linearGradient id="eg-or" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbeaa6"/><stop offset=".45" stop-color="#e6c257"/><stop offset="1" stop-color="#b98f2c"/></linearGradient>';
    s += '<linearGradient id="eg-ar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f1ede2"/><stop offset="1" stop-color="#cfcabb"/></linearGradient>';
    s += '<linearGradient id="eg-rod" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset=".45" stop-color="#d9ae3e"/><stop offset="1" stop-color="#7d5a14"/></linearGradient>';
    s += '<linearGradient id="eg-cloth" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e9dcbd"/><stop offset=".12" stop-color="#fbf4e1"/><stop offset=".45" stop-color="#f3e9d0"/><stop offset=".62" stop-color="#dfd1ae"/><stop offset=".74" stop-color="#f1e6cb"/><stop offset="1" stop-color="#cdbd97"/></linearGradient>';
    s += '<radialGradient id="eg-shl" cx=".3" cy=".22" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".75" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></radialGradient>';
    // 담비 털 무늬
    const spot = (x, y) => '<path d="M' + x + ' ' + y + 'q-1.200 2.600 -1.600 4.400l1.600 -1 1.600 1q-.4 -1.800 -1.600 -4.400z"/><circle cx="' + (x - 1.1) + '" cy="' + (y - 0.6) + '" r=".5"/><circle cx="' + x + '" cy="' + (y - 1.3) + '" r=".5"/><circle cx="' + (x + 1.1) + '" cy="' + (y - 0.6) + '" r=".5"/>';
    s += '<pattern id="eg-ermine" width="10" height="13" patternUnits="userSpaceOnUse"><g fill="#4a3524">' + spot(2.5, 2.5) + spot(7.5, 9) + '</g></pattern>';
    s += hatch('eg-hKX', 2.2, 0.36, 0, '#8f8b93', true);
    s += '<pattern id="eg-hOr" width="2.400" height="2.400" patternUnits="userSpaceOnUse"><circle cx="1.200" cy="1.200" r=".34" fill="#7d5a14"/></pattern>';
    s += '<pattern id="eg-diaper" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M4 0L8 4L4 8L0 4Z" fill="none" stroke="#c9a85a" stroke-width=".35" opacity=".35"/><circle cx="4" cy="4" r=".6" fill="#c9a85a" opacity=".3"/></pattern>';
    s += '<path id="eg-motto" d="M-13.500 30.700q13.500 5.600 27 0"/>';
    return s;
  }

  /** 문장 색 면: 색 + 문장학 해칭 @param {string} c @param {string} shape SVG 요소 앞부분(닫지 않은 태그) */
  function tinct(c, shape) {
    const pat = { r: 'hV', u: 'hH', g: 'hA', k: 'hKX' }[c];
    let s = shape + ' fill="' + (c === 'w' ? 'url(#eg-ar)' : DYE[c][2]) + '"/>';
    if (pat) s += shape + ' class="eg-fine" fill="url(#eg-' + pat + ')" opacity="' + (c === 'k' ? 0.8 : 0.42) + '"/>';
    return s;
  }
  /** @param {number} x @param {number} y @param {number} w @param {number} h @param {string} [tf] */
  function rect(x, y, w, h, tf) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' + (tf ? ' transform="' + tf + '"' : ''); }
  /** @param {number} x @param {number} y @param {number} w @param {number} h */
  function loz(x, y, w, h) { return '<path d="M' + x + ' ' + (y - h) + 'l' + w + ' ' + h + ' ' + (-w) + ' ' + h + ' ' + (-w) + ' ' + (-h) + 'z"'; }
  /** @param {number} x @param {number} y @param {number} r */
  function rnd0(x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"'; }

  /** 귀족 열 명의 문장(방패 가운데 0,0 기준). 금속 바탕 + 요구 색 무늬 @type {Record<string, () => string>} */
  const ARMS = {
    // 금 바탕, 빨강 사선 띠와 검정 가는 사선 둘
    n0: () => tinct('r', rect(-40, -5, 80, 10, 'rotate(52)')) + tinct('k', rect(-40, -11.5, 80, 3.2, 'rotate(52)')) + tinct('k', rect(-40, 8.3, 80, 3.2, 'rotate(52)')),
    // 금 바탕, 세로 띠 셋(초록·빨강·검정)
    n1: () => tinct('g', rect(-11.5, -30, 5.4, 60)) + tinct('r', rect(-2.7, -30, 5.4, 60)) + tinct('k', rect(6.1, -30, 5.4, 60)),
    // 금 바탕, 빨강 십자와 초록 마름모 넷
    n2: () => tinct('r', rect(-3.4, -30, 6.8, 60)) + tinct('r', rect(-30, -7, 60, 6.8)) + tinct('g', loz(-9, -13.5, 2.8, 3.8)) + tinct('g', loz(9, -13.5, 2.8, 3.8)) + tinct('g', loz(-9.5, 7.5, 2.8, 3.8)) + tinct('g', loz(9.5, 7.5, 2.8, 3.8)),
    // 금 바탕, 가로 띠 셋(파랑·빨강·초록)
    n3: () => tinct('u', rect(-30, -14.5, 60, 5.6)) + tinct('r', rect(-30, -3.4, 60, 5.6)) + tinct('g', rect(-30, 7.7, 60, 5.6)),
    // 금 바탕, 파랑 X 십자와 초록 구슬 넷
    n4: () => tinct('u', rect(-40, -3, 80, 6, 'translate(0 -2) rotate(52)')) + tinct('u', rect(-40, -3, 80, 6, 'translate(0 -2) rotate(-52)')) + tinct('g', rnd0(0, -14.5, 2.7)) + tinct('g', rnd0(0, 11, 2.7)) + tinct('g', rnd0(-10.5, -2, 2.5)) + tinct('g', rnd0(10.5, -2, 2.5)),
    // 은 바탕, 빨강 가로 띠와 검정 마름모 셋
    n5: () => tinct('r', rect(-30, -5.5, 60, 8)) + tinct('k', loz(-7.5, -13, 2.8, 3.8)) + tinct('k', loz(7.5, -13, 2.8, 3.8)) + tinct('k', loz(0, 10.5, 2.8, 3.8)),
    // 은 바탕, 파랑 갈매기와 검정 구슬 셋
    n6: () => tinct('u', '<path d="M-20 7L0 -9.500L20 7V14L0 -2.500L-20 14Z"') + tinct('k', rnd0(-7.5, -14, 2.7)) + tinct('k', rnd0(7.5, -14, 2.7)) + tinct('k', rnd0(0, 10.5, 2.9)),
    // 은 바탕, 파랑 테두리와 초록 큰 마름모
    n7: () => '<path d="' + SHIELD + '" fill="none" stroke="' + DYE.u[2] + '" stroke-width="8.400"/><path class="eg-fine" d="' + SHIELD + '" fill="none" stroke="url(#eg-hH)" stroke-width="8.400" opacity=".42"/>' + tinct('g', loz(0, -1.5, 7.2, 10)),
    // 은·검정 바둑판
    n8: () => { let s = ''; for (let i = -3; i < 3; i++) for (let j = -4; j < 4; j++) if ((i + j) % 2 !== 0) s += tinct('k', rect(i * 6.4, j * 6.4 + 1.4, 6.4, 6.4)); return s; },
    // 세로 가름(은·파랑), 색을 맞바꾼 갈매기
    n9: () => tinct('u', rect(0, -30, 30, 60)) + tinct('u', '<path d="M-20 7L0 -9.500V-2.500L-20 14Z"') + tinct('w', '<path d="M0 -9.500L20 7V14L0 -2.500Z"'),
  };

  /** 관(세 가지) @param {number} kind @param {string[]} jewels 요구 색 */
  function crown(kind, jewels) {
    const gold = 'url(#eg-rod)', ink = INK;
    let s = '';
    let tips = '';
    if (kind === 0) {
      s += '<path d="M-11 -24V-31.500L-7.600 -28L-5.400 -34.500L-2.600 -28L0 -36L2.600 -28L5.400 -34.500L7.600 -28L11 -31.500V-24Z" fill="' + gold + '" stroke="' + ink + '" stroke-width=".7" stroke-linejoin="round"/>';
      for (const [x, y] of [[-11, -32.3], [-5.4, -35.4], [0, -37], [5.4, -35.4], [11, -32.3]]) tips += '<circle cx="' + x + '" cy="' + y + '" r="1.300"/>';
    } else if (kind === 1) {
      s += '<path d="M-11 -24V-29Q-11 -31 -9 -30L-6 -27.500L-3 -30Q0 -33 3 -30L6 -27.500L9 -30Q11 -31 11 -29V-24Z" fill="' + gold + '" stroke="' + ink + '" stroke-width=".7" stroke-linejoin="round"/>';
      // 잎 모양 장식 셋
      for (const x of [-9.5, 0, 9.5]) { const y = x === 0 ? -33.5 : -31.5; s += '<path d="M' + x + ' ' + (y + 2.5) + 'q-3 -1 -2.400 -3.200q1 -1.300 2.400 .2q-.9 -2.600 0 -3.700q.9 1.100 0 3.700q1.400 -1.500 2.400 -.2q.6 2.200 -2.400 3.200z" fill="' + gold + '" stroke="' + ink + '" stroke-width=".55" stroke-linejoin="round"/>'; }
      for (const x of [-4.8, 4.8]) tips += '<circle cx="' + x + '" cy="-30.500" r="1.200"/>';
    } else {
      s += '<path d="M-11.500 -24V-28.500H11.500V-24Z" fill="' + gold + '" stroke="' + ink + '" stroke-width=".7" stroke-linejoin="round"/>';
      s += '<path d="M-10 -28.500v-3M-6.700 -28.500v-4M-3.300 -28.500v-3M0 -28.500v-4M3.300 -28.500v-3M6.700 -28.500v-4M10 -28.500v-3" stroke="' + ink + '" stroke-width="1.300"/><path d="M-10 -28.500v-3M-6.700 -28.500v-4M-3.300 -28.500v-3M0 -28.500v-4M3.300 -28.500v-3M6.700 -28.500v-4M10 -28.500v-3" stroke="#d9ae3e" stroke-width=".6"/>';
      for (const [x, y] of [[-10, -32.4], [-6.7, -33.6], [-3.3, -32.4], [0, -33.6], [3.3, -32.4], [6.7, -33.6], [10, -32.4]]) tips += '<circle cx="' + x + '" cy="' + y + '" r="1.250"/>';
    }
    s += '<g fill="#fffdf4" stroke="' + ink + '" stroke-width=".45">' + tips + '</g>';
    // 관 띠: 요구 색 보석
    s += '<path d="M-11.500 -24.300h23v-3.200h-23z" fill="' + gold + '" stroke="' + ink + '" stroke-width=".6"/>';
    const xs = jewels.length === 2 ? [-5, 5] : [-6.5, 0, 6.5];
    jewels.forEach((c, i) => { s += '<path d="M' + xs[i] + ' -27.300l1.700 1.400 -1.700 1.400 -1.700 -1.400z" fill="' + DYE[c][c === 'k' ? 1 : c === 'w' ? 4 : 2] + '" stroke="' + ink + '" stroke-width=".4"/>'; });
    return s;
  }

  /** 귀족 깃발 그림(66×111) @param {NobleDef} def */
  function nobleArt(def) {
    const idx = Number(def.id.slice(1)) || 0;
    const need = /** @type {Color[]} */ (['w', 'u', 'g', 'r', 'k']).filter((c) => def.require[c] > 0);
    const argent = need.indexOf('w') >= 0;
    const ink = INK;
    const x0 = 8, x1 = 58, top = 9, mx = 33;
    let s = '';
    // 매단 끈
    s += '<path class="eg-fine" d="M' + mx + ' 1L8 7.500M' + mx + ' 1L58 7.500" stroke="#d9ae3e" stroke-width=".7" fill="none"/>';
    // 천: 아래를 제비꼬리로
    const bot = 99;
    const tails = idx % 2 === 0
      ? 'V' + bot + 'L' + mx + ' ' + (bot - 15) + 'L' + x0 + ' ' + bot
      : 'V' + bot + 'L' + (x1 - 8.3) + ' ' + (bot - 10) + 'L' + (mx + 8.4) + ' ' + bot + 'L' + mx + ' ' + (bot - 10) + 'L' + (mx - 8.4) + ' ' + bot + 'L' + (x0 + 8.3) + ' ' + (bot - 10) + 'L' + x0 + ' ' + bot;
    const cloth = 'M' + x0 + ' ' + top + 'H' + x1 + tails + 'Z';
    s += '<path d="' + cloth + '" transform="translate(1.500 2.200)" fill="#000" opacity=".4"/>';
    s += '<path d="' + cloth + '" fill="url(#eg-cloth)" stroke="' + ink + '" stroke-width=".9" stroke-linejoin="round"/>';
    s += '<path class="eg-fine" d="' + cloth + '" fill="url(#eg-ermine)" opacity=".8"/>';
    s += '<path class="eg-fine" d="M' + (x1 - 13) + ' ' + top + 'H' + x1 + 'V' + bot + 'L' + (x1 - 13) + ' ' + (bot - 12) + 'Z" fill="url(#eg-hA)" opacity=".22"/>';
    // 금실 테두리
    const inset = idx % 2 === 0
      ? 'M' + (x0 + 2.6) + ' ' + (top + 2.6) + 'H' + (x1 - 2.6) + 'V' + (bot - 6) + 'L' + mx + ' ' + (bot - 19) + 'L' + (x0 + 2.6) + ' ' + (bot - 6) + 'Z'
      : 'M' + (x0 + 2.6) + ' ' + (top + 2.6) + 'H' + (x1 - 2.6) + 'V' + (bot - 6) + 'L' + (x1 - 8.3) + ' ' + (bot - 13.5) + 'L' + (mx + 8.4) + ' ' + (bot - 4) + 'L' + mx + ' ' + (bot - 13.5) + 'L' + (mx - 8.4) + ' ' + (bot - 4) + 'L' + (x0 + 8.3) + ' ' + (bot - 13.5) + 'L' + (x0 + 2.6) + ' ' + (bot - 6) + 'Z';
    s += '<path d="' + inset + '" fill="none" stroke="' + ink + '" stroke-width="1.700" stroke-linejoin="round" opacity=".8"/><path d="' + inset + '" fill="none" stroke="#dcb548" stroke-width="1.050" stroke-linejoin="round"/>';
    // 꼬리 끝의 술
    const tipsX = idx % 2 === 0 ? [x0 + 0.5, x1 - 0.5] : [x0 + 0.5, mx - 8.4, mx + 8.4, x1 - 0.5];
    for (const tx of tipsX) s += '<path d="M' + tx + ' ' + (bot - 0.5) + 'l-1.300 5.500h2.600z" fill="#d9ae3e" stroke="' + ink + '" stroke-width=".45"/><circle cx="' + tx + '" cy="' + (bot - 0.3) + '" r="1.200" fill="#f0d27a" stroke="' + ink + '" stroke-width=".45"/>';
    // 가로대와 양 끝 술
    s += '<path d="M3 5.800H63V9.200H3Z" fill="url(#eg-rod)" stroke="' + ink + '" stroke-width=".7"/>';
    for (const ex of [2.6, 63.4]) {
      s += '<circle cx="' + ex + '" cy="7.500" r="2.500" fill="url(#eg-g-au)" stroke="' + ink + '" stroke-width=".6"/>';
      s += '<path class="eg-fine" d="M' + ex + ' 10v5" stroke="#d9ae3e" stroke-width=".7"/><path class="eg-fine" d="M' + ex + ' 14.500l-1.700 7h3.400z" fill="#d9ae3e" stroke="' + ink + '" stroke-width=".45"/><circle class="eg-fine" cx="' + ex + '" cy="14.800" r="1.300" fill="#f0d27a" stroke="' + ink + '" stroke-width=".45"/>';
    }
    s += '<circle cx="' + mx + '" cy="1.800" r="1.500" fill="none" stroke="#d9ae3e" stroke-width=".8" class="eg-fine"/>';
    // 방패
    const sy = 56;
    let sh = '<path d="' + SHIELD + '" transform="translate(1.300 1.900)" fill="#000" opacity=".4"/>';
    sh += '<path d="' + SHIELD + '" fill="' + (argent ? 'url(#eg-ar)' : 'url(#eg-or)') + '"/>';
    if (!argent) sh += '<path class="eg-fine" d="' + SHIELD + '" fill="url(#eg-hOr)" opacity=".55"/>';
    sh += '<g clip-path="url(#eg-shc)">' + ARMS[def.id]() + '</g>';
    sh += '<path d="' + SHIELD + '" fill="url(#eg-shl)"/>';
    sh += '<path d="' + SHIELD + '" fill="none" stroke="' + ink + '" stroke-width="1.300" stroke-linejoin="round"/>';
    sh += '<path class="eg-fine" d="' + SHIELD + '" fill="none" stroke="#fff" stroke-width=".5" opacity=".55" transform="scale(.9)"/>';
    sh += crown(idx % 3, need);
    // 좌우명 띠
    sh += '<g class="eg-fine"><path d="M-16.500 26.500l-4.500 -1.500 1.600 4 -2.200 3.600 6 .4zM16.500 26.500l4.500 -1.500 -1.600 4 2.200 3.600 -6 .4z" fill="#d6c7a2" stroke="' + ink + '" stroke-width=".5" stroke-linejoin="round"/>';
    sh += '<path d="M-16.500 26.500q16.500 7 33 0v6.500q-16.500 7 -33 0z" fill="#fbf5e3" stroke="' + ink + '" stroke-width=".6" stroke-linejoin="round"/>';
    sh += '<text font-size="4.300" text-anchor="middle" fill="' + ink + '" style="font-family:var(--font-display);letter-spacing:.35px"><textPath href="#eg-motto" startOffset="50%">' + (MOTTO[def.id] || 'HONOR') + '</textPath></text></g>';
    s += '<g transform="translate(' + mx + ' ' + sy + ') scale(1.12)">' + sh + '</g>';
    return s;
  }

  /** 귀족 타일 @param {NobleDef} def @returns {HTMLElement} */
  function noble(def) {
    ensureDefs();
    const el = d('eg-noble');
    el.setAttribute('data-noble-id', def.id);
    const face = d('eg-noble__face');
    face.appendChild(d('eg-noble__frame'));
    const inner = d('eg-noble__inner');
    inner.appendChild(svgEl('eg-noble__art', '0 0 66 111', nobleArt(def)));
    const info = d('eg-noble__info');
    const pts = d('eg-noble__pts', String(def.points));
    pts.setAttribute('data-n', String(def.points));
    info.appendChild(pts);
    const reqs = d('eg-noble__reqs');
    for (const c of ['w', 'u', 'g', 'r', 'k']) {
      if (def.require[c] > 0) {
        const r = d('eg-req eg-sq--' + c);
        r.setAttribute('data-color', c);
        r.appendChild(d('eg-req__n', String(def.require[c])));
        reqs.appendChild(r);
      }
    }
    info.appendChild(reqs);
    inner.appendChild(info);
    face.appendChild(inner);
    el.appendChild(face);
    return el;
  }

  /* ───────────── 7½. 승자 메달 ───────────── */
  /*
   * 판 끝 승자 메달: 금박 걸쇠에 매단 줄무늬 비단 리본(차분한 남색·와인색, 보석 색 아님) + 금 메달(월계관 테두리,
   * 가운데 피렌체 백합, 바탕은 판화 해칭) + 아래 양피지·금박 이름판(이름, 점수, 산 카드 수).
   * 그림은 120×172 좌표, 메달 지름 = 100 단위 = px. 내려앉는 움직임은 셸, 빛 스침은 'is-glint'.
   */

  const MC = { x: 60, y: 112, r: 50 };

  function MEDAL_DEFS() {
    let s = '<clipPath id="eg-medal-clip"><circle cx="' + MC.x + '" cy="' + MC.y + '" r="' + MC.r + '"/></clipPath>';
    s += '<clipPath id="eg-ribbon-clip"><path d="M30 4H90V45L60 57L30 45Z"/></clipPath>';
    s += '<radialGradient id="eg-md-field" cx=".42" cy=".36" r=".75"><stop offset="0" stop-color="#f3d77a"/><stop offset=".55" stop-color="#d6a73a"/><stop offset="1" stop-color="#a87a1e"/></radialGradient>';
    s += '<linearGradient id="eg-md-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset=".55" stop-color="#e0b444"/><stop offset="1" stop-color="#b48420"/></linearGradient>';
    s += '<linearGradient id="eg-md-silk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset=".22" stop-color="#fff" stop-opacity=".1"/><stop offset=".38" stop-color="#fff" stop-opacity=".22"/><stop offset=".6" stop-color="#000" stop-opacity=".05"/><stop offset=".8" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient>';
    s += '<radialGradient id="eg-md-gloss" cx=".3" cy=".22" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#3a2400" stop-opacity="0"/><stop offset="1" stop-color="#3a2400" stop-opacity=".35"/></radialGradient>';
    s += '<symbol id="eg-medal" viewBox="0 0 120 172" overflow="visible">' + medalArt() + '</symbol>';
    return s;
  }

  /** 월계관 가지 하나(왼쪽 dir=-1 / 오른쪽 dir=1) @param {number} dir */
  function laurel(dir) {
    const R = 37, cx = MC.x, cy = MC.y;
    // 아래 가운데(90°)에서 시작해 옆을 돌아 위(약 262°)까지
    const a0 = 98, a1 = 258, n = 13;
    /** @param {number} deg */
    const pt = (deg, r) => { const a = (dir < 0 ? deg : 180 - deg) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    let stem = 'M' + pp([pt(a0, R)]);
    for (let d2 = a0 + 8; d2 <= a1; d2 += 8) stem += 'L' + pp([pt(d2, R)]);
    let dark = '', light = '', fill = '', vein = '';
    for (let i = 0; i < n; i++) {
      const deg = a0 + 6 + i * (a1 - a0 - 10) / (n - 1);
      const sz = 1 - i * 0.025;
      for (const side of [1, -1]) {
        const [x, y] = pt(deg + 3, R + side * 2.9 * sz);
        // 잎은 줄기를 따라 위쪽(진행 방향)으로 기울어진다
        const tang = (dir < 0 ? deg + 90 : 180 - deg - 90);
        const rot = tang + (dir < 0 ? 1 : -1) * side * -32;
        const e = (dx, dy) => '<ellipse cx="' + f(x + dx) + '" cy="' + f(y + dy) + '" rx="' + f(4.7 * sz) + '" ry="' + f(1.85 * sz) + '" transform="rotate(' + f(rot) + ' ' + f(x + dx) + ' ' + f(y + dy) + ')"/>';
        dark += e(0.55, 0.75); light += e(-0.4, -0.5); fill += e(0, 0);
        const ra = rot * Math.PI / 180;
        vein += 'M' + f(x - Math.cos(ra) * 3.4 * sz) + ' ' + f(y - Math.sin(ra) * 3.4 * sz) + 'L' + f(x + Math.cos(ra) * 3.4 * sz) + ' ' + f(y + Math.sin(ra) * 3.4 * sz);
      }
    }
    let s = '<path d="' + stem + '" fill="none" stroke="#6f4c0c" stroke-width="1.6" stroke-linecap="round"/>';
    s += '<path d="' + stem + '" fill="none" stroke="#e6bd52" stroke-width=".8" stroke-linecap="round"/>';
    s += '<g fill="#6a470b" opacity=".8">' + dark + '</g><g fill="#fff6c8">' + light + '</g><g fill="url(#eg-md-leaf)" stroke="#8a6214" stroke-width=".3">' + fill + '</g>';
    s += '<path class="eg-fine" d="' + vein + '" stroke="#9a6e18" stroke-width=".3" fill="none"/>';
    return s;
  }

  /** 메달 그림 전체(120×172) */
  function medalArt() {
    const { x: cx, y: cy, r } = MC;
    let s = '';
    // 리본: 줄무늬 비단(남색·와인색·크림·금실), V자로 접힌 끝
    s += '<path d="M30 4H90V45L60 57L30 45Z" transform="translate(1.500 2.500)" fill="#000" opacity=".35"/>';
    const stripes = [[30, 8, '#27304a'], [38, 1.6, '#e9dcb8'], [39.6, 10.4, '#5c2a33'], [50, 1.3, '#c9a24a'], [51.3, 17.4, '#27304a'], [59.2, 1.6, '#e9dcb8'], [68.7, 1.3, '#c9a24a'], [70, 10.4, '#5c2a33'], [80.4, 1.6, '#e9dcb8'], [82, 8, '#27304a']];
    let st = '';
    for (const [x, w, c] of stripes) st += '<rect x="' + x + '" y="0" width="' + w + '" height="60" fill="' + c + '"/>';
    s += '<g clip-path="url(#eg-ribbon-clip)">' + st;
    s += '<rect x="30" y="0" width="60" height="60" fill="url(#eg-md-silk)"/>';
    s += '<rect class="eg-fine" x="30" y="0" width="60" height="60" fill="url(#eg-hA)" opacity=".18"/>';
    // 접힌 끝의 그늘과 주름
    s += '<path d="M30 36L60 48L90 36V45L60 57L30 45Z" fill="#000" opacity=".22"/>';
    s += '<path class="eg-fine" d="M44 6q-2 18 1 36M76 6q2 18 -1 36" stroke="#fff" stroke-width=".6" opacity=".18" fill="none"/>';
    s += '</g>';
    s += '<path d="M30 4H90V45L60 57L30 45Z" fill="none" stroke="' + INK + '" stroke-width=".9" stroke-linejoin="round"/>';
    // 걸쇠(금박 막대)
    s += '<rect x="24" y="0" width="72" height="8.500" rx="2.200" fill="url(#eg-rod)" stroke="' + INK + '" stroke-width=".8"/>';
    s += '<path class="eg-fine" d="M30 4.300H90" stroke="#7d5a14" stroke-width=".5"/>';
    let bead = '';
    for (let x = 32; x <= 88; x += 4) bead += '<circle cx="' + x + '" cy="4.300" r=".9"/>';
    s += '<g class="eg-fine" fill="#fff3c0" stroke="#7d5a14" stroke-width=".3">' + bead + '</g>';
    for (const ex of [24, 96]) s += '<circle cx="' + ex + '" cy="4.250" r="4" fill="url(#eg-g-au)" stroke="' + INK + '" stroke-width=".8"/>';
    // 고리
    s += '<circle cx="60" cy="58" r="4.200" fill="none" stroke="' + INK + '" stroke-width="2.800"/><circle cx="60" cy="58" r="4.200" fill="none" stroke="#e0b444" stroke-width="1.500"/>';
    s += '<path d="M55.500 66.500V61.500Q60 57.500 64.500 61.500V66.500Z" fill="url(#eg-rod)" stroke="' + INK + '" stroke-width=".8"/>';
    // 메달: 그림자, 두께, 테
    s += '<circle cx="' + (cx + 2.5) + '" cy="' + (cy + 5) + '" r="' + r + '" fill="#000" opacity=".3"/><circle cx="' + (cx + 4.5) + '" cy="' + (cy + 9) + '" r="' + r + '" fill="#000" opacity=".14"/>';
    s += '<circle cx="' + cx + '" cy="' + (cy + 3.2) + '" r="' + r + '" fill="#6f4c0c" stroke="' + INK + '" stroke-width="1.200"/>';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="url(#eg-g-au)"/>';
    // 톱니 테
    let mill = '';
    for (let i = 0; i < 90; i++) { const a = i * 4 * Math.PI / 180; mill += 'M' + f(cx + Math.cos(a) * 47.6) + ' ' + f(cy + Math.sin(a) * 47.6) + 'L' + f(cx + Math.cos(a) * 49.6) + ' ' + f(cy + Math.sin(a) * 49.6); }
    s += '<path class="eg-fine" d="' + mill + '" stroke="#7d5a14" stroke-width=".55" opacity=".7"/>';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="45.500" fill="none" stroke="#7a5510" stroke-width="1.300"/>';
    s += '<circle cx="' + (cx + 0.6) + '" cy="' + (cy + 0.8) + '" r="45.500" fill="none" stroke="#fff3c0" stroke-width=".7" opacity=".8"/>';
    // 바탕: 한 단 낮은 면 + 판화 가로 해칭
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="44.500" fill="url(#eg-md-field)"/>';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="44.500" fill="url(#eg-hH)" opacity=".2"/>';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="44.500" fill="none" stroke="#6f4c0c" stroke-width=".9"/>';
    // 월계관
    s += laurel(-1) + laurel(1);
    // 아래 매듭 리본
    s += '<path d="M60 150.500q-6 -3.500 -9 -1q1 4.500 9 2.500q8 2 9 -2.500q-3 -2.500 -9 1z" fill="url(#eg-md-leaf)" stroke="#6f4c0c" stroke-width=".6"/>';
    s += '<path d="M58.500 151.500l-4 6 3 -.5 1.500 2.500.8 -7.500zM61.500 151.500l4 6 -3 -.5 -1.500 2.500 -.8 -7.500z" fill="url(#eg-md-leaf)" stroke="#6f4c0c" stroke-width=".55"/>';
    s += '<circle cx="60" cy="151.200" r="1.900" fill="#e6bd52" stroke="#6f4c0c" stroke-width=".6"/>';
    // 위쪽 작은 관
    s += '<g transform="translate(60 75.500) scale(.52)"><path d="M-11 6V-1.500L-7.600 2L-5.400 -4.500L-2.600 2L0 -6L2.600 2L5.400 -4.500L7.600 2L11 -1.500V6Z" transform="translate(.9 1.200)" fill="#6a470b" opacity=".8"/><path d="M-11 6V-1.500L-7.600 2L-5.400 -4.500L-2.600 2L0 -6L2.600 2L5.400 -4.500L7.600 2L11 -1.500V6Z" fill="url(#eg-md-leaf)" stroke="#6f4c0c" stroke-width="1"/><g fill="#fff6c8" stroke="#6f4c0c" stroke-width=".8"><circle cx="-11" cy="-2.300" r="1.600"/><circle cx="-5.400" cy="-5.400" r="1.600"/><circle cx="0" cy="-7" r="1.600"/><circle cx="5.400" cy="-5.400" r="1.600"/><circle cx="11" cy="-2.300" r="1.600"/></g></g>';
    // 가운데 백합(돋을새김)
    const tf = 'translate(' + f(cx - 50 * 0.8) + ' ' + f(cy + 4 - 50 * 0.8) + ') scale(.8)';
    s += '<g transform="' + tf + '"><path d="' + LILY + '" transform="translate(1.600 2.200)" fill="#5e3f08" opacity=".75"/><path d="' + LILY + '" transform="translate(-1.100 -1.400)" fill="#fff6c8"/><path d="' + LILY + '" fill="url(#eg-md-leaf)" stroke="#7a5510" stroke-width=".7"/></g>';
    // 광택과 윤곽
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="url(#eg-md-gloss)"/>';
    s += '<path d="M' + (cx - 40) + ' ' + (cy - 22) + 'A46 46 0 0 1 ' + (cx - 8) + ' ' + (cy - 45.5) + '" fill="none" stroke="#fff" stroke-width="1.600" stroke-linecap="round" opacity=".7"/>';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + INK + '" stroke-width="1.400"/>';
    return s;
  }

  /** 이름의 대략 너비(한글 1, 영문·숫자 0.6) @param {string} name */
  function nameUnits(name) {
    let u = 0;
    for (const ch of Array.from(name)) u += /[\u0000-ɏ]/.test(ch) ? 0.6 : 1;
    return Math.max(1, u);
  }

  /**
   * 판 끝 승자 메달 @param {{name:string, score:number, cards:number, shared:boolean, px:number}} o @returns {HTMLElement}
   */
  function medal(o) {
    ensureDefs();
    const D = o.px;
    const el = d('eg-medal' + (o.shared ? ' is-shared' : ''));
    el.style.setProperty('--d', D + 'px');
    el.setAttribute('data-shared', o.shared ? '1' : '0');
    el.appendChild(svgEl('eg-medal__art', '0 0 120 172',
      '<use href="#eg-medal"/><g clip-path="url(#eg-medal-clip)"><rect class="eg-gem__glint" x="-40" y="50" width="26" height="140" fill="url(#eg-glint)"/></g>'));
    const plate = d('eg-medal__plate');
    const name = d('eg-medal__name', o.name);
    // 이름판 폭은 메달의 1.25~2.1 배. 그보다 길면 글자를 줄인다.
    const fs = Math.min(D * 0.165, (D * 2.1 - D * 0.26) / (nameUnits(o.name) * 1.02));
    name.style.fontSize = f(fs) + 'px';
    plate.appendChild(name);
    const line = d('eg-medal__line');
    const pts = d('eg-medal__pts', String(o.score));
    pts.setAttribute('data-n', String(o.score));
    line.appendChild(pts);
    line.appendChild(d('eg-medal__unit', '점'));
    const cards = d('eg-medal__cards');
    cards.appendChild(d('eg-medal__cardicon'));
    cards.appendChild(document.createTextNode(String(o.cards) + '장'));
    line.appendChild(cards);
    plate.appendChild(line);
    el.appendChild(plate);
    return el;
  }

  /* ───────────── 8. 등록 ───────────── */

  G.Zap.skins.engraving = {
    id: 'engraving',
    label: '판화풍',
    cssClass: 'skin-engraving',
    fontCss: G.Zap.skins._engravingFontCss || '',
    card, deck, cardBack, emptySlot, noble, gem, costChip, chipStack, bonusTile, pointsBadge, medal,
  };
})();
