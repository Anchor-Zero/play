// @ts-check
// 생성됨: tools/sync-v2.js 가 design/ 에서 복사한 파일 — 직접 고치지 말 것(원본을 고친 뒤 다시 복사).
/*
 * 짭플렌더 v2 — 판 화면 (Zap.v2.board)
 *
 *   Zap.v2.board.render(container, view, opts)
 *
 * PlayerView 하나를 받아 판을 그리고, 누르기를 수(Move)로 바꿔 opts.on.move 로 넘긴다. 판 상태는 건드리지 않는다.
 * 물건(카드·덱·귀족·칩·보석)의 생김새는 스킨(V2Skin)이 그리고, 여기서는 자리·크기·누르기만 맡는다.
 *
 * 배치 원칙: 판(귀족·덱·공개 카드·공급처)이 주인공. 상대는 작은 격자, 내 자원은 아래 가장자리 두 줄.
 * 글자 표지와 큰 안내 띠는 없다. 담는 틀의 크기에 맞춰 카드 폭(--card-w)을 가장 크게 잡는다(틀 = 컨테이너 쿼리 기준).
 *
 * 게임에 붙일 때 쓰는 것 (docs/v2-board-hooks.md 에 정리):
 *   render(container, view, opts)  container 는 폭·높이가 정해진 틀(게임 화면이면 100%×100%). 판이 그 틀을 꽉 채운다
 *   notify(container, msg)         서버가 거절한 수의 오류 문구를 판 위 짧은 알림으로 띄우고, 보낸 수 때문에 잠긴 조작을 푼다
 *   clear(container)               판을 치운다
 * view.you 가 null 이면(관전·서버만 맡은 화면) 읽기 전용: 내 자리 줄 없이 모든 플레이어를 상대 칸 방식으로 보인다.
 */
(function () {
  Zap.v2 = Zap.v2 || {};
  /** @type {(spec:string, attrs?:any, ...kids:any[]) => HTMLElement} */
  const h = Zap.v2.dom.h;
  /** @type {(map:Record<string, any>) => string} */
  const cls = Zap.v2.dom.cls;
  /** @type {Color[]} */
  const COLORS = ['w', 'u', 'g', 'r', 'k'];
  /** @type {TokenColor[]} */
  const TOKENS = ['w', 'u', 'g', 'r', 'k', 'gold'];
  /** @type {Tier[]} */
  const TIERS = [3, 2, 1];
  const TOKEN_LIMIT = 10;
  const RESERVE_LIMIT = 3;
  /** '최근 일'에 남겨 둘 사건 수 */
  const LOG_KEEP = 30;
  /** 수를 둔 바로 뒤 같은 자리에 나타난 [차례 넘기기]를 잠깐 누를 수 없게 두는 시간(두 번 누르기로 차례가 넘어가지 않게) */
  const ARM_MS = 420;
  /** 스킨이 읽히도록 약속한 가장 작은 카드 폭. 이보다 작게 보일 카드는 이 크기로 그려 축소한다. */
  const MIN_DRAW_W = 64;
  /** @type {Record<TokenColor, string>} */
  const CNAME = { w: '흰색', u: '파랑', g: '초록', r: '빨강', k: '검정', gold: '황금' };

  /**
   * 제자리에서 확대해 보는 것. 카드는 살 수 있으면 payment(낼 토큰)를 함께 들고 있다(황금으로 바꿔 낼 수 있게).
   * @typedef {{kind:'card', cardId:string, payment?:TokenCounts} | {kind:'deck', tier:Tier} | {kind:'player', seat:number} | {kind:'noble', nobleId:string} | {kind:'log'}} V2Sheet
   */
  /**
   * 화면 상태(서버로 가지 않는 것)
   * @typedef {Object} V2UI
   * @property {ColorCounts} sel        공급처에서 고르는 중인 토큰
   * @property {TokenCounts} ret        반납하려고 고른 토큰
   * @property {V2Sheet|null} sheet     제자리에서 확대해 보고 있는 것
   * @property {boolean} pending        보낸 수의 답을 기다리는 중
   * @property {boolean} resultHidden   끝난 판에서 결과 화면을 접어 둠
   */
  /**
   * @typedef {Object} V2Options
   * @property {V2Skin} skin
   * @property {string[]} names           자리 번호 → 이름
   * @property {boolean[]} [connected]    자리 번호 → 접속 여부 (없으면 모두 접속)
   * @property {boolean} [interactive]    수를 보낼 수 있는 상태인지 (기본 true)
   * @property {Partial<V2UI>} [ui]       처음 화면 상태(장면용). 판이 처음 만들어질 때와 reset 때만 쓴다
   * @property {boolean} [reset]          다른 판으로 바꿔 끼움: 화면 상태를 새로 시작하고 움직임 없이 그린다
   * @property {GameEvent[]} [events]     이 화면 정보로 오게 한 사건들 → 움직임·소리 재생
   * @property {boolean} [result]         판이 끝났을 때 결과 화면을 덮을지 (기본 true)
   * @property {boolean} [still]          장식 움직임(빛 스침 등)을 끄기 — 사진용
   * @property {boolean} [mute]           이 판은 소리를 내지 않음(같은 판을 여러 틀에 함께 보일 때 한 곳만 소리)
   * @property {number|null} [leader]     방장 자리(이름 옆에 작은 관 표시). 없으면 표시 없음
   * @property {GameEvent[]} [log]        최근 일(오래된 것부터). 주면 이것을 '최근 일'에 보이고, 없으면 판이 받은 events 를 모아 쓴다
   * @property {boolean} [announceTurn]   true 면 reset 으로 그려도(한 화면 모드처럼 차례마다 갈아 끼울 때) 차례가 바뀌어 내 차례가 시작될 때 내 자리 빛남과 차례 소리를 낸다
   * @property {(seat:number) => ({title:string, text:string}|null)} [seatNote]  상대 칸을 눌러 펼쳤을 때 맨 아래 한 줄('title — text', data-test seat-note). null 이면 없음
   * @property {{move?:(m:Move) => void, toast?:(msg:string) => void, newGame?:() => void}} [on]
   */

  /** @returns {TokenCounts} */
  function zeroTokens() { return { w: 0, u: 0, g: 0, r: 0, k: 0, gold: 0 }; }
  /** @returns {ColorCounts} */
  function zeroColors() { return { w: 0, u: 0, g: 0, r: 0, k: 0 }; }
  /** @param {any} t @returns {number} */
  function sum(t) { let n = 0; for (const c of TOKENS) n += t[c] || 0; return n; }
  /** @param {number} lo @param {number} v @param {number} hi */
  function clamp(lo, v, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** @returns {V2UI} */
  function freshUI() {
    return { sel: zeroColors(), ret: zeroTokens(), sheet: null, pending: false, resultHidden: false };
  }

  /** 가능한 수 목록을 찾기 쉽게 정리 @param {Move[]} legal */
  function indexLegal(legal) {
    const L = {
      take3: /** @type {Set<string>} */ (new Set()),
      take2: /** @type {Set<string>} */ (new Set()),
      reserve: /** @type {Set<string>} */ (new Set()),
      reserveDeck: /** @type {Set<number>} */ (new Set()),
      buy: /** @type {Map<string, TokenCounts>} */ (new Map()),
      claim: /** @type {Set<string>} */ (new Set()),
      endTurn: false,
    };
    for (const m of legal || []) {
      if (m.type === 'take3') L.take3.add(COLORS.filter((c) => m.colors.indexOf(c) >= 0).join(','));
      else if (m.type === 'take2') L.take2.add(m.color);
      else if (m.type === 'reserve') L.reserve.add(m.cardId);
      else if (m.type === 'reserveDeck') L.reserveDeck.add(m.tier);
      else if (m.type === 'buy') L.buy.set(m.cardId, m.payment);
      else if (m.type === 'claimNoble') L.claim.add(m.nobleId);
      else if (m.type === 'endTurn') L.endTurn = true;
    }
    return L;
  }

  /** 고른 토큰이 가능한 수와 일치하면 그 수 @param {ColorCounts} sel @param {ReturnType<typeof indexLegal>} L @returns {Move|null} */
  function takeMoveFor(sel, L) {
    const picked = COLORS.filter((c) => sel[c] > 0);
    if (!picked.length) return null;
    const pair = picked.find((c) => sel[c] >= 2);
    if (pair) {
      if (picked.length === 1 && sel[pair] === 2 && L.take2.has(pair)) return { type: 'take2', color: pair };
      return null;
    }
    if (L.take3.has(picked.join(','))) return { type: 'take3', colors: picked };
    return null;
  }

  /** 공급처 칩을 눌렀을 때 고른 것을 바꾼다. 알릴 말이 있으면 돌려준다. */
  function toggleSel(/** @type {ColorCounts} */ sel, /** @type {Color} */ c, /** @type {PlayerView} */ v, /** @type {ReturnType<typeof indexLegal>} */ L) {
    const picked = COLORS.filter((x) => sel[x] > 0);
    const pair = picked.find((x) => sel[x] >= 2);
    if (sel[c] >= 2) { sel[c] = 0; return null; }
    if (sel[c] === 1) {
      if (picked.length === 1) {
        if (L.take2.has(c)) { sel[c] = 2; return null; }
        sel[c] = 0;
        return '같은 색 2개는 4개 이상 남았을 때만';
      }
      sel[c] = 0;
      return null;
    }
    if (v.supply[c] <= 0) return null;
    if (pair) { sel[pair] = 1; sel[c] = 1; return null; }
    if (picked.length >= 3) return '서로 다른 색은 3개까지';
    sel[c] = 1;
    return null;
  }

  /** @param {PlayerView} v @param {string} cardId */
  function locateCard(v, cardId) {
    for (const t of TIERS) if (v.market[t].indexOf(cardId) >= 0) return { place: 'market', tier: t, seat: -1, fromDeck: false };
    for (let s = 0; s < v.players.length; s++) {
      for (const r of v.players[s].reserved) {
        if (!('hidden' in r) && r.id === cardId) return { place: 'reserved', tier: Zap.data.cardsById[cardId].tier, seat: s, fromDeck: r.fromDeck };
      }
    }
    return null;
  }

  /** @param {V2UI} ui @param {PlayerView|null} prev @param {PlayerView} view */
  function syncUI(ui, prev, view) {
    const sameSpot = prev && prev.current === view.current && prev.phase === view.phase && prev.turnsTaken === view.turnsTaken;
    if (!sameSpot && prev) { ui.sel = zeroColors(); ui.ret = zeroTokens(); }
    const myTurn = view.you !== null && view.current === view.you;
    if (!myTurn || view.phase !== 'action') ui.sel = zeroColors();
    if (!myTurn || view.phase !== 'return') ui.ret = zeroTokens();
    for (const c of COLORS) if (ui.sel[c] > view.supply[c]) ui.sel = zeroColors();
    const sh = ui.sheet;
    if (sh && sh.kind === 'card') {
      if (!locateCard(view, sh.cardId)) ui.sheet = null;
      else if (prev) delete sh.payment;
    }
    if (sh && sh.kind === 'noble' && view.nobles.indexOf(sh.nobleId) < 0) ui.sheet = null;
    if (view.phase !== 'over') ui.resultHidden = false;
  }

  /** 꼭 알아야 할 때만 띄우는 짧은 한 줄 @param {PlayerView} v @param {V2Options} o @returns {string} */
  function noticeText(v, o) {
    const parts = [];
    if (v.phase === 'over') return '';
    const myTurn = v.you !== null && v.current === v.you;
    if (v.finalRoundBy !== null && v.finalRoundBy !== undefined) parts.push('마지막 라운드');
    if (myTurn && v.phase === 'return') parts.push('토큰 ' + (v.players[v.you].tokenTotal - TOKEN_LIMIT) + '개 반납');
    if (v.autoPassed && v.phase === 'end') parts.push(myTurn ? '둘 수 있는 수가 없어 자동 패스' : o.names[v.current] + '님 자동 패스');
    if (o.connected && o.connected[v.current] === false && v.current !== v.you) parts.push(o.names[v.current] + '님의 연결을 기다리는 중');
    if (myTurn && o.interactive === false) parts.push('연결 기다림');
    return parts.join(' · ');
  }

  /** 순위표 @param {PlayerView} v */
  function standingsOf(v) {
    const rows = v.players.map((p, seat) => ({ seat, score: p.score, cards: p.cards.length, nobles: p.nobles.length, rank: 1 }));
    rows.sort((a, b) => (b.score - a.score) || (a.cards - b.cards) || (a.seat - b.seat));
    rows.forEach((r, i) => {
      const p = rows[i - 1];
      r.rank = i > 0 && p.score === r.score && p.cards === r.cards ? p.rank : i + 1;
    });
    return rows;
  }

  /* ───────────── 폰 가로: '세로로 돌려 주세요' 덮개 ─────────────
   * 화면(창)이 가로로 길고 높이가 500px 이하이면(폰 가로) 판 위에 덮개를 띄운다. 판은 그 아래 그대로 그려 둔다.
   * [그래도 보기]를 누르면 이 페이지가 떠 있는 동안(메모리) 다시 묻지 않는다. 저장소에는 남기지 않는다.
   * 보이고 숨기는 것은 CSS 미디어 쿼리(board.css .zb-rotate)가 맡아 회전·크기 변경에 바로 따르고, 여기서는 덮개가 떠 있는 동안
   * 뒤의 판에 초점·누르기가 닿지 않게(inert) 할 뿐이다. */
  const ROTATE_MQ = '(orientation: landscape) and (max-height: 500px)';
  let rotateOk = false;
  /** @type {MediaQueryList|null} */
  const rotateMq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(ROTATE_MQ) : null;
  /** @param {BoardInst} inst */
  function applyRotate(inst) {
    const on = !rotateOk && !!(rotateMq && rotateMq.matches);
    inst.frame.classList.toggle('is-rotate-ok', rotateOk);
    /** @type {any} */ (inst.root).inert = on;
    /** @type {any} */ (inst.fx).inert = on;
  }
  if (rotateMq) {
    const onChange = () => { for (const inst of LIVE) applyRotate(inst); };
    if (rotateMq.addEventListener) rotateMq.addEventListener('change', onChange);
    else if (/** @type {any} */ (rotateMq).addListener) /** @type {any} */ (rotateMq).addListener(onChange);
  }
  function dismissRotate() {
    rotateOk = true;
    for (const inst of LIVE) applyRotate(inst);
  }
  /** @returns {HTMLElement} */
  function rotateEl() {
    return h('div.zb-rotate', { test: 'zb-rotate', 'data-testid': 'zb-rotate', role: 'dialog', 'aria-modal': 'true', 'aria-label': '세로로 돌려 주세요' },
      h('div.zb-rotate__card', null,
        h('div.zb-rotate__icon', { 'aria-hidden': 'true' }, h('i.zb-rotate__arrow'), h('i.zb-rotate__phone')),
        h('p.zb-rotate__title', null, '세로로 돌려 주세요'),
        h('button.zb-rotate__skip', { type: 'button', test: 'zb-rotate-dismiss', 'data-testid': 'zb-rotate-dismiss', onclick: dismissRotate }, '그래도 보기')));
  }

  /* ───────────── 판 하나 ───────────── */

  /** @type {WeakMap<HTMLElement, BoardInst>} */
  const INST = new WeakMap();
  /** 스킨별 칩 더미 크기 @type {Map<string, {h:number, w:number}>} */
  const RATIO = new Map();
  /** 떠 있는 판들(글꼴이 늦게 들어오면 크기를 다시 잰다) @type {Set<BoardInst>} */
  const LIVE = new Set();
  /** 글꼴이 들어온 뒤: 잰 크기를 버리고 다시 맞춘다 */
  function refit() {
    RATIO.clear();
    for (const inst of LIVE) { inst.fit.clear(); if (inst.view && inst.frame.isConnected) inst.draw(); }
  }
  if (typeof document !== 'undefined' && /** @type {any} */ (document).fonts) {
    const fonts = /** @type {any} */ (document).fonts;
    let pending = 0;
    fonts.addEventListener('loadingdone', () => { clearTimeout(pending); pending = /** @type {any} */ (setTimeout(refit, 60)); });
  }

  class BoardInst {
    /** @param {HTMLElement} container */
    constructor(container) {
      this.container = container;
      /** @type {PlayerView|null} */ this.view = null;
      /** @type {V2Options} */ this.opts = /** @type {any} */ ({});
      /** @type {V2UI} */ this.ui = freshUI();
      /** @type {Map<string, HTMLElement>} */ this.cache = new Map();
      /** @type {Map<string, {t:number, tray:number|undefined}>} */ this.fit = new Map();
      /** 조각 다시 쓰기 @type {Map<string, {sig:string, el:HTMLElement}>} */ this.parts = new Map();
      /** 가장 최근에 그릴 때의 사정 @type {any} */ this.ctx = null;
      /** 지금 확대해 보이는 것(같은 것을 다시 그릴 때는 펼치는 움직임을 되풀이하지 않는다) */ this.zoomKey = '';
      /** 결과 덮개가 지금 떠 있는지 */ this.resultShown = false;
      /** 최근 일(오래된 것부터, 차례 넘기기 빼고) @type {GameEvent[]} */ this.log = [];
      /** '최근 일'을 마지막으로 펼쳤을 때까지 본 개수 */ this.logSeen = 0;
      /** 막 누를 수 있게 된 단추가 언제부터 그랬는지(두 번 누르기 막기) @type {Record<string, number>} */ this.armed = {};
      /** 마지막으로 수를 보낸 때 */ this.sentAt = 0;
      /** 제자리 확대 덮개(열려 있는 동안 같은 요소를 쓰고 안만 바꾼다: 깜빡임·초점 잃음 없이) @type {{veil:HTMLElement, pop:HTMLElement}|null} */ this.zoomBox = null;
      this.skinId = '';
      this.toastMsg = '';
      this.toastTimer = 0;
      /** 지금 크기 값 @type {any} */ this.Z = null;
      this.frame = h('div.zb-frame');
      this.root = h('div.zb');
      this.fx = h('div.zb-fx', { 'aria-hidden': 'true' });
      this.frame.appendChild(this.root);
      this.frame.appendChild(this.fx);
      this.frame.appendChild(rotateEl());
      container.appendChild(this.frame);
      LIVE.add(this);
      applyRotate(this);
      this.w = 0; this.h = 0;
      this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.onResize()) : null;
      if (this.ro) this.ro.observe(this.frame);
      this.frame.addEventListener('pointerdown', (e) => this.onPress(e), { passive: true });
      // Esc 는 문서 어디서 눌러도(초점이 판 안이거나 아무 데도 없을 때) 확대를 닫는다
      /** @param {KeyboardEvent} e */
      this.onKey = (e) => {
        if (e.key !== 'Escape' || !this.ui.sheet || !this.frame.isConnected) return;
        const a = document.activeElement;
        if (a && a !== document.body && a !== document.documentElement && !this.frame.contains(a)) return;
        e.preventDefault();
        this.ui.sheet = null;
        this.paint();
      };
      document.addEventListener('keydown', this.onKey);
    }

    /**
     * 막 누를 수 있게 된 단추를 ARM_MS 동안 잠가 둔다. 남은 시간(ms)을 돌려준다(0 이면 누를 수 있음).
     * @param {string} key @param {boolean} on 지금 누를 수 있는 상태인지
     */
    armWait(key, on) {
      if (!on) { delete this.armed[key]; return 0; }
      const now = Date.now();
      if (this.armed[key] === undefined) this.armed[key] = now;
      return Math.max(0, ARM_MS - (now - this.armed[key]));
    }

    /** @param {PlayerView} view @param {V2Options} opts */
    update(view, opts) {
      const prev = this.view;
      const first = !prev;
      const skin = opts.skin;
      if (skin.id !== this.skinId) {
        if (this.skinId) this.frame.classList.remove(/** @type {V2Skin} */ (this.opts.skin).cssClass);
        this.frame.classList.add(skin.cssClass);
        this.skinId = skin.id;
        this.cache.clear();
        this.parts.clear();
        ensureFont(skin);
      }
      this.opts = opts;
      this.view = view;
      const motion0 = Zap.v2.motion;
      this.frame.classList.toggle('is-calm', !!(motion0 && motion0.getReduced && motion0.getReduced()));
      const fresh = first || !!opts.reset;
      if (fresh) {
        this.ui = freshUI();
        if (opts.ui) Object.assign(this.ui, JSON.parse(JSON.stringify(opts.ui)));
        this.fx.replaceChildren();
        this.toastMsg = '';
      }
      // 답 대기 잠금(ui.pending)은 새 화면 정보가 왔을 때(또는 notify)만 푼다. 스킨·접속 표시·방장처럼 판과 무관한 다시 그리기로는 풀지 않는다
      if (fresh || !prev || (prev !== view && JSON.stringify(prev) !== JSON.stringify(view))) this.ui.pending = false;
      syncUI(this.ui, fresh ? null : prev, view);
      // 최근 일
      if (opts.log) this.log = opts.log.filter((e) => e.type !== 'endTurn').slice(-LOG_KEEP);
      else if (fresh) this.log = [];
      else if (opts.events) this.log = this.log.concat(opts.events.filter((e) => e.type !== 'endTurn')).slice(-LOG_KEEP);
      if (fresh || (this.ui.sheet && this.ui.sheet.kind === 'log')) this.logSeen = this.log.length;
      else this.logSeen = Math.min(this.logSeen, this.log.length);
      const motion = Zap.v2.motion;
      const moving = !fresh && !!prev && !!opts.events && opts.events.length > 0 && !!motion;
      if (moving) {
        motion.transition(this, /** @type {PlayerView} */ (prev), view, /** @type {GameEvent[]} */ (opts.events), () => this.draw());
      } else {
        this.draw();
      }
      // 차례 알림(announceTurn): 움직임 없이 그렸어도 차례가 바뀌어 내 차례가 시작됐으면 빛남과 소리
      if (opts.announceTurn && !moving && motion && view.you !== null && view.current === view.you && view.phase === 'action'
        && (!prev || prev.current !== view.current || prev.turnsTaken !== view.turnsTaken)) motion.turnStart(this, 120);
      if (motion && !opts.still) motion.attach(this); else if (motion) motion.detach(this);
    }

    onResize() {
      const w = this.frame.clientWidth; const hh = this.frame.clientHeight;
      if (w === this.w && hh === this.h) return;
      if (this.view) this.draw();
    }

    /** 손을 댄 카드를 든다(터치에는 :hover 가 없으므로) @param {PointerEvent} e */
    onPress(e) {
      const t = /** @type {Element} */ (e.target);
      const btn = t && t.closest ? t.closest('.zb-card, .zb-deckbtn, .zb-noblebtn') : null;
      if (!btn) return;
      const inner = btn.firstElementChild;
      if (!inner) return;
      inner.classList.add('is-lifted');
      const off = () => { inner.classList.remove('is-lifted'); window.removeEventListener('pointerup', off); window.removeEventListener('pointercancel', off); };
      window.addEventListener('pointerup', off); window.addEventListener('pointercancel', off);
    }

    /** 짧은 알림 @param {string} msg @param {boolean} [own] 바깥(on.toast)으로 넘기지 않고 늘 판 위에 띄움 */
    toast(msg, own) {
      if (!own && this.opts.on && this.opts.on.toast) { this.opts.on.toast(msg); return; }
      this.toastMsg = msg;
      clearTimeout(this.toastTimer);
      this.toastTimer = /** @type {any} */ (setTimeout(() => { this.toastMsg = ''; this.paintNotice(); }, 2600));
      this.paintNotice();
    }

    paintNotice() { if (this.view) this.paint(); }

    /** @returns {HTMLElement|null} */
    noticeEl() {
      const v = /** @type {PlayerView} */ (this.view);
      const txt = this.toastMsg || noticeText(v, this.opts);
      if (!txt) return null;
      // 나타나는 움직임은 한 번만(내 자리를 다시 그려 알림 칸이 바뀌어도 되풀이하지 않게)
      return h('div.zb-notice', { test: this.toastMsg ? 'toast' : 'notice', role: 'status', title: txt, class: cls({ 'zb-notice--toast': !!this.toastMsg, 'zb-notice--watch': v.you === null }),
        onanimationend: (/** @type {Event} */ e) => { /** @type {HTMLElement} */ (e.currentTarget).classList.add('is-shown'); } }, txt);
    }

    /** 스킨 요소를 한 번만 만들어 다시 쓴다 @param {string} key @param {() => HTMLElement} make @returns {HTMLElement} */
    keep(key, make) {
      let el = this.cache.get(key);
      if (!el) { el = make(); this.cache.set(key, el); }
      el.classList.remove('is-lifted');
      return el;
    }

    /* ── 크기 ── */

    /**
     * 스킨의 칩 더미가 실제로 차지하는 크기(숫자 자리 포함)를 재 둔다. 스킨마다 숫자를 옆에 두기도 아래에 두기도 하므로 직접 잰다.
     * @param {number} count @param {number} px @returns {{h:number, w:number}}
     */
    stackBox(count, px) {
      const key = this.skinId + ':' + count + ':' + px;
      const got = RATIO.get(key);
      if (got) return got;
      const probe = h('span', { style: { position: 'absolute', left: '0', top: '0', visibility: 'hidden', display: 'inline-block', 'pointer-events': 'none' } },
        /** @type {V2Skin} */ (this.opts.skin).chipStack('r', count, px));
      this.frame.appendChild(probe);
      const r = { h: Math.max(px, probe.offsetHeight), w: Math.max(px, probe.offsetWidth) };
      const ok = probe.offsetHeight > 0;
      probe.remove();
      if (ok) RATIO.set(key, r);
      return r;
    }
    /**
     * 보너스 표시의 폭이 px 와 얼마나 다른지(스킨마다 같은 px 에 그리는 크기가 달라, 폭을 기준으로 맞춘다).
     * @returns {number} px 에 곱할 값
     */
    tileK() {
      const key = this.skinId + ':tile';
      const got = RATIO.get(key);
      if (got) return got.w;
      const probe = h('span', { style: { position: 'absolute', left: '0', top: '0', visibility: 'hidden', display: 'inline-block', 'pointer-events': 'none' } },
        /** @type {V2Skin} */ (this.opts.skin).bonusTile('r', 3, 40));
      this.frame.appendChild(probe);
      const w = probe.offsetWidth;
      probe.remove();
      const k = w > 0 ? clamp(0.8, 40 / w, 1.3) : 1;
      if (w > 0) RATIO.set(key, { w: k, h: k });
      return k;
    }

    /** 높이 maxH·폭 maxW 안에 드는 가장 큰 칩 지름 @param {number} count @param {number} start @param {number} maxH @param {number} maxW @param {number} min */
    fitChip(count, start, maxH, maxW, min) {
      let px = Math.round(start);
      for (let i = 0; i < 60 && px > min; i++) {
        const b = this.stackBox(count, px);
        if (b.h <= maxH && b.w <= maxW) break;
        px -= Math.max(1, Math.round(px * 0.04));
      }
      return Math.max(min, px);
    }

    /**
     * 틀 크기에서 물건 크기를 정한다. tight 0 = 넉넉, 클수록 가장자리 정보를 줄이고 그다음 카드를 줄인다.
     * @param {number} W @param {number} H @param {boolean} wide @param {number} tight
     * @param {number} [trayReal] (가로 배치) 실제로 잰 내 자리 높이. 주면 판 높이를 이 값으로 다시 잡는다
     */
    sizes(W, H, wide, tight, trayReal) {
      const v = /** @type {PlayerView} */ (this.view);
      // 귀족은 남은 장수에 맞춰 키운다(적어도 세 칸 몫)
      const nobleSlots = clamp(3, v.nobles.length, 5);
      const f = clamp(-0.6, 1 - tight, 1);         // 가장자리 정보의 넉넉함 (1 넉넉 … 0 빠듯 … 음수 = 더 줄임)
      const k = tight > 1.6 ? Math.pow(0.95, (tight - 1.6) * 5) : 1;  // 그래도 안 되면 카드 줄이기
      /** @type {any} */
      const Z = { wide, W, H };
      if (wide) {
        const pad = Z.pad = Math.round(clamp(8, H * 0.016, 20));
        const gap = Z.gap = Math.round(clamp(6, H * 0.0155, 18));
        const u = Z.u = clamp(11, H / 62, 17.5);
        const trayH = clamp(84, H * (0.13 + 0.03 * f), 190);
        // 관전이면 내 자리 줄 대신 아래 한 줄(알림·'최근 일')
        const boardH = v.you === null ? H - pad * 2 - Math.max(40, u * 2.5) - gap * 1.1 : H - pad * 2 - (trayReal || trayH) - gap * 1.1;
        let cardW = ((boardH - gap * 2) / 3) / 1.4;
        const inner = trayH - u * 1.3;
        Z.tilePx = Math.round(clamp(20, inner * 0.3, 54));
        Z.chipPx = this.fitChip(5, Math.min(Z.tilePx * 1.15, 58), inner - Z.tilePx - u * 0.4, 1e4, 16);
        Z.tokH = Math.ceil(this.stackBox(5, Z.chipPx).h);
        Z.scorePx = Math.round(clamp(30, trayH * 0.5, 96));
        Z.miniW = Math.round(clamp(40, inner / 1.4, 124));
        Z.myNobleW = Math.round(clamp(30, trayH * 0.4, 76));
        Z.supplyPx = this.fitChip(7, clamp(22, cardW * 0.52, 120), boardH / 6 - gap * 0.25 - 2, 1e4, 20);
        const sb = this.stackBox(7, Z.supplyPx);
        Z.supH = Math.ceil(sb.h);
        const supplyCol = sb.w * 1.12;
        let nobleW = Math.min((boardH - gap * 0.8 * (nobleSlots - 1)) / nobleSlots / 1.15, cardW * 0.92);
        const oppMin = clamp(150, u * 12.5, 230);
        const avail = W - pad * 2 - gap * 2.2 * 3 - supplyCol - nobleW - oppMin;
        const cardWmax = (avail - gap * 4.6) / 5;
        if (cardW > cardWmax) { cardW = cardWmax; nobleW = Math.min(nobleW, cardW * 0.92); }
        cardW *= k;
        Z.cardW = Math.floor(cardW);
        Z.nobleW = Math.floor(nobleW);
        Z.oppW = Math.round(clamp(oppMin, W - pad * 2 - gap * 2.2 * 3 - supplyCol - nobleW - (Z.cardW * 5 + gap * 4.6), u * 19));
        Z.oppTile = Math.round(clamp(16, Z.oppW / 6 * 0.78, 34));
        Z.oppChip = Math.round(clamp(15, Z.oppW / 6 * 0.72, 30));
        Z.oppScore = Math.round(u * 2.1);
        Z.oppMiniW = Math.round(clamp(26, Z.oppW * 0.19, 54));
        Z.oppNobleW = Math.round(clamp(22, Z.oppW * 0.16, 44));
        Z.zoomCardW = Math.round(clamp(190, cardW * 1.75, Math.min(H * 0.52 / 1.4, 340)));
        Z.zoomNobleW = Math.round(clamp(170, nobleW * 2, Math.min(H * 0.5 / 1.15, 320)));
      } else {
        const pad = Z.pad = Math.round(clamp(5, W * 0.02, 14));
        const gap = Z.gap = Math.round(clamp(4, W * 0.0155, 12));
        const u = Z.u = clamp(11, W / 30, 15);
        let cardW = (W - pad * 2 - gap * 4) / 5;
        cardW = Math.min(cardW, 150) * k;
        Z.cardW = Math.floor(cardW);
        Z.nobleW = Math.floor(Math.min(cardW * (0.74 + (f > 0 ? 0.6 : 0.22) * f), (W - pad * 2 - gap * (nobleSlots - 1)) / nobleSlots));
        const cell = (W - pad * 2 - gap * 5) / 6;
        Z.supplyPx = this.fitChip(7, Math.min(cell * (0.62 + 0.2 * f), cardW * 0.68), 1e4, cell, 18);
        Z.supH = Math.ceil(this.stackBox(7, Z.supplyPx).h);
        const trayInner = W - pad * 4;
        Z.miniW = Math.round(clamp(34, trayInner * (0.105 + 0.02 * f), 70));
        const holdCell = (trayInner - Z.miniW * 3 - gap * 3.5) / 6;
        Z.tilePx = Math.round(clamp(18, holdCell * (0.8 + 0.1 * f + 0.25 * Math.min(0, f)), 44));
        Z.chipPx = this.fitChip(5, clamp(18, holdCell * (0.82 + 0.08 * f + 0.25 * Math.min(0, f)), 44), 1e4, holdCell, 16);
        Z.tokH = Math.ceil(this.stackBox(5, Z.chipPx).h);
        Z.scorePx = Math.round(u * (2.2 + 0.5 * f));
        Z.myNobleW = Math.round(clamp(18, Z.scorePx * 0.86, 40));
        const opps = Math.max(1, v.numPlayers - (v.you === null ? 0 : 1));
        // 관전 4인은 2×2 로 놓는다(내 자리 줄이 없어 세로 자리가 남는다)
        const perRow = v.you === null && v.numPlayers === 4 ? 2 : opps;
        Z.oppW = Math.floor((W - pad * 2 - gap * (perRow - 1)) / perRow);
        const oc = Math.min(Z.oppW, 160) / 6;
        Z.oppTile = Math.round(clamp(13, oc * (0.74 + 0.1 * f), 30));
        Z.oppChip = Math.round(clamp(13, oc * (0.72 + 0.08 * f), 28));
        Z.oppScore = Math.round(u * 1.7);
        Z.oppMiniW = Math.round(clamp(15, (15 + 5 * f) * (Z.oppW > 200 && f >= 0.5 ? 1.4 : 1), 30));
        Z.oppNobleW = Z.oppMiniW;
        Z.zoomCardW = Math.round(clamp(128, Math.min(W * 0.5, H * 0.33 / 1.4), 230));
        Z.zoomNobleW = Math.round(clamp(130, Math.min(W * 0.5, H * 0.3 / 1.15), 230));
      }
      // 가장자리 알림 한 줄의 높이(자리를 늘 비워 둔다: 알림이 떠도 배치가 흔들리거나 무엇을 가리지 않게)
      Z.noteH = Math.ceil(Math.max(12, Z.u * 0.98) * 1.25 + Z.u * 0.56 + 2);
      const tk = this.tileK();
      Z.tilePx = Math.round(Z.tilePx * tk);
      Z.oppTile = Math.round(Z.oppTile * tk);
      Z.tileK = tk;
      Z.f = f;
      return Z;
    }

    /** @param {any} Z */
    applySizes(Z) {
      const st = this.frame.style;
      st.setProperty('--card-w', Z.cardW + 'px');
      st.setProperty('--noble-w', Z.nobleW + 'px');
      st.setProperty('--gap', Z.gap + 'px');
      st.setProperty('--pad', Z.pad + 'px');
      st.setProperty('--u', Z.u.toFixed(2) + 'px');
      st.setProperty('--opp-w', Z.oppW + 'px');
      st.setProperty('--mini-w', Z.miniW + 'px');
      st.setProperty('--opp-mini-w', Z.oppMiniW + 'px');
      st.setProperty('--my-noble-w', Z.myNobleW + 'px');
      st.setProperty('--opp-noble-w', Z.oppNobleW + 'px');
      st.setProperty('--f', String(Z.f));
      st.setProperty('--tok-h', Z.tokH + 'px');
      st.setProperty('--sup-h', Z.supH + 'px');
      st.setProperty('--note-h', Z.noteH + 'px');
      this.Z = Z;
    }

    /** 다시 그린다(크기 맞춤 포함) */
    draw() {
      const v = this.view;
      if (!v) return;
      const W = this.frame.clientWidth; const H = this.frame.clientHeight;
      this.w = W; this.h = H;
      if (!W || !H) { this.applySizes(this.sizes(390, 844, false, 0)); this.paint(); return; }
      // 컨테이너 쿼리가 정한 배치를 읽는다(CSS 가 기준)
      const wide = getComputedStyle(this.root).getPropertyValue('--zb-wide').trim() === '1';
      const key = [W, H, wide ? 1 : 0, v.numPlayers, v.you === null ? 0 : 1, clamp(3, v.nobles.length, 5), this.skinId].join(':');
      const known = this.fit.get(key);
      if (known !== undefined) { this.applySizes(this.sizes(W, H, wide, known.t, known.tray)); this.paint(); return; }
      const steps = [0, 0.25, 0.5, 0.75, 1, 1.2, 1.4, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.4, 2.8, 3.2, 3.8];
      let used = steps[steps.length - 1];
      /** @type {number|undefined} */
      let trayReal;
      for (const t of steps) {
        trayReal = undefined;
        this.applySizes(this.sizes(W, H, wide, t));
        this.paint(true);
        if (wide) {
          // 내 자리의 실제 높이(스킨마다 칩·보너스 크기가 달라 어림과 다를 수 있다)로 판 높이를 다시 잡는다
          const tray = /** @type {HTMLElement|null} */ (this.root.querySelector('.zb-tray'));
          if (tray) {
            trayReal = tray.offsetHeight - this.Z.pad;
            this.applySizes(this.sizes(W, H, wide, t, trayReal));
            this.paint(true);
          }
        }
        if (!this.overflows()) { used = t; break; }
      }
      this.fit.set(key, { t: used, tray: trayReal });
      this.paint();
    }

    /** 확대해 보는 것의 원래 자리 @param {V2Sheet} sh @returns {Element|null} */
    zoomAnchor(sh) {
      const r = this.root;
      if (sh.kind === 'card') {
        const el = r.querySelector('.zb-table [data-zb="card:' + sh.cardId + '"]') || r.querySelector('.zb-tray [data-zb="card:' + sh.cardId + '"]');
        if (el) return el;
        const face = r.querySelector('.zb-opps [data-card-id="' + sh.cardId + '"]');
        return face ? face.closest('.zb-mini') : null;
      }
      if (sh.kind === 'deck') return r.querySelector('[data-zb="deck:' + sh.tier + '"]');
      if (sh.kind === 'noble') return r.querySelector('.zb-table [data-zb="noble:' + sh.nobleId + '"]');
      if (sh.kind === 'log') return r.querySelector('.zb-logbtn');
      return r.querySelector('.zb-opps [data-zb="seat:' + sh.seat + '"]');
    }

    /**
     * 확대한 것을 원래 자리 가운데에 맞춰 놓고(상대 칸은 윗변을 맞춘다), 틀 밖으로 넘치는 만큼만 안쪽으로 민다.
     * 새로 연 것이면 원래 크기에서 커지는 움직임을 준다.
     */
    placeZoom() {
      const sh = this.ui.sheet;
      const veil = this.root.querySelector('.zb-veil--zoom');
      const pop = veil ? /** @type {HTMLElement|null} */ (veil.querySelector('.zb-zoom')) : null;
      if (!sh || !veil || !pop) return;
      const W = this.frame.clientWidth; const H = this.frame.clientHeight;
      const fr = this.frame.getBoundingClientRect();
      const sc = (fr.width / (this.frame.offsetWidth || 1)) || 1;
      const el = this.zoomAnchor(sh);
      let a = { x: W / 2, y: H / 2, w: 0, h: 0 };
      if (el) { const b = el.getBoundingClientRect(); a = { x: (b.left - fr.left) / sc, y: (b.top - fr.top) / sc, w: b.width / sc, h: b.height / sc }; }
      const m = Math.max(6, this.Z.pad);
      pop.style.maxWidth = (W - m * 2) + 'px';
      pop.style.maxHeight = (H - m * 2) + 'px';
      const pw = pop.offsetWidth; const ph = pop.offsetHeight;
      const focus = /** @type {HTMLElement|null} */ (pop.querySelector('.zb-zoom__focus'));
      // 맞출 점: 커진 카드·귀족의 가운데. 상대 칸은 칸의 윗변 가운데
      let fx = pw / 2; let fy = 0; let ax = a.x + a.w / 2; let ay = a.y;
      // 최근 일: 단추 바로 위(자리가 없으면 아래)에 오른쪽을 맞춰 펼친다
      if (sh.kind === 'log') { fx = pw - a.w / 2; fy = a.y - ph - 6 >= m ? ph + 6 : -a.h - 6; }
      let k = a.w > 0 ? a.w / pw : 0.6;
      if (focus) { fx = focus.offsetLeft + focus.offsetWidth / 2; fy = focus.offsetTop + focus.offsetHeight / 2; ay = a.y + a.h / 2; k = a.w > 0 ? a.w / focus.offsetWidth : 0.6; }
      const left = clamp(m, ax - fx, Math.max(m, W - pw - m));
      const top = clamp(m, ay - fy, Math.max(m, H - ph - m));
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(top) + 'px';
      const key = JSON.stringify([sh.kind, /** @type {any} */ (sh).cardId || /** @type {any} */ (sh).nobleId || /** @type {any} */ (sh).tier || /** @type {any} */ (sh).seat || 0]);
      if (key !== this.zoomKey) {
        this.zoomKey = key;
        /** @type {HTMLElement} */ (veil).focus({ preventScroll: true });
        const motion = Zap.v2.motion;
        if (!this.opts.still && !(motion && motion.reduced()) && pop.animate) {
          pop.style.transformOrigin = fx + 'px ' + fy + 'px';
          pop.animate([
            { transform: 'translate(' + (ax - (left + fx)) + 'px,' + (ay - (top + fy)) + 'px) scale(' + clamp(0.2, k, 1) + ')', opacity: 0.7 },
            { transform: 'none', opacity: 1 },
          ], { duration: 190, easing: 'cubic-bezier(.2,.8,.25,1.08)' });
        }
      }
    }

    /** '최근 일' 가운데 아직 안 본 남의 일 개수 */
    unread() {
      const you = this.view ? this.view.you : null;
      let n = 0;
      for (let i = this.logSeen; i < this.log.length; i++) { const e = /** @type {any} */ (this.log[i]); if (e.seat === undefined || e.seat !== you) n++; }
      return n;
    }

    overflows() {
      const r = this.root;
      if (r.scrollHeight > r.clientHeight + 1 || r.scrollWidth > r.clientWidth + 1) return true;
      const tray = r.querySelector('.zb-tray');
      if (tray && (tray.scrollWidth > tray.clientWidth + 1)) return true;
      const mk = r.querySelector('.zb-market');
      if (mk && this.Z.cardW * 1.4 * 3 + this.Z.gap * 2 > mk.clientHeight + 1.5) return true;
      const sup = r.querySelector('.zb-supply');
      // (가로 배치) 공급처 열에 칩 더미가 다 들어가는지. 세로 배치에서는 줄 높이가 내용을 따르므로 스킨 그림의 작은 삐져나옴은 무시
      if (sup && this.Z.wide && sup.scrollHeight > sup.clientHeight + 2) return true;
      const opps = r.querySelector('.zb-opps');
      if (opps && (opps.scrollHeight > opps.clientHeight + 1 || opps.scrollWidth > opps.clientWidth + 1)) return true;
      return false;
    }

    /* ── 그리기 ── */

    /**
     * 달라진 조각만 새로 만든다. 조각마다 '무엇에 따라 그려지는지'를 글자열(sig)로 만들어 두고, 같으면 문서에 있는 것을 그대로 둔다
     * (카드 그림이 많아 통째로 갈아 끼우면 배치 계산이 무겁다). 누르기 처리는 늘 inst.ctx(가장 최근 것)를 읽으므로 남겨 둔 조각도 최신 상태로 움직인다.
     * @param {string} key @param {string} sig @param {() => HTMLElement} build @returns {HTMLElement}
     */
    part(key, sig, build) {
      const old = this.parts.get(key);
      if (old && old.sig === sig) return old.el;
      const el = build();
      this.parts.set(key, { sig, el });
      return el;
    }

    /** @param {boolean} [bare] 크기 맞춤용: 덮개(작은 판·결과) 없이 */
    paint(bare) {
      const v = /** @type {PlayerView} */ (this.view);
      const o = this.opts;
      const ui = this.ui;
      const you = v.you;
      const myTurn = you !== null && v.current === you && v.phase !== 'over';
      const can = myTurn && o.interactive !== false && !ui.pending;
      const L = indexLegal(can ? v.legal : []);
      /** @param {Move} move */
      const send = (move) => {
        const c = this.ctx;
        if (!c.can) return;
        this.sentAt = Date.now();
        ui.pending = true;
        ui.sheet = null;
        const before = this.view;
        if (o.on && o.on.move) o.on.move(move);
        if (this.view === before) this.paint();
      };
      /** @param {V2Sheet|null} sheet */
      const open = (sheet) => {
        ui.sheet = sheet;
        const snd = Zap.v2.sound;
        if (snd && sheet) snd.play(sheet.kind === 'player' || sheet.kind === 'log' ? 'oppSelect' : sheet.kind === 'noble' ? 'noblePick' : 'cardPick');
        if (sheet && sheet.kind === 'log') this.logSeen = this.log.length;
        this.paint();
      };
      const ctx = this.ctx = { inst: this, v, o, ui, you, myTurn, can, L, send, open, skin: o.skin, Z: this.Z };

      const kids = [];
      kids.push(oppsEl(ctx));
      // 판(귀족·덱·카드·공급처)은 한 묶음. 세로 배치에서는 이 묶음 안의 여백을 좁게, 가로 배치에서는 묶음 틀이 사라지고(display: contents) 각자 제 열에 놓인다
      const table = this.part('table', '', () => h('div.zb-table'));
      sync(table, [noblesEl(ctx), marketEl(ctx), supplyEl(ctx)]);
      kids.push(table);
      // 가장자리 알림 한 줄: 내 자리가 있으면 내 자리 안의 알림 칸(배치마다 늘 비워 둔 자리)에, 관전이면 판 아래 한 줄에
      const noteText = this.toastMsg || noticeText(v, o);
      const note = noteText ? this.part('notice', noteText + '|' + (this.toastMsg ? 't' : 'n') + (you === null ? 'w' : ''), () => /** @type {HTMLElement} */ (this.noticeEl())) : null;
      if (you !== null) {
        const tray = trayEl(ctx);
        kids.push(tray);
        const slot = tray.querySelector('.zb-tray__note');
        if (slot) sync(slot, note ? [note] : []);
      } else {
        kids.push(this.part('logbtn', String(this.unread()), () => logBtn(ctx, 'zb-logbtn--foot')));
        if (note) kids.push(note);
      }
      // 크기 맞춤(bare) 중에도 열린 확대 덮개는 그 자리에 둔다(빼었다 다시 넣으면 초점이 빠지고 나타나는 움직임이 되풀이된다)
      const sheet = bare ? (ui.sheet && this.zoomBox ? this.zoomBox.veil : null) : zoomEl(ctx);
      if (sheet) kids.push(sheet);
      else if (!bare) { this.zoomKey = ''; this.zoomBox = null; }
      if (!bare && v.phase === 'over' && o.result !== false && !ui.resultHidden) kids.push(resultEl(ctx));
      else if (!bare) this.resultShown = false;

      this.root.className = 'zb ' + cls({
        'is-myturn': myTurn, 'is-watch': you === null, 'is-over': v.phase === 'over',
        'is-picking': can && v.phase === 'action', 'is-returning': can && v.phase === 'return',
      });
      this.root.setAttribute('data-n', String(v.numPlayers));
      this.root.setAttribute('data-phase', v.phase);
      sync(this.root, kids);
      if (sheet && !bare) this.placeZoom();
    }
  }

  /** parent 의 자식을 kids 와 같게 하되, 이미 제자리에 있는 것은 건드리지 않는다 @param {Element} parent @param {Element[]} kids */
  function sync(parent, kids) {
    for (let i = 0; i < kids.length; i++) {
      const at = parent.children[i];
      if (at === kids[i]) continue;
      // 자리에 있던 것이 더는 쓰이지 않으면 갈아 끼우고, 아니면 그 앞에 끼운다
      if (at && kids.indexOf(/** @type {any} */ (at)) < 0) parent.replaceChild(kids[i], at);
      else parent.insertBefore(kids[i], at || null);
    }
    while (parent.children.length > kids.length) /** @type {Element} */ (parent.lastElementChild).remove();
  }

  /** @type {Record<string, boolean>} */
  const fontDone = {};
  /** @param {V2Skin} skin */
  function ensureFont(skin) {
    if (fontDone[skin.id] || !skin.fontCss) return;
    fontDone[skin.id] = true;
    const st = document.createElement('style');
    st.setAttribute('data-zb-font', skin.id);
    st.textContent = skin.fontCss;
    document.head.appendChild(st);
  }

  /* ───────────── 조각들 ───────────── */

  /**
   * 작게 보일 카드: 스킨이 약속한 최소 폭으로 그린 뒤 축소한다.
   * @param {number} w 보일 폭 @param {HTMLElement} inner @returns {HTMLElement}
   */
  function mini(w, inner) {
    const draw = Math.max(w, MIN_DRAW_W);
    const wrap = h('span.zb-mini__s', { style: draw !== w ? { transform: 'scale(' + (w / draw).toFixed(4) + ')' } : null }, inner);
    return h('span.zb-mini', { style: { width: w + 'px', height: (w * 1.4).toFixed(1) + 'px', '--card-w': draw + 'px' } }, wrap);
  }
  /** @param {number} w @param {HTMLElement} inner @returns {HTMLElement} */
  function miniNoble(w, inner) {
    const draw = Math.max(w, 48);
    const wrap = h('span.zb-mini__s', { style: draw !== w ? { transform: 'scale(' + (w / draw).toFixed(4) + ')' } : null }, inner);
    return h('span.zb-mini.zb-mini--noble', { style: { width: w + 'px', height: (w * 1.15).toFixed(1) + 'px', '--noble-w': draw + 'px' } }, wrap);
  }

  /** 방장 표시: 이름 옆의 작은 관 @returns {HTMLElement} */
  function leaderMark() {
    return h('span.zb-leader', { title: '방장', 'aria-label': '방장', role: 'img', test: 'leader-mark' });
  }

  /** 상대 정보: 작은 격자 @param {any} ctx @returns {HTMLElement} */
  function oppsEl(ctx) {
    const { v, you, inst } = ctx;
    const items = [];
    for (let i = 0; i < v.numPlayers; i++) {
      const seat = you === null ? i : (you + 1 + i) % v.numPlayers;
      if (seat === you) continue;
      items.push(oppEl(ctx, seat));
    }
    const box = inst.part('opps', String(items.length), () => h('div.zb-opps', { test: 'opps', 'data-count': String(items.length) }));
    sync(box, items);
    return box;
  }

  /** @param {any} ctx @param {number} seat @returns {HTMLElement} */
  function oppEl(ctx, seat) {
    const { v, o, skin, Z, inst } = ctx;
    /** @type {PlayerPublicView} */
    const p = v.players[seat];
    const off = o.connected && o.connected[seat] === false;
    const cur = v.phase !== 'over' && v.current === seat;
    const win = v.phase === 'over' && (v.winners || []).indexOf(seat) >= 0;
    const lead = o.leader !== undefined && o.leader !== null && o.leader === seat;
    const sig = JSON.stringify([p.tokens, p.bonuses, p.score, p.reserved, p.nobles, off, cur, win, lead, v.firstPlayer === seat, o.names[seat], Z.oppTile, Z.oppChip, Z.oppScore, Z.oppMiniW, Z.oppNobleW]);
    return inst.part('opp:' + seat, sig, () => {
      const cells = TOKENS.map((c) => h('span.zb-cell', { 'data-color': c },
        c === 'gold' ? h('span.zb-cell__none') : h('span.zb-cell__bon', { 'data-zb': 'bon:' + seat + ':' + c, class: cls({ 'is-zero': p.bonuses[c] === 0 }) }, skin.bonusTile(c, p.bonuses[c], Z.oppTile)),
        h('span.zb-cell__tok', { 'data-zb': 'tok:' + seat + ':' + c, class: cls({ 'is-zero': p.tokens[c] === 0 }) }, smallChip(skin, c, p.tokens[c], Z.oppChip))));
      const res = p.reserved.map((/** @type {ReservedView} */ r) => {
        if ('hidden' in r) return mini(Z.oppMiniW, skin.cardBack(r.tier));
        return mini(Z.oppMiniW, inst.keep('opp:' + r.id, () => skin.card(Zap.data.cardsById[r.id])));
      });
      const nobles = p.nobles.map((/** @type {string} */ id) => miniNoble(Z.oppNobleW, inst.keep('oppn:' + id, () => skin.noble(Zap.data.noblesById[id]))));
      return h('button.zb-opp', {
        test: 'player-' + seat, 'data-zb': 'seat:' + seat, 'data-connected': String(!off), type: 'button',
        class: cls({ 'is-current': cur, 'is-off': off, 'is-winner': win, 'is-first': v.firstPlayer === seat }),
        'aria-label': o.names[seat] + '님 ' + p.score + '점, 토큰 ' + p.tokenTotal + '개' + (cur ? ', 차례' : '') + (off ? ', 연결 끊김' : '') + (lead ? ', 방장' : ''),
        onclick: () => inst.ctx.open({ kind: 'player', seat }),
      },
        h('span.zb-opp__head', null,
          lead ? leaderMark() : null,
          h('span.zb-opp__name', null, o.names[seat]),
          off ? h('span.zb-opp__off', { title: '연결 끊김', 'aria-hidden': 'true' }) : null,
          h('span.zb-opp__score', { 'data-zb': 'score:' + seat }, skin.pointsBadge(p.score, Z.oppScore))),
        h('span.zb-opp__grid', null, cells),
        h('span.zb-opp__extra', { class: cls({ 'is-none': !res.length && !nobles.length }) },
          h('span.zb-opp__res', { 'data-zb': 'res:' + seat }, res),
          h('span.zb-opp__nob', { 'data-zb': 'nob:' + seat }, nobles)));
    });
  }

  /**
   * 좁은 자리의 토큰 표시: 숫자가 든 작은 칩(비용 칩과 같은 생김새). 황금은 칩 더미 함수로.
   * @param {V2Skin} skin @param {TokenColor} c @param {number} n @param {number} px @returns {HTMLElement}
   */
  function smallChip(skin, c, n, px) {
    if (c === 'gold') return h('span.zb-goldchip', { style: { '--px': px + 'px' } }, skin.gem('gold', px), h('span.zb-goldchip__n', null, String(n)));
    return skin.costChip(c, n, px);
  }

  /** @param {any} ctx @returns {HTMLElement} */
  function noblesEl(ctx) {
    const { v, inst, skin } = ctx;
    return inst.part('nobles', v.nobles.join(',') + '|' + v.numPlayers, () => {
      const items = v.nobles.map((/** @type {string} */ id) => {
        const def = Zap.data.noblesById[id];
        return h('button.zb-noblebtn', {
          test: 'noble-' + id, 'data-zb': 'noble:' + id, type: 'button', 'aria-label': '귀족 ' + def.points + '점',
          onclick: () => inst.ctx.open({ kind: 'noble', nobleId: id }),
        }, inst.keep('noble:' + id, () => skin.noble(def)));
      });
      return h('div.zb-nobles', { test: 'nobles', 'data-count': String(v.numPlayers + 1) }, items);
    });
  }

  /** @param {any} ctx @returns {HTMLElement} */
  function marketEl(ctx) {
    const { v, L, inst, skin } = ctx;
    const rows = TIERS.map((tier) => {
      const count = v.deckCounts[tier];
      const ids = v.market[tier];
      const sig = ids.map((/** @type {string|null} */ id) => (id || '-') + (id && L.buy.has(id) ? '*' : '')).join(',') + '|' + count + '|' + (L.reserveDeck.has(tier) ? 'r' : '');
      return inst.part('tier:' + tier, sig, () => {
        const deck = h('button.zb-deckbtn', {
          test: 'deck-' + tier, 'data-zb': 'deck:' + tier, type: 'button',
          class: cls({ 'is-reservable': L.reserveDeck.has(tier), 'is-empty': count === 0 }),
          'aria-label': tier + '단계 덱, ' + count + '장',
          onclick: () => inst.ctx.open({ kind: 'deck', tier }),
        }, skin.deck(tier, count));
        const cards = ids.map((/** @type {string|null} */ id, /** @type {number} */ i) => {
          if (!id) return h('div.zb-slot', { test: 'slot-' + tier + '-' + i, 'data-zb': 'slot:' + tier + ':' + i }, skin.emptySlot());
          const def = Zap.data.cardsById[id];
          return h('button.zb-card', {
            test: 'card-' + id, 'data-zb': 'card:' + id, 'data-slot': tier + ':' + i, type: 'button',
            class: cls({ 'is-buyable': L.buy.has(id) }),
            'aria-label': cardLabel(def) + (L.buy.has(id) ? ', 살 수 있음' : ''),
            onclick: () => inst.ctx.open({ kind: 'card', cardId: id }),
          }, inst.keep('card:' + id, () => skin.card(def)));
        });
        return h('div.zb-tier', { test: 'tier-' + tier, 'data-tier': String(tier) }, deck, cards);
      });
    });
    const box = inst.part('market', '', () => h('div.zb-market'));
    sync(box, rows);
    return box;
  }

  /** @param {CardDef} def */
  function cardLabel(def) {
    return def.tier + '단계 ' + CNAME[def.bonus] + ' 카드' + (def.points > 0 ? ' ' + def.points + '점' : '');
  }

  /** @param {any} ctx @returns {HTMLElement} */
  function supplyEl(ctx) {
    const { v, ui, can, inst, skin, Z } = ctx;
    const picking = can && v.phase === 'action';
    const stacks = TOKENS.map((c) => {
      const left = v.supply[c];
      const sel = c === 'gold' ? 0 : ui.sel[c];
      // 내 차례 action 단계가 아니면(남의 차례·관전·보낸 수의 답을 기다리는 중) 눌리지 않는다. 황금은 고르는 중에만 눌려 안내를 띄운다
      const off = !picking || (left === 0 && sel === 0);
      return inst.part('supply:' + c, left + '|' + sel + '|' + (picking ? 1 : 0) + '|' + Z.supplyPx, () => h('button.zb-stack', {
        test: 'supply-' + c, 'data-zb': 'supply:' + c, 'data-color': c, type: 'button', disabled: off,
        class: cls({ 'is-picked': sel > 0, 'is-empty': left === 0, 'is-inert': off || c === 'gold' }),
        'aria-label': CNAME[c] + ' 토큰 ' + left + '개' + (sel ? ', ' + sel + '개 고름' : ''),
        'aria-pressed': c === 'gold' ? null : String(sel > 0),
        onclick: () => {
          const x = inst.ctx;
          if (!(x.can && x.v.phase === 'action')) return;
          if (c === 'gold') { inst.toast('황금은 예약할 때 1개'); return; }
          const msg = toggleSel(x.ui.sel, /** @type {Color} */ (c), x.v, x.L);
          if (msg) inst.toast(msg);
          const s = Zap.v2.sound; if (s && !msg) s.play('chipPlace', { gain: 0.7 });
          inst.paint();
        },
      }, skin.chipStack(c, left - sel, Z.supplyPx),
        sel > 0 ? h('span.zb-stack__sel', { 'aria-hidden': 'true' }, Array.from({ length: sel }, () => skin.gem(c, Math.round(Z.supplyPx * 0.5)))) : null));
    });
    const box = inst.part('supply', '', () => h('div.zb-supply', { test: 'supply' }));
    sync(box, stacks);
    return box;
  }

  /** 내 자리: 아래 가장자리, 두 줄(보너스·토큰) @param {any} ctx @returns {HTMLElement} */
  function trayEl(ctx) {
    const { v, o, ui, you, myTurn, can, L, inst, skin, Z } = ctx;
    /** @type {PlayerPublicView} */
    const p = v.players[you];
    const returning = can && v.phase === 'return';
    const ex = p.tokenTotal - TOKEN_LIMIT;
    const picked = sum(ui.ret);
    const win = v.phase === 'over' && (v.winners || []).indexOf(you) >= 0;
    const selAny = COLORS.some((c) => ui.sel[c] > 0);
    const takeOk = !!takeMoveFor(ui.sel, L);
    const buyRes = p.reserved.map((/** @type {any} */ r) => (r.id && L.buy.has(r.id) ? 1 : 0)).join('');

    const lead = o.leader !== undefined && o.leader !== null && o.leader === you;
    const unread = inst.unread();
    const sig = JSON.stringify([p.tokens, p.bonuses, p.score, p.reserved, p.nobles, ui.ret, selAny, takeOk, buyRes, v.phase, myTurn, can, L.endTurn, win, o.result !== false, lead, unread,
      Z.chipPx, Z.tilePx, Z.scorePx, Z.miniW, Z.myNobleW]);
    return inst.part('tray', sig, () => {
      const cols = TOKENS.map((c) => {
        const held = p.tokens[c];
        const out = ui.ret[c] || 0;
        const shown = held - (returning ? out : 0);
        const stack = skin.chipStack(c, shown, Z.chipPx);
        const tok = returning
          ? h('button.zb-hold__tok.zb-hold__tokbtn', {
            test: 'return-pick-' + c, 'data-zb': 'tok:' + you + ':' + c, type: 'button', disabled: shown <= 0 || picked >= ex,
            class: cls({ 'is-zero': shown === 0 }),
            'aria-label': CNAME[c] + ' 토큰 ' + shown + '개, 누르면 1개 반납',
            onclick: () => {
              const x = inst.ctx; const me = x.v.players[x.you];
              if (!(x.can && x.v.phase === 'return')) return;
              if (x.ui.ret[c] < me.tokens[c] && sum(x.ui.ret) < me.tokenTotal - TOKEN_LIMIT) { x.ui.ret[c] += 1; const s = Zap.v2.sound; if (s) s.play('chipPlace', { gain: 0.7 }); inst.paint(); }
            },
          }, stack)
          : h('span.zb-hold__tok', { test: 'my-token-' + c, 'data-zb': 'tok:' + you + ':' + c, 'data-n': String(held), class: cls({ 'is-zero': shown === 0 }) }, stack);
        const bon = c === 'gold'
          ? h('span.zb-hold__bon.is-none')
          : h('span.zb-hold__bon', { test: 'my-bonus-' + c, 'data-zb': 'bon:' + you + ':' + c, 'data-n': String(p.bonuses[c]), class: cls({ 'is-zero': p.bonuses[c] === 0 }) }, skin.bonusTile(c, p.bonuses[c], Z.tilePx));
        return h('div.zb-hold__col', { 'data-color': c }, bon, tok);
      });

      const reserved = [];
      for (const r of p.reserved) {
        if ('hidden' in r) { reserved.push(mini(Z.miniW, skin.cardBack(r.tier))); continue; }
        const def = Zap.data.cardsById[r.id];
        reserved.push(h('button.zb-card.zb-card--res', {
          test: 'reserved-' + r.id, 'data-zb': 'card:' + r.id, type: 'button', class: cls({ 'is-buyable': L.buy.has(r.id), 'is-secret': r.fromDeck }),
          'aria-label': '내 예약 카드: ' + cardLabel(def) + (L.buy.has(r.id) ? ', 살 수 있음' : '') + (r.fromDeck ? ', 나만 봄' : ''),
          onclick: () => inst.ctx.open({ kind: 'card', cardId: r.id }),
        }, mini(Z.miniW, inst.keep('res:' + r.id, () => skin.card(def)))));
      }
      for (let i = p.reserved.length; i < RESERVE_LIMIT; i++) reserved.push(h('span.zb-resghost', { style: { width: Z.miniW + 'px', height: (Z.miniW * 1.4).toFixed(1) + 'px' } }));

      const nobles = p.nobles.map((/** @type {string} */ id) => miniNoble(Z.myNobleW, inst.keep('myn:' + id, () => skin.noble(Zap.data.noblesById[id]))));

      // 누를 것: 최근 일 / (취소) 가져오기 / (다시) 반납 / 차례 넘기기. 주된 단추는 늘 맨 오른쪽 같은 자리:
      // 수를 두고 나면 그 자리에 [차례 넘기기]가 나타나는데 잠깐 잠겨 있으므로, 두 번 누르기의 두 번째가 다른 것을 누르지 않는다
      const act = [logBtn(ctx, '')];
      if (myTurn && v.phase === 'action' && selAny) {
        act.push(h('button.zb-btn.zb-btn--quiet', { test: 'take-cancel', type: 'button', 'aria-label': '고른 토큰 취소', onclick: () => { inst.ctx.ui.sel = zeroColors(); inst.paint(); } }, '취소'));
        act.push(h('button.zb-btn.zb-btn--go', {
          test: 'take-confirm', type: 'button', disabled: !(can && takeOk),
          onclick: () => { const x = inst.ctx; const move = takeMoveFor(x.ui.sel, x.L); if (move) x.send(move); },
        }, '가져오기'));
      } else if (myTurn && v.phase === 'return') {
        if (picked > 0) act.push(h('button.zb-btn.zb-btn--quiet', { test: 'return-clear', type: 'button', onclick: () => { inst.ctx.ui.ret = zeroTokens(); inst.paint(); } }, '다시'));
        act.push(h('button.zb-btn.zb-btn--go', {
          test: 'return-confirm', type: 'button', disabled: !(can && picked === ex), class: cls({ 'is-ready': can && picked === ex }),
          onclick: () => { const x = inst.ctx; x.send({ type: 'return', tokens: Object.assign(zeroTokens(), x.ui.ret) }); },
        }, '반납 ' + picked + '/' + ex));
      } else if (v.phase === 'over') {
        if (o.result !== false) act.push(h('button.zb-btn.zb-btn--go', { test: 'show-result', type: 'button', onclick: () => { inst.ctx.ui.resultHidden = false; inst.paint(); } }, '결과 보기'));
      } else {
        // 수를 둔 바로 뒤에는 [가져오기]·[반납] 이 있던 자리에 [차례 넘기기]가 나타난다: 두 번 누르기가 차례를 넘기지 않게 잠깐 잠근다
        const endOn = !!(can && L.endTurn);
        const wait = inst.armWait('end', endOn);
        const endBtn = h('button.zb-btn.zb-btn--end', {
          test: 'end-turn', type: 'button', disabled: !endOn || wait > 0, class: cls({ 'is-ready': endOn, 'is-idle': !myTurn, 'is-arming': wait > 0 }),
          onclick: () => { if (inst.armWait('end', true) > 0) return; inst.ctx.send({ type: 'endTurn' }); },
        }, '차례 넘기기');
        if (wait > 0) {
          setTimeout(() => {
            const x = inst.ctx;
            if (x && x.can && x.L.endTurn) { /** @type {HTMLButtonElement} */ (endBtn).disabled = false; endBtn.classList.remove('is-arming'); }
          }, wait + 15);
        }
        act.push(endBtn);
      }

      return h('section.zb-tray', {
        test: 'me', 'data-zb': 'seat:' + you,
        class: cls({ 'is-current': myTurn, 'is-winner': win, 'is-over': p.tokenTotal > TOKEN_LIMIT }),
      },
        h('div.zb-tray__id', null,
          h('span.zb-tray__score', { test: 'my-score', 'data-zb': 'score:' + you, 'data-n': String(p.score), 'aria-label': p.score + '점' }, skin.pointsBadge(p.score, Z.scorePx)),
          h('span.zb-tray__total', { test: 'my-token-total', class: cls({ 'is-over': p.tokenTotal > TOKEN_LIMIT }), 'aria-label': '토큰 ' + p.tokenTotal + '개, 한도 ' + TOKEN_LIMIT },
            h('b', null, String(p.tokenTotal)), '/' + TOKEN_LIMIT),
          lead ? leaderMark() : null),
        h('div.zb-hold', { class: cls({ 'is-returning': returning }) }, cols),
        h('div.zb-tray__res', { test: 'my-reserved', 'data-zb': 'res:' + you }, reserved),
        h('div.zb-tray__nob', { test: 'my-nobles', 'data-zb': 'nob:' + you, class: cls({ 'is-none': !nobles.length }) }, nobles),
        h('div.zb-tray__act', null,
          h('div.zb-tray__note'),
          h('div.zb-tray__btns', null, act)));
    });
  }

  /* ───────────── 제자리 확대 ─────────────
   * 카드·덱·귀족·상대 칸은 누르면 원래 자리를 중심으로 커진다(시선과 손이 멀리 가지 않게). 누를 것(구매·예약·받기)과
   * 황금 지불 조정은 커진 것 바로 아래에 붙는다. 바깥이나 커진 것을 다시 누르면 닫힌다. 자리 잡기는 BoardInst.placeZoom. */

  /** @param {any} ctx @returns {HTMLElement|null} */
  function zoomEl(ctx) {
    const { ui, inst } = ctx;
    const sh = ui.sheet;
    if (!sh) return null;
    const close = () => { ui.sheet = null; inst.paint(); };
    let body = null;
    if (sh.kind === 'card') body = cardZoom(ctx, sh, close);
    else if (sh.kind === 'deck') body = deckZoom(ctx, sh.tier, close);
    else if (sh.kind === 'player') body = playerZoom(ctx, sh.seat, close);
    else if (sh.kind === 'noble') body = nobleZoom(ctx, sh.nobleId, close);
    else if (sh.kind === 'log') body = logZoom(ctx, close);
    if (!body) { ui.sheet = null; return null; }
    // 덮개와 창은 한 번 만들어 두고(열려 있는 동안 같은 요소) 안만 바꾼다: 지불 조정 때 깜빡이거나 초점이 빠지지 않게
    let box = inst.zoomBox;
    if (!box) {
      const pop = h('div.zb-zoom', { role: 'dialog', 'aria-modal': 'true' });
      const veil = h('div.zb-veil.zb-veil--zoom', {
        test: 'sheet', tabindex: '-1',
        onclick: (/** @type {Event} */ e) => { if (e.target === e.currentTarget) { inst.ui.sheet = null; inst.paint(); } },
        onkeydown: (/** @type {KeyboardEvent} */ e) => trapTab(e, veil, pop),
      }, pop);
      box = inst.zoomBox = { veil, pop };
    }
    const { veil, pop } = box;
    veil.setAttribute('data-kind', sh.kind);
    pop.className = 'zb-zoom zb-zoom--' + sh.kind;
    pop.setAttribute('aria-label', sh.kind === 'log' ? '최근 일' : sh.kind === 'player' ? '상대 자세히' : '확대');
    const a = document.activeElement;
    const had = a && a !== pop && pop.contains(a) ? a.getAttribute('data-test') : null;
    pop.replaceChildren(...body);
    if (had) {
      // 지불 조정처럼 창 안의 단추를 눌러 다시 그렸으면 같은 단추(없거나 꺼졌으면 덮개)에 초점을 돌려 둔다
      // (지불 조정 단추가 꺼졌으면 같은 색의 반대 단추로: 황금으로 ↔ 보석으로)
      const pair = /^pay-gold-/.test(had) ? had.replace('pay-gold-', 'pay-gem-') : /^pay-gem-/.test(had) ? had.replace('pay-gem-', 'pay-gold-') : '';
      const pick = [had, pair].map((t) => (t ? /** @type {HTMLButtonElement|null} */ (pop.querySelector('[data-test="' + t + '"]')) : null)).find((b) => b && !b.disabled);
      if (pick) pick.focus({ preventScroll: true });
      else veil.focus({ preventScroll: true });
    }
    return veil;
  }

  /**
   * 확대 창 안에서 Tab 이 돈다(뒤의 판 단추로 빠지지 않게).
   * @param {KeyboardEvent} e @param {HTMLElement} veil @param {HTMLElement} pop
   */
  function trapTab(e, veil, pop) {
    if (e.key !== 'Tab') return;
    // (스킨 그림 안의 SVG <use href> 같은 것은 초점을 받지 않으므로 HTML 요소만)
    const list = /** @type {HTMLElement[]} */ (Array.from(pop.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')))
      .filter((el) => el instanceof HTMLElement && (el.offsetParent !== null || el === document.activeElement));
    if (!list.length) { e.preventDefault(); veil.focus({ preventScroll: true }); return; }
    const first = list[0]; const last = list[list.length - 1];
    const at = document.activeElement;
    const inside = !!at && pop.contains(at) && at !== pop;
    if (e.shiftKey) {
      if (!inside || at === first) { e.preventDefault(); last.focus({ preventScroll: true }); }
    } else if (!inside || at === last) { e.preventDefault(); first.focus({ preventScroll: true }); }
  }

  /** @param {PlayerPublicView} p @param {CardDef} def @returns {{lack:ColorCounts, total:number}} */
  function shortage(p, def) {
    const lack = zeroColors();
    let need = 0;
    for (const c of COLORS) { lack[c] = Math.max(0, def.cost[c] - p.bonuses[c] - p.tokens[c]); need += lack[c]; }
    return { lack, total: Math.max(0, need - p.tokens.gold) };
  }

  /** @param {any} ctx @param {{kind:'card', cardId:string, payment?:TokenCounts}} sh @param {() => void} close @returns {HTMLElement[]|null} */
  function cardZoom(ctx, sh, close) {
    const { v, o, you, myTurn, can, L, send, skin, Z } = ctx;
    const cardId = sh.cardId;
    const def = Zap.data.cardsById[cardId];
    const where = locateCard(v, cardId);
    if (!def || !where) return null;
    const mine = where.place === 'reserved' && where.seat === you;
    const others = where.place === 'reserved' && where.seat !== you;
    const under = [];
    if (others) under.push(h('div.zb-zoom__line', null, o.names[where.seat] + '님이 예약'));
    if (mine && where.fromDeck) under.push(h('div.zb-zoom__line', null, '나만 보는 카드'));
    if (you !== null && !others && v.phase !== 'over') {
      const p = v.players[you];
      const lack = shortage(p, def);
      const canBuy = can && L.buy.has(cardId);
      const canReserve = can && L.reserve.has(cardId);
      if (canBuy) {
        if (!sh.payment) sh.payment = Object.assign(zeroTokens(), L.buy.get(cardId));
        under.push(payEl(ctx, def, sh.payment));
      } else if (lack.total > 0) {
        const chips = COLORS.filter((c) => lack.lack[c] > 0).map((c) => skin.costChip(c, lack.lack[c], Math.round(Z.u * 2)));
        under.push(h('div.zb-zoom__lack', { test: 'lack', 'aria-label': lack.total + '개 모자람' },
          chips, h('span.zb-zoom__lackword', null, p.tokens.gold > 0 ? '황금을 써도 ' : '', h('b', null, String(lack.total)), '개 모자람')));
      }
      if (myTurn && v.phase === 'action') {
        if (!mine && !canReserve && p.reserved.length >= RESERVE_LIMIT) under.push(h('div.zb-zoom__line', null, '예약은 3장까지'));
        const pay = sh.payment;
        const valid = !!(canBuy && pay && Zap.rules.isValidPayment(p.tokens, p.bonuses, def, pay));
        under.push(h('div.zb-zoom__actions', null,
          h('button.zb-btn.zb-btn--go', {
            test: 'buy', type: 'button', disabled: !valid, class: cls({ 'is-ready': valid }),
            onclick: () => { if (pay) send({ type: 'buy', cardId, payment: Object.assign(zeroTokens(), pay) }); },
          }, '구매'),
          mine ? null : h('button.zb-btn', {
            test: 'reserve', type: 'button', disabled: !canReserve,
            onclick: () => send({ type: 'reserve', cardId }),
          }, '예약', v.supply.gold > 0 ? h('span.zb-btn__gem', null, '+', skin.gem('gold', Math.round(Z.u * 1.5))) : null)));
      }
    }
    return [
      h('button.zb-zoom__focus', { type: 'button', test: 'sheet-close', 'aria-label': cardLabel(def) + ', 누르면 닫힘', style: { '--card-w': Z.zoomCardW + 'px' }, onclick: close }, skin.card(def)),
      under.length ? h('div.zb-zoom__under', null, under) : null,
    ].filter(Boolean);
  }

  /**
   * 낼 토큰: 색마다 보석 더미(와 황금 더미). 황금이 있으면 색마다 보석 대신 황금을 내도록 바꿀 수 있다.
   * @param {any} ctx @param {CardDef} def @param {TokenCounts} pay @returns {HTMLElement}
   */
  function payEl(ctx, def, pay) {
    const { v, you, inst, skin, Z } = ctx;
    /** @type {PlayerPublicView} */
    const p = v.players[you];
    const rows = [];
    let goldUsed = 0;
    for (const c of COLORS) {
      const remain = Math.max(0, def.cost[c] - p.bonuses[c]);
      if (remain <= 0) continue;
      const gems = Math.min(pay[c], remain);
      const gold = remain - gems;
      goldUsed += gold;
      rows.push({ c, gems, gold });
    }
    pay.gold = goldUsed;
    const goldLeft = p.tokens.gold - goldUsed;
    if (!rows.length) return h('div.zb-zoom__line', { test: 'pay-free' }, '보너스만으로 삽니다');
    const px = Math.round(clamp(24, Z.u * 2.3, 40));
    const adjustable = p.tokens.gold > 0;
    /** @param {Color} c @param {number} d */
    const shift = (c, d) => { pay[c] += d; const s = Zap.v2.sound; if (s) s.play('chipPlace', { gain: 0.7 }); inst.paint(); };
    return h('div.zb-pay', { test: 'pay-rows', class: cls({ 'is-adjustable': adjustable }) }, rows.map((r) => h('div.zb-pay__col', {
      'data-color': r.c, test: 'pay-row-' + r.c, 'data-gems': String(r.gems), 'data-gold': String(r.gold),
      'aria-label': CNAME[r.c] + ' ' + r.gems + '개' + (r.gold ? ', 황금 ' + r.gold + '개' : ''),
    },
      h('span.zb-pay__piles', null,
        h('span.zb-pay__pile', { class: cls({ 'is-zero': r.gems === 0 }) }, skin.chipStack(r.c, r.gems, px)),
        r.gold > 0 ? h('span.zb-pay__pile', null, skin.chipStack('gold', r.gold, px)) : null),
      adjustable ? h('span.zb-pay__adj', null,
        h('button.zb-pay__btn', {
          test: 'pay-gold-' + r.c, type: 'button', disabled: !(r.gems > 0 && goldLeft > 0), 'aria-label': CNAME[r.c] + ' 1개 대신 황금 내기',
          onclick: () => shift(r.c, -1),
        }, skin.gem('gold', Math.round(px * 0.5)), '+'),
        h('button.zb-pay__btn', {
          test: 'pay-gem-' + r.c, type: 'button', disabled: !(r.gold > 0 && p.tokens[r.c] > r.gems), 'aria-label': '황금 1개 대신 ' + CNAME[r.c] + ' 내기',
          onclick: () => shift(r.c, 1),
        }, skin.gem('gold', Math.round(px * 0.5)), '−')) : null)));
  }

  /** @param {any} ctx @param {Tier} tier @param {() => void} close @returns {HTMLElement[]} */
  function deckZoom(ctx, tier, close) {
    const { v, you, myTurn, can, L, send, skin, Z } = ctx;
    const count = v.deckCounts[tier];
    const under = [];
    if (you !== null && myTurn && v.phase === 'action') {
      if (v.players[you].reserved.length >= RESERVE_LIMIT) under.push(h('div.zb-zoom__line', null, '예약은 3장까지'));
      else if (count > 0) under.push(h('div.zb-zoom__line', null, '보지 않고 가져와 나만 봅니다'));
      under.push(h('div.zb-zoom__actions', null, h('button.zb-btn.zb-btn--go', {
        test: 'reserve-deck', type: 'button', disabled: !(can && L.reserveDeck.has(tier)),
        onclick: () => send({ type: 'reserveDeck', tier }),
      }, '덱에서 예약', v.supply.gold > 0 && count > 0 ? h('span.zb-btn__gem', null, '+', skin.gem('gold', Math.round(Z.u * 1.5))) : null)));
    }
    return /** @type {HTMLElement[]} */ ([
      h('button.zb-zoom__focus', { type: 'button', test: 'sheet-close', 'aria-label': tier + '단계 덱 ' + count + '장, 누르면 닫힘', style: { '--card-w': Math.round(Z.zoomCardW * 0.86) + 'px' }, onclick: close }, skin.deck(tier, count)),
      under.length ? h('div.zb-zoom__under', null, under) : null,
    ].filter(Boolean));
  }

  /** 귀족: 문장과 조건을 크게. 받을 수 있을 때(내 행동 뒤, 조건 충족)만 [받기] @param {any} ctx @param {string} nobleId @param {() => void} close @returns {HTMLElement[]|null} */
  function nobleZoom(ctx, nobleId, close) {
    const { can, L, send, skin, Z } = ctx;
    const def = Zap.data.noblesById[nobleId];
    if (!def) return null;
    const claim = can && L.claim.has(nobleId);
    return /** @type {HTMLElement[]} */ ([
      h('button.zb-zoom__focus.zb-zoom__focus--noble', { type: 'button', test: 'sheet-close', 'aria-label': '귀족 ' + def.points + '점, 누르면 닫힘', style: { '--noble-w': Z.zoomNobleW + 'px' }, onclick: close }, skin.noble(def)),
      claim ? h('div.zb-zoom__under', null, h('div.zb-zoom__actions', null,
        h('button.zb-btn.zb-btn--go.is-ready', { test: 'claim-noble', type: 'button', onclick: () => send({ type: 'claimNoble', nobleId }) }, '받기'))) : null,
    ].filter(Boolean));
  }

  /** 상대 한 사람: 누른 그 자리에서 크게 펼친다 @param {any} ctx @param {number} seat @param {() => void} close @returns {HTMLElement[]|null} */
  function playerZoom(ctx, seat, close) {
    const { v, o, skin, Z, inst } = ctx;
    /** @type {PlayerPublicView} */
    const p = v.players[seat];
    if (!p) return null;
    const px = Math.round(clamp(28, Z.u * 2.7, 46));
    const cols = TOKENS.map((c) => h('div.zb-hold__col', { 'data-color': c },
      c === 'gold' ? h('span.zb-hold__bon.is-none') : h('span.zb-hold__bon', { class: cls({ 'is-zero': p.bonuses[c] === 0 }) }, skin.bonusTile(c, p.bonuses[c], Math.round(px * Z.tileK))),
      h('span.zb-hold__tok', { class: cls({ 'is-zero': p.tokens[c] === 0 }) }, skin.chipStack(c, p.tokens[c], px))));
    const cw = Math.round(clamp(76, Z.zoomCardW * 0.5, 150));
    const res = p.reserved.map((/** @type {ReservedView} */ r) => {
      if ('hidden' in r) return h('span.zb-pzoom__card', { style: { '--card-w': cw + 'px' } }, skin.cardBack(r.tier));
      return h('button.zb-pzoom__card', { type: 'button', style: { '--card-w': cw + 'px' }, test: 'opp-reserved-' + r.id, 'aria-label': cardLabel(Zap.data.cardsById[r.id]),
        onclick: () => inst.ctx.open({ kind: 'card', cardId: r.id }) }, skin.card(Zap.data.cardsById[r.id]));
    });
    const nobles = p.nobles.map((/** @type {string} */ id) => h('span.zb-pzoom__noble', { style: { '--noble-w': Math.round(cw * 0.86) + 'px' } }, skin.noble(Zap.data.noblesById[id])));
    const note = o.seatNote ? o.seatNote(seat) : null;
    return /** @type {HTMLElement[]} */ ([
      h('button.zb-pzoom__head', { type: 'button', test: 'sheet-close', 'aria-label': o.names[seat] + '님, 누르면 닫힘', onclick: close },
        o.leader !== undefined && o.leader !== null && o.leader === seat ? leaderMark() : null,
        h('span.zb-pzoom__name', null, o.names[seat]),
        o.connected && o.connected[seat] === false ? h('span.zb-pzoom__off', null, '연결 끊김') : null,
        h('span.zb-pzoom__total', null, h('b', null, String(p.tokenTotal)), '/' + TOKEN_LIMIT),
        skin.pointsBadge(p.score, Math.round(Z.u * 3))),
      h('div.zb-hold.zb-pzoom__hold', null, cols),
      (res.length || nobles.length) ? h('div.zb-pzoom__cards', null, res, nobles) : null,
      note ? h('div.zb-pzoom__note', { test: 'seat-note' }, h('b', null, note.title), note.text ? ' — ' + note.text : null) : null,
    ].filter(Boolean));
  }

  /* ───────────── 최근 일 ───────────── */

  /** '최근 일' 단추(펼침은 제자리 확대와 같은 덮개). 안 본 남의 일이 있으면 작은 수 표시 @param {any} ctx @param {string} extra @returns {HTMLElement} */
  function logBtn(ctx, extra) {
    const { inst } = ctx;
    const n = inst.unread();
    return h('button.zb-logbtn', {
      test: 'log-open', type: 'button', class: extra || null, 'aria-label': '최근 일' + (n ? ', 새 일 ' + n + '개' : ''), title: '최근 일',
      // 수를 보낸 바로 뒤(두 번 누르기의 두 번째)에는 열지 않는다
      onclick: () => { if (Date.now() - inst.sentAt < ARM_MS) return; inst.ctx.open({ kind: 'log' }); },
    }, h('i.zb-logbtn__icon', { 'aria-hidden': 'true' }), n ? h('span.zb-logbtn__n', { test: 'log-unread' }, n > 9 ? '9+' : String(n)) : null);
  }

  /** 토큰 묶음을 작은 칩들로 @param {any} ctx @param {TokenCounts} t @returns {HTMLElement[]} */
  function chipsOf(ctx, t) {
    const { skin, Z } = ctx;
    const px = Math.round(clamp(16, Z.u * 1.45, 22));
    const out = [];
    for (const c of TOKENS) if (t[c] > 0) out.push(smallChip(skin, c, t[c], px));
    return out;
  }

  /** 카드 한 장을 짧게: 보석 그림 + 단계 + 점수 @param {any} ctx @param {string} cardId @returns {HTMLElement} */
  function cardBit(ctx, cardId) {
    const { skin, Z } = ctx;
    const def = Zap.data.cardsById[cardId];
    if (!def) return h('span', null, '카드');
    return h('span.zb-log__card', null, skin.gem(def.bonus, Math.round(clamp(14, Z.u * 1.3, 20))), def.tier + '단계' + (def.points ? ' ' + def.points + '점' : ''));
  }

  /**
   * 사건 한 줄(첫 버전 text.js 의 문구와 같은 뜻을 짧게). 기록할 필요가 없는 사건은 null.
   * @param {any} ctx @param {GameEvent} ev @returns {HTMLElement|null}
   */
  function logLine(ctx, ev) {
    const { o, v } = ctx;
    /** @param {number} s */
    const who = (s) => h('b.zb-log__who', { class: s === v.you ? 'is-me' : null }, (o.names[s] || '자리 ' + (s + 1)) + '님');
    const line = (/** @type {any[]} */ ...kids) => h('div.zb-log__line', { test: 'log-line', 'data-type': ev.type }, kids);
    switch (ev.type) {
      case 'take': return line(who(ev.seat), ' 토큰 가져옴 ', h('span.zb-log__chips', null, chipsOf(ctx, ev.tokens)));
      case 'return': return line(who(ev.seat), ' 토큰 반납 ', h('span.zb-log__chips', null, chipsOf(ctx, ev.tokens)));
      case 'reserve': {
        const gold = ev.gold ? h('span.zb-log__chips', null, ' + ', chipsOf(ctx, { w: 0, u: 0, g: 0, r: 0, k: 0, gold: 1 })) : null;
        if (ev.fromDeck || !ev.cardId) return line(who(ev.seat), ' ' + ev.tier + '단계 덱에서 예약', gold);
        return line(who(ev.seat), ' 예약 ', cardBit(ctx, ev.cardId), gold);
      }
      case 'buy': {
        const paid = chipsOf(ctx, ev.payment);
        return line(who(ev.seat), ev.fromReserve ? ' 예약 카드 구매 ' : ' 구매 ', cardBit(ctx, ev.cardId), paid.length ? h('span.zb-log__chips', null, ' ← ', paid) : h('span.zb-log__soft', null, ' 보너스만으로'));
      }
      case 'noble': return line(who(ev.seat), ' 귀족 방문 (+' + ((Zap.data.noblesById[ev.nobleId] || { points: 3 }).points) + '점)');
      case 'autoPass': return line(who(ev.seat), ' 둘 수 있는 수가 없어 자동 패스');
      case 'finalRound': return line(who(ev.seat), ' 15점 — 이번 라운드가 마지막');
      case 'gameOver': return line(h('b.zb-log__who', null, '판 끝'), ' — ' + (ev.winners.length > 1 ? '공동 승리 ' : '승리 ') + ev.winners.map((s) => (o.names[s] || '') + '님').join(', '));
      default: return null;
    }
  }

  /** 펼친 '최근 일': 새것부터 12줄 @param {any} ctx @param {() => void} close @returns {HTMLElement[]} */
  function logZoom(ctx, close) {
    const { inst } = ctx;
    const lines = [];
    for (let i = inst.log.length - 1; i >= 0 && lines.length < 12; i--) {
      const el = logLine(ctx, inst.log[i]);
      if (el) lines.push(el);
    }
    return [
      h('button.zb-log__head', { type: 'button', test: 'sheet-close', 'aria-label': '최근 일, 누르면 닫힘', onclick: close }, '최근 일'),
      h('div.zb-log', { test: 'log' }, lines.length ? lines : h('div.zb-log__line.zb-log__soft', null, '아직 아무 일도 없습니다')),
    ];
  }

  /**
   * 메달 하나. 스킨에 메달이 없으면(아직 만드는 중) 임시 스킨(wire)의 메달을 빌려 쓴다.
   * @param {V2Skin} skin @param {{name:string, score:number, cards:number, shared:boolean, px:number}} o @returns {HTMLElement}
   */
  function medalOf(skin, o) {
    if (typeof skin.medal === 'function') return skin.medal(o);
    const wire = Zap.skins && Zap.skins.wire;
    if (wire && typeof wire.medal === 'function') return h('span.skin-wire.zb-medal-fallback', null, wire.medal(o));
    return h('span.zb-medal-plain', { style: { '--px': o.px + 'px' } }, h('b', null, String(o.score)), h('span', null, o.name));
  }

  /**
   * 판 끝: 가운데에 승자 메달(공동 승리면 나란히), 그 아래 순위표. 내려앉는 움직임은 motion.resultDrop 이 맡고,
   * 여기서는 멈춘 모습만 그린다(같은 결과면 같은 요소를 다시 써서 움직임이 끊기지 않게 한다).
   * @param {any} ctx @returns {HTMLElement}
   */
  function resultEl(ctx) {
    const { v, o, ui, inst, skin, Z, you } = ctx;
    const rows = standingsOf(v);
    const winners = /** @type {number[]} */ (v.winners || []);
    const n = Math.max(1, winners.length);
    const W = Z.W || 390; const H = Z.H || 844;
    const medalPx = Math.round(Z.wide
      ? clamp(90, Math.min(H * 0.2, (W * 0.62 / n) * 0.62), 210)
      : clamp(64, Math.min(H * 0.17, (W * 0.9 / n) * 0.62), 170));
    const px = Math.round(clamp(26, Z.u * 2.6, 50));
    const canNew = !!(o.on && o.on.newGame);
    const leader = o.leader !== undefined && o.leader !== null ? o.leader : null;
    // 새 판은 방장(또는 서버)만 연다: 그 단추가 없는 사람에게는 누구를 기다리는지 한 줄
    const waitLine = !canNew && leader !== null && leader !== you ? (o.names[leader] || '방장') + '님(방장)이 새 판을 시작하기를 기다리는 중' : '';
    // 모두 행동할 수 없어 끝난 판(규칙이 view.endReason 을 줄 때만)
    const deadlock = /** @type {any} */ (v).endReason === 'deadlock';
    const sig = JSON.stringify([rows, winners, o.names, you, medalPx, px, canNew, waitLine, deadlock, inst.skinId]);
    inst.resultShown = true;
    return inst.part('result', sig, () => h('div.zb-veil.zb-veil--result', { test: 'result-overlay', 'data-winners': winners.join(',') },
      h('div.zb-result', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '판 결과' },
        h('div.zb-result__medals', { test: 'result-medals', style: { '--medal-px': medalPx + 'px' } },
          h('span.zb-result__halo', { 'aria-hidden': 'true' }),
          winners.map((seat) => {
            const p = v.players[seat];
            return h('div.zb-result__medal', { test: 'medal-' + seat, 'data-seat': String(seat), 'aria-label': o.names[seat] + ' 승리, ' + p.score + '점' },
              medalOf(skin, { name: o.names[seat] || '', score: p.score, cards: p.cards.length, shared: winners.length > 1, px: medalPx }));
          })),
        h('div.zb-result__board', { test: 'result' },
          deadlock ? h('div.zb-result__why', { test: 'result-deadlock' }, '모두 행동할 수 없어 판을 마쳤습니다') : null,
          h('div.zb-result__rows', { test: 'result-table' }, rows.map((r) => h('div.zb-result__row', {
            test: 'result-row-' + r.seat, 'data-seat': String(r.seat), 'data-rank': String(r.rank), 'data-winner': String(winners.indexOf(r.seat) >= 0),
            class: cls({ 'is-winner': winners.indexOf(r.seat) >= 0, 'is-me': r.seat === you }),
          },
            h('span.zb-result__rank', null, String(r.rank)),
            h('span.zb-result__name', null, o.names[r.seat]),
            h('span.zb-result__meta', { 'aria-label': '산 카드 ' + r.cards + '장' }, h('i.zb-result__cardicon'), String(r.cards)),
            h('span.zb-result__meta', { 'aria-label': '귀족 ' + r.nobles + '장', class: cls({ 'is-zero': r.nobles === 0 }) }, h('i.zb-result__nobleicon'), String(r.nobles)),
            h('span.zb-result__pts', null, skin.pointsBadge(r.score, px))))),
          waitLine ? h('div.zb-result__wait', { test: 'waiting-leader' }, waitLine) : null,
          h('div.zb-sheet__actions', null,
            canNew ? h('button.zb-btn.zb-btn--go', { test: 'new-game', type: 'button', onclick: () => { const x = inst.opts; if (x.on && x.on.newGame) x.on.newGame(); } }, '새 판') : null,
            h('button.zb-btn', { test: 'result-close', type: 'button', onclick: () => { inst.ui.resultHidden = true; inst.paint(); } }, '판 보기'))))));
  }

  /**
   * 판을 그리거나 고친다.
   * @param {HTMLElement} container  크기가 정해진 틀(폭·높이). 판은 이 틀을 꽉 채운다
   * @param {PlayerView} view
   * @param {V2Options} opts
   * @returns {BoardInst}
   */
  function render(container, view, opts) {
    let inst = INST.get(container);
    if (!inst) { inst = new BoardInst(container); INST.set(container, inst); }
    inst.update(view, opts);
    return inst;
  }

  /**
   * 서버가 수를 거절했을 때: 오류 문구를 판 위 짧은 알림으로 띄우고, 보낸 수 때문에 잠긴 조작(ui.pending)을 푼다.
   * (새 화면 정보가 오면 그때도 풀린다.) 판이 없으면 아무 일도 하지 않는다.
   * @param {HTMLElement} container @param {string} msg
   */
  function notify(container, msg) {
    const inst = INST.get(container);
    if (!inst || !inst.view) return;
    inst.ui.pending = false;
    inst.toast(msg, true);
  }

  /** 판 끝 메달이 내려앉는 움직임과 소리를 다시 재생한다(결과 덮개가 떠 있을 때) @param {HTMLElement} container */
  function replayResult(container) {
    const inst = INST.get(container);
    if (!inst || !inst.view || inst.view.phase !== 'over') return;
    inst.ui.resultHidden = false;
    inst.paint();
    if (Zap.v2.motion) Zap.v2.motion.resultDrop(inst, 0, true);
  }

  /** 판을 치운다(다른 장면으로 새로 시작할 때) @param {HTMLElement} container */
  function clear(container) {
    const inst = INST.get(container);
    if (!inst) return;
    if (inst.ro) inst.ro.disconnect();
    document.removeEventListener('keydown', inst.onKey);
    if (Zap.v2.motion) Zap.v2.motion.detach(inst);
    clearTimeout(inst.toastTimer);
    inst.frame.remove();
    LIVE.delete(inst);
    INST.delete(container);
  }

  Zap.v2.board = { render, notify, clear, replayResult, ensureFont, freshUI, indexLegal, takeMoveFor, toggleSel, noticeText, standingsOf, TOKEN_LIMIT };
})();
