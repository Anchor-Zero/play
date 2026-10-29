// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 실행부 (Zap.bots)
 *
 * docs/ai/framework.md(틀)를 그대로 옮긴 것이다. 전략·실수의 뜻은 틀이 정하고, 상대 하나의 성격은 값 파일
 * (game/src/bots/styles/*.js)이 Zap.bots.register 로 넘기는 순수 데이터가 정한다. 이 파일은 그 데이터를 읽어 수를 고른다.
 *
 * 공개 형식(docs/ai/code-notes.md 4절, 담당 사이의 약속):
 *   Zap.bots.styles                         // Array<{id, label, level:'beginner', desc}> 등록 순서대로 (desc: 값 파일의 한 줄 설명, 없으면 '')
 *   Zap.bots.register(def)                  // 스타일 파일이 부른다. 틀 5.4 끝의 검사에 걸리면 등록하지 않고 Error 를 던진다.
 *                                           // 같은 id 를 다시 register 하면 그 자리를 바꾼다
 *   Zap.bots.attach(client, styleId, opts)  // → {stop()}. client 는 handle.clients[i] 하나만.
 *                                           // opts: {delayMs?: number (기본 900), seed?: number, log?: (rec) => void}
 *   log 는 분석 도구용 기록(틀 10절 끝)이다. 화면은 넘기지 않는다.
 *
 * 상대가 쓰는 것: client.view()·client.on('state'|'events'|'error'|'status')·client.move()·client.status(), Zap.data,
 * Zap.rules.rng. (허용된 규칙 함수 suggestPayment·isValidPayment·meetsNoble 도 필요가 없다: 지불은 legal 의 buy 에 든 제안을,
 * 받을 수 있는 귀족은 legal 의 claimNoble 을 읽는다.) GameState 를 쓰는 함수(legalMoves·applyMove·viewFor·createGame·
 * scoreOf·standings)와 handle·Zap.room 은 쓰지 않는다. 보내는 수는 언제나 그때의 view.legal 안의 객체다.
 *
 * 흐름: state 를 받을 때마다 기억을 갱신하고(D0, 틀 8절), 내 차례이고 둘 수가 있으면 delayMs 뒤 그때의 client.view() 를
 * 다시 읽어 결정 지점 하나(D1 행동·D2 반납·D3 귀족·D4 차례 넘기기, 틀 1절)를 지나 수 하나를 보낸다. 다음 수는 다음 state 에서.
 * 타이머는 늘 하나뿐이다. stop() 뒤나 client.status()==='closed' 면 아무것도 보내지 않는다. 누가 귀족을 받은 사건 뒤에는
 * 다음 수까지 2×delayMs 가 지나도록 기다린다(사람이 귀족을 받고 곧바로 넘겨도 귀족 움직임이 잘리지 않게).
 * 새 판(turnsTaken 이 줄거나 'over' 에서 풀림)이면 기억을 스스로 처음으로 돌린다. attach 는 판마다 다시 부르지 않아도 된다.
 * 거부(error)되면 같은 화면 정보의 legal 에서 거부된 수를 빼고 틀 1.4 의 대비 순서로 다시 고른다(상한 3). 그래도 안 되면
 * endTurn, 없으면 남은 legal 의 첫 수를 한 번 보내고 그 화면 정보에서는 더 보내지 않는다.
 * 무작위는 attach 마다 Zap.rules.rng(seed) 하나이고 틀 10절의 세 자리(규칙의 p, 굴림 실수, random 키)에서만 부른다.
 */
(function () {
  'use strict';

  /* ───────────── 값 파일의 형식 (framework.md 5.4) ───────────── */

  /** @typedef {'t1'|'t2'|'t3'|'reserved'} BotSource */
  /** @typedef {'points'|'payment'|'printedCost'|'need'|'reach'|'bonusLow'|'watchedNoble'|'nobleColor'|'tierLow'|'lastTarget'|'hasPoints'|'reading'|'gaze'|'random'} BotKey */
  /** @typedef {'free'|'hasPoints'|'climbForEmpty'|'pileOk'} BotFilter */
  /** @typedef {{from:BotSource[], accept?:'ok'|'exempt'|'any', filter?:BotFilter[], window?:number, keys:BotKey[]}} BotStage */
  /** @typedef {{stages:BotStage[]}} BotPick */
  /** @typedef {{kind:'colorLead', lead:number, exemptFree:boolean} | {kind:'goldPay'}} BotAvoid */
  /** @typedef {{tokensMin?:number, tokensMax?:number, roomToTake?:boolean, supplyNoGems?:boolean, supplyGold?:boolean, finalRound?:boolean,
   *   swappedLastTurn?:boolean, afterReserve?:boolean, snatched?:boolean, reservedMax?:number, holdsGold?:boolean,
   *   bonusMin?:number, bonusMax?:number, litMin?:number}} BotCond */
  /** @typedef {{do:'buy'|'freeGrab'|'lastFlush'|'reserveOneShort'|'reserveWish'|'reserveForced'|'take', name?:string, when?:BotCond, p?:number,
   *   gate?:'always'|'noRoom', pick?:string, lift?:('colorLead'|'goldPay')[], target?:string, fallback?:'leftT1'|'any'|'none'}} BotActRule */
  /** @typedef {{name:string, when?:BotCond, target:string|null, pair:'none'|'needTwo'|'oneColor'|'toTen', fill:('pileHigh'|'heldLow')[]}} BotTakeMode */
  /** @typedef {{keepGold:boolean, protect:('targetMissing'|'targetCost'|'justTaken')[], order:('heldHigh'|'bonusHigh')[]}} BotReturn */
  /** @typedef {{look:('fanfareAny'|'fanfareOthers'|'finalTurn'|'milestone'|'watched'|'always')[], watchWithin?:number}} BotNoble */
  /** @typedef {{id:'nobleMiss'|'dropBonus'|'dropGold'|'firstGlance'|'rowSkip'|'pileUnder4Blocked', p:number, when?:BotCond,
   *   tiers?:Tier[], rows?:BotSource[], colorScope?:'wantedPair'|'any'}} BotMistake */
  /** @typedef {{swapFrom:number, swapStreakMax:number, noBuyStreakMax:number, longGameRounds:number, pick:string, target:string}} BotSafety */
  /** @typedef {{target:{bonus:boolean, gold:boolean}, held:{bonus:boolean}}} BotPerception */
  /**
   * @typedef {Object} BotStyle
   * @property {string} id
   * @property {string} label
   * @property {'beginner'} level
   * @property {string} [desc]   화면이 상대를 눌렀을 때 보이는 한 줄 설명(실행부는 쓰지 않음)
   * @property {string} [temper]
   * @property {string} [seatName]
   * @property {Record<string, 0|1|2|3>} [pulls]
   * @property {string[]} [shapes]
   * @property {Record<string, 'strategy'|'mistake'>} [roles]
   * @property {BotPerception} [perception]
   * @property {BotAvoid[]} [avoid]
   * @property {Record<string, BotPick>} [picks]
   * @property {Record<string, BotPick>} [targets]
   * @property {BotActRule[]} [act]
   * @property {BotTakeMode[]} [take]
   * @property {BotReturn} [ret]
   * @property {BotNoble} [noble]
   * @property {BotMistake[]} [mistakes]
   * @property {BotSafety} [safety]
   */

  /* ───────────── 실행부 안에서만 쓰는 형식 ───────────── */

  /** 고르기의 후보 하나. 살 카드(buy)면 move·payTotal·payGold 가 있다.
   * @typedef {{card:CardDef, source:BotSource, tier:Tier, slot:number, buy:boolean, move?:MoveBuy, payTotal?:number, payGold?:number}} BotCand */
  /** 고르기의 결과: 고른 후보, 그 단계, 승부를 가른 키
   * @typedef {{x:BotCand, stage:BotStage|null, decidedBy:string|null}} BotPicked */
  /** 분석 도구용 기록 한 줄
   * @typedef {{type:string, [k:string]:any}} BotLogRecord */

  /* ───────────── 고정 목록 (framework.md 5.3) ───────────── */

  const SOURCES = ['t1', 't2', 't3', 'reserved'];
  const KEYS = ['points', 'payment', 'printedCost', 'need', 'reach', 'bonusLow', 'watchedNoble', 'nobleColor', 'tierLow', 'lastTarget', 'hasPoints', 'reading', 'gaze', 'random'];
  const FILTERS = ['free', 'hasPoints', 'climbForEmpty', 'pileOk'];
  const ACCEPTS = ['ok', 'exempt', 'any'];
  const ACT_DO = ['buy', 'freeGrab', 'lastFlush', 'reserveOneShort', 'reserveWish', 'reserveForced', 'take'];
  const GATES = ['always', 'noRoom'];
  const LIFTS = ['colorLead', 'goldPay'];
  const FALLBACKS = ['leftT1', 'any', 'none'];
  const PAIRS = ['none', 'needTwo', 'oneColor', 'toTen'];
  const FILLS = ['pileHigh', 'heldLow'];
  const PROTECTS = ['targetMissing', 'targetCost', 'justTaken'];
  const ORDERS = ['heldHigh', 'bonusHigh'];
  const LOOKS = ['fanfareAny', 'fanfareOthers', 'finalTurn', 'milestone', 'watched', 'always'];
  const MISTAKE_IDS = ['nobleMiss', 'dropBonus', 'dropGold', 'firstGlance', 'rowSkip', 'pileUnder4Blocked'];
  const SCOPES = ['wantedPair', 'any'];
  const COND_NUM = ['tokensMin', 'tokensMax', 'reservedMax', 'bonusMin', 'bonusMax', 'litMin'];
  const COND_BOOL = ['roomToTake', 'supplyNoGems', 'supplyGold', 'finalRound', 'swappedLastTurn', 'afterReserve', 'snatched', 'holdsGold'];
  /** D3 에서 귀족 줄 전체를 보게 하는 계기 */
  const LOOK_ALL = ['fanfareAny', 'fanfareOthers', 'finalTurn', 'milestone', 'always'];
  const TOKEN_KEYS = ['w', 'u', 'g', 'r', 'k', 'gold'];

  const RETRY_LIMIT = 3;
  const DEFAULT_DELAY_MS = 900;
  /** 거부된 수 뒤 다시 고를 때의 쉼(거부된 수는 화면에 움직임이 없다) */
  const RETRY_DELAY_MS = 150;

  /** 빠진 필드의 기본값 (framework.md 5.5): 실수 없는, 눈앞 구매를 하는 평범한 상대 */
  const DEFAULTS = {
    temper: '',
    pulls: {},
    shapes: [],
    roles: {},
    perception: { target: { bonus: true, gold: true }, held: { bonus: false } },
    avoid: [],
    picks: { main: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], keys: ['points', 'payment'] }] } },
    targets: { main: { stages: [{ from: ['t1', 't2'], filter: ['pileOk'], keys: ['reach', 'points'] }] } },
    act: [{ do: 'buy', gate: 'always', pick: 'main' }, { do: 'reserveForced', when: { supplyNoGems: true }, target: 'main', fallback: 'any' }, { do: 'take' }],
    take: [{ name: '목표 집기', target: 'main', pair: 'needTwo', fill: ['heldLow'] }],
    ret: { keepGold: true, protect: ['targetMissing'], order: ['heldHigh'] },
    noble: { look: ['always'] },
    mistakes: [],
    safety: { swapFrom: 10, swapStreakMax: 3, noBuyStreakMax: 12, longGameRounds: 60, pick: 'main', target: 'main' },
  };

  /* ───────────── 작은 도구 ───────────── */

  /** @param {any} v */
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  /** @param {any} o */
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const k of Object.keys(o)) deepFreeze(o[k]);
    }
    return o;
  }
  /** @param {any} x */
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  /** @param {any} x */
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  /** @param {any} t @returns {number} 여섯 칸 합 */
  function tokSum(t) { let s = 0; for (const c of TOKEN_KEYS) s += t[c] || 0; return s; }

  /** 수의 내용 열쇠: 같은 내용의 수는 같은 열쇠(take3 의 색은 집합으로 맞댄다)
   * @param {Move} m @returns {string} */
  function moveKey(m) {
    const a = /** @type {any} */ (m);
    switch (a.type) {
      case 'take3': return 'take3:' + a.colors.slice().sort().join('');
      case 'take2': return 'take2:' + a.color;
      case 'reserve': return 'reserve:' + a.cardId;
      case 'reserveDeck': return 'reserveDeck:' + a.tier;
      case 'buy': return 'buy:' + a.cardId + ':' + TOKEN_KEYS.map(function (c) { return a.payment[c]; }).join(',');
      case 'return': return 'return:' + TOKEN_KEYS.map(function (c) { return a.tokens[c]; }).join(',');
      case 'claimNoble': return 'claimNoble:' + a.nobleId;
      default: return String(a.type);
    }
  }

  /** 문자열 열쇠 → 32비트 수 (기본 seed 용, FNV-1a) @param {string} s */
  function hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  /* ───────────── 값 파일 검사 (framework.md 5.4 끝) ───────────── */

  /** @param {any} w @param {string} at @param {string[]} errs */
  function checkCond(w, at, errs) {
    if (w === undefined) return;
    if (!isObj(w)) { errs.push(at + ': when 은 객체여야 합니다'); return; }
    for (const k of Object.keys(w)) {
      if (COND_NUM.indexOf(k) >= 0) { if (!isNum(w[k])) errs.push(at + '.when.' + k + ': 수여야 합니다'); }
      else if (COND_BOOL.indexOf(k) >= 0) { if (typeof w[k] !== 'boolean') errs.push(at + '.when.' + k + ': 참/거짓이어야 합니다'); }
      else errs.push(at + '.when: 모르는 조건 ' + k);
    }
  }

  /** @param {any} list @param {string[]} allowed @param {string} at @param {string[]} errs @param {boolean} [nonEmpty] */
  function checkList(list, allowed, at, errs, nonEmpty) {
    if (!Array.isArray(list)) { errs.push(at + ': 배열이어야 합니다'); return; }
    if (nonEmpty && !list.length) errs.push(at + ': 비어 있으면 안 됩니다');
    for (const x of list) if (allowed.indexOf(x) < 0) errs.push(at + ': 모르는 값 ' + JSON.stringify(x));
  }

  /** @param {any} picks @param {string} field @param {string[]} errs */
  function checkPicks(picks, field, errs) {
    if (!isObj(picks)) { errs.push(field + ': 객체여야 합니다'); return; }
    for (const name of Object.keys(picks)) {
      const spec = picks[name];
      const at = field + '.' + name;
      if (!isObj(spec) || !Array.isArray(spec.stages) || !spec.stages.length) { errs.push(at + ': {stages:[…]} 여야 합니다'); continue; }
      spec.stages.forEach(function (/** @type {any} */ st, /** @type {number} */ i) {
        const sat = at + '.stages[' + i + ']';
        if (!isObj(st)) { errs.push(sat + ': 객체여야 합니다'); return; }
        checkList(st.from, SOURCES, sat + '.from', errs, true);
        if (st.accept !== undefined && ACCEPTS.indexOf(st.accept) < 0) errs.push(sat + '.accept: 모르는 값 ' + st.accept);
        if (st.filter !== undefined) checkList(st.filter, FILTERS, sat + '.filter', errs);
        if (st.window !== undefined && !(isNum(st.window) && st.window >= 0)) errs.push(sat + '.window: 0 이상의 수여야 합니다');
        checkList(st.keys, KEYS, sat + '.keys', errs);
      });
    }
  }

  /** 기본값을 채운 사본을 검사한다. 잘못이 있으면 그 목록을 돌려준다.
   * @param {any} s @returns {string[]} */
  function validate(s) {
    /** @type {string[]} */
    const errs = [];
    if (typeof s.id !== 'string' || !s.id) errs.push('id: 빈 문자열이 아닌 문자열이어야 합니다');
    if (typeof s.label !== 'string' || !s.label) errs.push('label: 빈 문자열이 아닌 문자열이어야 합니다');
    if (s.level !== 'beginner') errs.push("level: 'beginner' 여야 합니다");
    if (typeof s.temper !== 'string') errs.push('temper: 문자열이어야 합니다');
    if (typeof s.seatName !== 'string' || s.seatName.length < 1 || s.seatName.length > 12) errs.push('seatName: 1~12자여야 합니다');
    if (!isObj(s.pulls)) errs.push('pulls: 객체여야 합니다');
    if (!Array.isArray(s.shapes)) errs.push('shapes: 배열이어야 합니다');
    if (!isObj(s.roles)) errs.push('roles: 객체여야 합니다');
    const pc = s.perception;
    if (!isObj(pc) || !isObj(pc.target) || !isObj(pc.held) || typeof pc.target.bonus !== 'boolean' || typeof pc.target.gold !== 'boolean' || typeof pc.held.bonus !== 'boolean') {
      errs.push('perception: {target:{bonus,gold}, held:{bonus}} (참/거짓) 여야 합니다');
    }
    if (!Array.isArray(s.avoid)) errs.push('avoid: 배열이어야 합니다');
    else s.avoid.forEach(function (/** @type {any} */ a, /** @type {number} */ i) {
      if (!isObj(a)) errs.push('avoid[' + i + ']: 객체여야 합니다');
      else if (a.kind === 'colorLead') { if (!isNum(a.lead) || typeof a.exemptFree !== 'boolean') errs.push('avoid[' + i + ']: colorLead 는 lead(수)·exemptFree(참/거짓)가 필요합니다'); }
      else if (a.kind !== 'goldPay') errs.push('avoid[' + i + '].kind: 모르는 값 ' + a.kind);
    });
    checkPicks(s.picks, 'picks', errs);
    checkPicks(s.targets, 'targets', errs);
    const picks = isObj(s.picks) ? s.picks : {};
    const targets = isObj(s.targets) ? s.targets : {};
    if (!Array.isArray(s.act)) errs.push('act: 배열이어야 합니다');
    else s.act.forEach(function (/** @type {any} */ r, /** @type {number} */ i) {
      const at = 'act[' + i + ']';
      if (!isObj(r)) { errs.push(at + ': 객체여야 합니다'); return; }
      if (ACT_DO.indexOf(r.do) < 0) errs.push(at + '.do: 모르는 값 ' + r.do);
      checkCond(r.when, at, errs);
      if (r.p !== undefined && !(isNum(r.p) && r.p >= 0 && r.p <= 1)) errs.push(at + '.p: 0~1 이어야 합니다');
      if (r.gate !== undefined && GATES.indexOf(r.gate) < 0) errs.push(at + '.gate: 모르는 값 ' + r.gate);
      if (r.lift !== undefined) checkList(r.lift, LIFTS, at + '.lift', errs);
      if (r.fallback !== undefined && FALLBACKS.indexOf(r.fallback) < 0) errs.push(at + '.fallback: 모르는 값 ' + r.fallback);
      if (r.do === 'buy' || r.do === 'freeGrab' || r.do === 'lastFlush') {
        if (typeof r.pick !== 'string' || !picks[r.pick]) errs.push(at + '.pick: picks 에 없는 이름 ' + r.pick);
      }
      if (r.do === 'reserveOneShort' || r.do === 'reserveWish' || r.do === 'reserveForced') {
        if (typeof r.target !== 'string' || !targets[r.target]) errs.push(at + '.target: targets 에 없는 이름 ' + r.target);
      }
    });
    if (!Array.isArray(s.take)) errs.push('take: 배열이어야 합니다');
    else s.take.forEach(function (/** @type {any} */ m, /** @type {number} */ i) {
      const at = 'take[' + i + ']';
      if (!isObj(m)) { errs.push(at + ': 객체여야 합니다'); return; }
      checkCond(m.when, at, errs);
      if (m.target !== null && (typeof m.target !== 'string' || !targets[m.target])) errs.push(at + '.target: targets 에 없는 이름 ' + m.target);
      if (PAIRS.indexOf(m.pair) < 0) errs.push(at + '.pair: 모르는 값 ' + m.pair);
      checkList(m.fill, FILLS, at + '.fill', errs);
    });
    const ret = s.ret;
    if (!isObj(ret) || typeof ret.keepGold !== 'boolean') errs.push('ret: {keepGold, protect, order} 여야 합니다');
    else { checkList(ret.protect, PROTECTS, 'ret.protect', errs); checkList(ret.order, ORDERS, 'ret.order', errs); }
    if (!isObj(s.noble)) errs.push('noble: 객체여야 합니다');
    else {
      checkList(s.noble.look, LOOKS, 'noble.look', errs);
      if (s.noble.watchWithin !== undefined && !isNum(s.noble.watchWithin)) errs.push('noble.watchWithin: 수여야 합니다');
    }
    if (!Array.isArray(s.mistakes)) errs.push('mistakes: 배열이어야 합니다');
    else s.mistakes.forEach(function (/** @type {any} */ m, /** @type {number} */ i) {
      const at = 'mistakes[' + i + ']';
      if (!isObj(m)) { errs.push(at + ': 객체여야 합니다'); return; }
      if (MISTAKE_IDS.indexOf(m.id) < 0) errs.push(at + '.id: 모르는 값 ' + m.id);
      if (!(isNum(m.p) && m.p >= 0 && m.p <= 1)) errs.push(at + '.p: 0~1 이어야 합니다');
      checkCond(m.when, at, errs);
      if (m.tiers !== undefined && !(Array.isArray(m.tiers) && m.tiers.every(function (/** @type {any} */ t) { return t === 1 || t === 2 || t === 3; }))) {
        errs.push(at + '.tiers: 1·2·3 의 배열이어야 합니다');
      }
      if (m.id === 'rowSkip') checkList(m.rows, SOURCES, at + '.rows', errs, true);
      else if (m.rows !== undefined) checkList(m.rows, SOURCES, at + '.rows', errs);
      if (m.colorScope !== undefined && SCOPES.indexOf(m.colorScope) < 0) errs.push(at + '.colorScope: 모르는 값 ' + m.colorScope);
    });
    const sf = s.safety;
    if (!isObj(sf)) errs.push('safety: 객체여야 합니다');
    else {
      for (const k of ['swapFrom', 'swapStreakMax', 'noBuyStreakMax', 'longGameRounds']) if (!isNum(sf[k])) errs.push('safety.' + k + ': 수여야 합니다');
      if (typeof sf.pick !== 'string' || !picks[sf.pick]) errs.push('safety.pick: picks 에 없는 이름 ' + sf.pick);
      if (typeof sf.target !== 'string' || !targets[sf.target]) errs.push('safety.target: targets 에 없는 이름 ' + sf.target);
    }
    return errs;
  }

  /* ───────────── 등록 ───────────── */

  /** @type {Array<{id:string, label:string, level:'beginner', desc:string}>} 화면이 보는 목록(등록 순서, 같은 배열을 제자리에서 고친다) */
  const styles = [];
  /** @type {Record<string, any>} id → 기본값을 채우고 얼린 정의 */
  const defs = {};
  let attachCount = 0;

  /** @param {BotStyle} def */
  function register(def) {
    if (!isObj(def)) throw new Error('Zap.bots.register: 스타일 정의는 객체여야 합니다');
    /** @type {any} */
    const s = clone(def);
    for (const k of Object.keys(DEFAULTS)) if (s[k] === undefined) s[k] = clone(/** @type {any} */ (DEFAULTS)[k]);
    if (s.seatName === undefined) s.seatName = s.label;
    const errs = validate(s);
    if (errs.length) throw new Error('Zap.bots.register(' + String(s.id) + '): ' + errs.join(' / '));
    defs[s.id] = deepFreeze(s);
    const info = { id: /** @type {string} */ (s.id), label: /** @type {string} */ (s.label), level: /** @type {'beginner'} */ ('beginner'), desc: typeof s.desc === 'string' ? s.desc : '' };
    for (let i = 0; i < styles.length; i++) {
      if (styles[i].id === s.id) { styles[i] = info; return; }
    }
    styles.push(info);
  }

  /* ───────────── 판단 (틀 1~10절) ───────────── */

  /**
   * 자리 하나의 머리: 기억(8절)과 결정(1절). 시간·연결과 무관한 순수 판단 부분.
   * @param {any} S 기본값을 채운 스타일 정의
   * @param {() => number} rng
   * @param {((rec:BotLogRecord) => void)|null} log
   */
  function makeBrain(S, rng, log) {
    const D = Zap.data;
    /** @type {Color[]} */
    const C = D.COLORS;

    /* ── 기억 (8절) ── */
    function fresh() {
      return {
        fanfare: { self: false, others: false },
        /** @type {{type:'take'|'buy'|'reserve'|'pass', tokensBefore:number, returned:number}|null} */
        lastAction: null,
        swapStreak: 0,
        noBuyStreak: 0,
        /** @type {string|null} */
        lastTargetId: null,
        lastTargetOnBoard: false,
        snatched: false,
        /** @type {string|null} */
        watched: null,
        /** @type {any} 이번 차례 기록 */
        turn: null,
      };
    }
    let mem = fresh();
    let seenTurns = -1;
    let sawOver = false;

    /* ── 기록 ── */
    /** @type {Array<{id:string, hit:boolean}>} 이번 결정에서 굴린 실수 */
    let rolls = [];
    /** @type {string[]} 이번 결정의 태그(겸용 항목·안전장치 등) */
    let tags = [];
    /** @param {BotLogRecord} rec */
    function emit(rec) { if (log) { try { log(rec); } catch (e) { /* 기록 실패는 판단에 영향 없음 */ } } }
    /** 겸용 항목 태그(3.3): 키:역할 @param {string} key */
    function roleTag(key) { tags.push(key + ':' + (S.roles[key] || 'none')); }

    /* ── 판·자리 읽기 (7절) ── */
    /** @param {string} id @returns {CardDef} */
    function cardOf(id) { return D.cardsById[id]; }
    /** @param {PlayerView} v */
    function meOf(v) { return v.players[/** @type {number} */ (v.you)]; }
    /** @param {PlayerView} v @returns {BotCand[]} 공개 줄의 카드(빈칸 제외) */
    function boardCards(v) {
      /** @type {BotCand[]} */
      const out = [];
      for (const t of [1, 2, 3]) {
        const row = v.market[/** @type {Tier} */ (t)];
        for (let i = 0; i < row.length; i++) {
          const id = row[i];
          if (id) out.push({ card: cardOf(id), source: /** @type {BotSource} */ ('t' + t), tier: /** @type {Tier} */ (t), slot: i, buy: false });
        }
      }
      return out;
    }
    /** @param {PlayerView} v @returns {BotCand[]} 내 예약 카드(앞면을 아는 것) */
    function myReserved(v) {
      /** @type {BotCand[]} */
      const out = [];
      const rs = meOf(v).reserved;
      for (let i = 0; i < rs.length; i++) {
        const r = /** @type {any} */ (rs[i]);
        if (r && typeof r.id === 'string' && cardOf(r.id)) { const c = cardOf(r.id); out.push({ card: c, source: 'reserved', tier: c.tier, slot: i, buy: false }); }
      }
      return out;
    }
    /** @param {PlayerView} v @param {string} id @returns {{source:BotSource, slot:number}} */
    function locOf(v, id) {
      for (const t of [1, 2, 3]) {
        const i = v.market[/** @type {Tier} */ (t)].indexOf(id);
        if (i >= 0) return { source: /** @type {BotSource} */ ('t' + t), slot: i };
      }
      const rs = meOf(v).reserved;
      for (let i = 0; i < rs.length; i++) if (/** @type {any} */ (rs[i]).id === id) return { source: 'reserved', slot: i };
      return { source: 'reserved', slot: rs.length };
    }
    /** 읽는 순서: 3단계 줄 → 2단계 → 1단계 → 예약 칸 @param {BotCand} x */
    function readIdx(x) { return x.source === 'reserved' ? 12 + x.slot : (3 - Number(x.source.charAt(1))) * 4 + x.slot; }
    /** 시선 순서: 1단계 줄 → 2단계 → 3단계 → 예약 칸 @param {BotCand} x */
    function gazeIdx(x) { return x.source === 'reserved' ? 12 + x.slot : (Number(x.source.charAt(1)) - 1) * 4 + x.slot; }
    /** @param {CardDef} card */
    function printedCost(card) { let s = 0; for (const c of C) s += card.cost[c]; return s; }
    /** @param {ColorCounts} b */
    function sum5(b) { let s = 0; for (const c of C) s += b[c]; return s; }
    /** @param {PlayerView} v @param {string} id */
    function onBoard(v, id) { for (const t of [1, 2, 3]) if (v.market[/** @type {Tier} */ (t)].indexOf(id) >= 0) return true; return false; }

    /* ── 문맥 (D1 시작의 판과 기억) ── */
    /** @param {PlayerView} v */
    function ctxOf(v) {
      const me = meOf(v);
      const legal = v.legal;
      const takes = legal.filter(function (m) { return m.type === 'take3' || m.type === 'take2'; });
      /** @type {BotCand[]} */
      const buys = [];
      for (const m of legal) {
        if (m.type !== 'buy') continue;
        const card = cardOf(m.cardId);
        const l = locOf(v, m.cardId);
        buys.push({ card, source: l.source, tier: card.tier, slot: l.slot, buy: true, move: m, payTotal: tokSum(m.payment), payGold: m.payment.gold });
      }
      const la = mem.lastAction;
      return {
        v, me, legal, buys,
        cards: boardCards(v).concat(myReserved(v)),
        tokenTotal: me.tokenTotal,
        bonusTotal: sum5(me.bonuses),
        roomToTake: takes.some(function (m) { return me.tokenTotal + (m.type === 'take3' ? m.colors.length : 2) <= 10; }),
        supplyNoGems: takes.length === 0,
        supplyGold: v.supply.gold > 0,
        finalRound: v.finalRoundBy !== null,
        swappedLastTurn: !!(la && la.type === 'take' && la.tokensBefore >= S.safety.swapFrom && la.returned > 0),
        afterReserve: !!(la && la.type === 'reserve'),
        snatched: mem.snatched,
        reservedCount: me.reserved.length,
        holdsGold: me.tokens.gold > 0,
        lit: buys.length,
      };
    }
    /** @typedef {ReturnType<typeof ctxOf>} Ctx */

    /** 조건 객체(4.2): 적힌 칸이 모두 맞아야 참 @param {BotCond|undefined} w @param {Ctx} ctx */
    function condHolds(w, ctx) {
      if (!w) return true;
      if (w.tokensMin !== undefined && !(ctx.tokenTotal >= w.tokensMin)) return false;
      if (w.tokensMax !== undefined && !(ctx.tokenTotal <= w.tokensMax)) return false;
      if (w.roomToTake !== undefined && ctx.roomToTake !== w.roomToTake) return false;
      if (w.supplyNoGems !== undefined && ctx.supplyNoGems !== w.supplyNoGems) return false;
      if (w.supplyGold !== undefined && ctx.supplyGold !== w.supplyGold) return false;
      if (w.finalRound !== undefined && ctx.finalRound !== w.finalRound) return false;
      if (w.swappedLastTurn !== undefined && ctx.swappedLastTurn !== w.swappedLastTurn) return false;
      if (w.afterReserve !== undefined && ctx.afterReserve !== w.afterReserve) return false;
      if (w.snatched !== undefined && ctx.snatched !== w.snatched) return false;
      if (w.holdsGold !== undefined && ctx.holdsGold !== w.holdsGold) return false;
      if (w.reservedMax !== undefined && !(ctx.reservedCount <= w.reservedMax)) return false;
      if (w.bonusMin !== undefined && !(ctx.bonusTotal >= w.bonusMin)) return false;
      if (w.bonusMax !== undefined && !(ctx.bonusTotal <= w.bonusMax)) return false;
      if (w.litMin !== undefined && !(ctx.lit >= w.litMin)) return false;
      return true;
    }

    /* ── 굴림 실수 (3.1) ── */
    /** 같은 id 가운데 when 이 맞는 첫 항목 @param {string} id @param {Ctx} ctx @returns {BotMistake|null} */
    function mistakeEntry(id, ctx) {
      for (const m of S.mistakes) if (m.id === id && condHolds(m.when, ctx)) return m;
      return null;
    }
    /** 굴린다(rng 를 부르는 자리 둘째). 맞는 항목이 없으면 굴리지 않고 거짓
     * @param {string} id @param {Ctx} ctx @param {BotMistake|null} [entry] */
    function roll(id, ctx, entry) {
      const e = entry || mistakeEntry(id, ctx);
      if (!e) return false;
      const hit = rng() < e.p;
      rolls.push({ id, hit });
      return hit;
    }

    /* ── 지각 셈 (7절 needOf) ── */
    /** @param {CardDef} card @param {Ctx} ctx @returns {{by:Record<string, number>, total:number, missing:Color[]}} */
    function needOf(card, ctx) {
      const T = mem.turn;
      const me = ctx.me;
      if (!T.percept) {
        // 이번 차례 처음 needOf 를 부를 때 한 번 굴린다 (dropBonus·dropGold)
        // 결과는 그 실수가 걸리는 단계 목록(항목의 tiers, 기본 전체). 틀 7절: 그 카드의 단계가 tiers 에 들 때만 덮는다
        T.percept = { bonus: null, gold: null };
        if (S.perception.target.bonus && ctx.bonusTotal > 0) {
          const e = mistakeEntry('dropBonus', ctx);
          if (e && roll('dropBonus', ctx, e)) T.percept.bonus = e.tiers || [1, 2, 3];
        }
        if (S.perception.target.gold && me.tokens.gold > 0) {
          const e = mistakeEntry('dropGold', ctx);
          if (e && roll('dropGold', ctx, e)) T.percept.gold = e.tiers || [1, 2, 3];
        }
      }
      if (T.needCache[card.id]) return T.needCache[card.id];
      const useBonus = S.perception.target.bonus && !(T.percept.bonus && T.percept.bonus.indexOf(card.tier) >= 0);
      const useGold = S.perception.target.gold && !(T.percept.gold && T.percept.gold.indexOf(card.tier) >= 0);
      /** @type {Record<string, number>} */
      const by = {};
      for (const c of C) by[c] = Math.max(0, card.cost[c] - (useBonus ? me.bonuses[c] : 0) - me.tokens[c]);
      let g = useGold ? me.tokens.gold : 0;
      while (g-- > 0) {
        /** @type {Color|null} */
        let best = null;
        for (const c of C) if (by[c] > 0 && (best === null || by[c] > by[best])) best = c;
        if (best === null) break;
        by[best]--;
      }
      const missing = C.filter(function (c) { return by[c] > 0; }).sort(function (a, b) { return by[b] - by[a] || C.indexOf(a) - C.indexOf(b); });
      let total = 0;
      for (const c of C) total += by[c];
      const r = { by, total, missing };
      T.needCache[card.id] = r;
      return r;
    }
    /** 한 번의 집기로 켜지는가 @param {{by:Record<string, number>, total:number, missing:Color[]}} N @param {TokenCounts} sup */
    function oneTake(N, sup) {
      if (N.total === 0) return true;
      if (N.missing.length <= 3 && N.missing.every(function (c) { return N.by[c] === 1 && sup[c] >= 1; })) return true;
      return N.missing.length === 1 && N.by[N.missing[0]] === 2 && sup[N.missing[0]] >= 4;
    }
    /** @param {PlayerPublicView} me @param {Color} c */
    function held(me, c) { return me.tokens[c] + (S.perception.held.bonus ? me.bonuses[c] : 0); }

    /* ── 기피 (5.2) ── */
    /** @param {BotCand} x @param {Ctx} ctx @param {string[]|'ALL'} lifted @returns {'ok'|'exempt'|'blocked'} */
    function avoidStatus(x, ctx, lifted) {
      let blocked = false;
      let exempt = false;
      for (const a of S.avoid) {
        if (lifted === 'ALL' || lifted.indexOf(a.kind) >= 0) continue;
        if (a.kind === 'colorLead') {
          const b = ctx.me.bonuses;
          let mn = Infinity;
          for (const c of C) if (b[c] < mn) mn = b[c];
          if (b[x.card.bonus] >= mn + a.lead) {
            if (a.exemptFree && x.buy && x.payTotal === 0) exempt = true; else blocked = true;
          }
        } else if (a.kind === 'goldPay') {
          if (x.buy && /** @type {number} */ (x.payGold) > 0) blocked = true;
        }
      }
      return blocked ? 'blocked' : exempt ? 'exempt' : 'ok';
    }
    /** @param {string} st @param {string} acc */
    function acceptOk(st, acc) { return acc === 'any' || st === acc; }

    /** 귀족 색(7절) @param {PlayerView} v @returns {Color[]} */
    function nobleColors(v) {
      /** @type {Record<string, number>} */
      const cnt = {};
      for (const c of C) cnt[c] = 0;
      for (const id of v.nobles) { const n = D.noblesById[id]; if (n) for (const c of C) if (n.require[c] > 0) cnt[c]++; }
      let mx = 0;
      for (const c of C) if (cnt[c] > mx) mx = cnt[c];
      return C.filter(function (c) { return mx > 0 && cnt[c] === mx; });
    }
    /** @param {Ctx} ctx @returns {Color[]} */
    function watchedColors(ctx) {
      if (!mem.watched || ctx.v.nobles.indexOf(mem.watched) < 0) return [];
      const n = D.noblesById[mem.watched];
      return C.filter(function (c) { return n.require[c] > ctx.me.bonuses[c]; });
    }

    /* ── 키와 정렬 (5.3) ── */
    /** @param {string} k @param {BotCand} x @param {Ctx} ctx @param {Map<BotCand, number>} rnd @returns {number} */
    function keyVal(k, x, ctx, rnd) {
      switch (k) {
        case 'points': return -x.card.points;
        case 'payment': return x.buy ? /** @type {number} */ (x.payTotal) : 99;
        case 'printedCost': return printedCost(x.card);
        case 'need': return needOf(x.card, ctx).total;
        case 'reach': { const N = needOf(x.card, ctx); return oneTake(N, ctx.v.supply) ? 0 : N.total; }
        case 'bonusLow': return ctx.me.bonuses[x.card.bonus];
        case 'watchedNoble': return watchedColors(ctx).indexOf(x.card.bonus) >= 0 ? 0 : 1;
        case 'nobleColor': return nobleColors(ctx.v).indexOf(x.card.bonus) >= 0 ? 0 : 1;
        case 'tierLow': return x.tier;
        case 'lastTarget': return x.card.id === mem.lastTargetId ? 0 : 1;
        case 'hasPoints': return x.card.points > 0 ? 0 : 1;
        case 'reading': return readIdx(x);
        case 'gaze': return gazeIdx(x);
        case 'random': return /** @type {number} */ (rnd.get(x));
      }
      throw new Error('bad key ' + k);
    }
    /** 키를 앞에서부터 비교하는 안정 정렬, 끝은 늘 reading. 첫째와 둘째를 가른 키도 돌려준다.
     * @param {BotCand[]} arr @param {string[]} keys @param {Ctx} ctx @returns {{list:BotCand[], decidedBy:string|null}} */
    function sortByKeys(arr, keys, ctx) {
      const ks = keys.concat(['reading']);
      /** @type {Map<BotCand, number>} */
      const rnd = new Map();
      if (ks.indexOf('random') >= 0) {
        // random 키: 고르기마다 후보에 읽는 순서대로 rng() 를 하나씩 (rng 를 부르는 자리 셋째)
        arr.slice().sort(function (a, b) { return readIdx(a) - readIdx(b); }).forEach(function (x) { rnd.set(x, rng()); });
      }
      const list = arr.slice().sort(function (a, b) {
        for (const k of ks) { const d = keyVal(k, a, ctx, rnd) - keyVal(k, b, ctx, rnd); if (d) return d; }
        return 0;
      });
      /** @type {string|null} */
      let decidedBy = null;
      if (list.length >= 2) {
        for (const k of ks) { if (keyVal(k, list[0], ctx, rnd) !== keyVal(k, list[1], ctx, rnd)) { decidedBy = k; break; } }
      }
      return { list, decidedBy };
    }
    /** @param {string} f @param {BotCand} x @param {Ctx} ctx */
    function filterOk(f, x, ctx) {
      switch (f) {
        case 'free': return x.buy && x.payTotal === 0;
        case 'hasPoints': return x.card.points > 0;
        case 'climbForEmpty':
          return x.tier !== 2 || (ctx.me.bonuses[x.card.bonus] === 0 && !ctx.v.market[1].some(function (id) { return !!id && cardOf(id).bonus === x.card.bonus; }));
        case 'pileOk': return needOf(x.card, ctx).missing.every(function (c) { return ctx.v.supply[c] > 0; });
      }
      throw new Error('bad filter ' + f);
    }

    /* ── 살 카드 고르기 (1.3 runBuyPick) ── */
    /** @param {BotPick} spec @param {BotCand[]} cands @param {string[]|'ALL'} lifted @param {'buy'|'free'|'flush'|'safety'} kind @param {Ctx} ctx
     * @returns {BotPicked|null} */
    function runBuyPick(spec, cands, lifted, kind, ctx) {
      /** @type {string[]} */
      let skip = [];
      if (kind === 'buy') {
        // 실수 rowSkip: rows 의 원천에 켜진 카드가 있고 그 원천이 원천 둘 이상인 단계에 들어 있을 때 한 번 굴린다
        const e = mistakeEntry('rowSkip', ctx);
        if (e && e.rows) {
          const rows = e.rows;
          const lit = rows.some(function (r) { return cands.some(function (x) { return x.source === r; }); });
          const inWide = spec.stages.some(function (st) { return st.from.length >= 2 && st.from.some(function (r) { return rows.indexOf(r) >= 0; }); });
          if (lit && inWide && roll('rowSkip', ctx, e)) skip = rows.slice();
        }
      }
      for (const st of spec.stages) {
        let from = st.from;
        if (from.length >= 2) from = from.filter(function (r) { return skip.indexOf(r) < 0; });
        let Sx = cands.filter(function (x) {
          return from.indexOf(x.source) >= 0
            && (st.filter || []).every(function (f) { return filterOk(f, x, ctx); })
            && acceptOk(avoidStatus(x, ctx, lifted), st.accept || 'ok');
        });
        if (!Sx.length) continue;
        if (st.window !== undefined) {
          let mn = Infinity;
          for (const x of Sx) if (/** @type {number} */ (x.payTotal) < mn) mn = /** @type {number} */ (x.payTotal);
          const w = /** @type {number} */ (st.window);
          Sx = Sx.filter(function (x) { return /** @type {number} */ (x.payTotal) <= mn + w; });
        }
        if (kind === 'buy' && Sx.length >= 2 && roll('firstGlance', ctx)) {
          // 실수 firstGlance: 시선 순서가 가장 앞인 켜진 카드를 산다
          const g = Sx.slice().sort(function (a, b) { return gazeIdx(a) - gazeIdx(b); })[0];
          return { x: g, stage: st, decidedBy: 'gaze' };
        }
        const r = sortByKeys(Sx, st.keys, ctx);
        return { x: r.list[0], stage: st, decidedBy: r.decidedBy };
      }
      return null;
    }

    /* ── 목표 고르기 (1.3 runTarget) ── */
    /** @param {BotPick} spec @param {Ctx} ctx @param {(x:BotCand) => boolean} [extra] @returns {BotCand|null} */
    function runTarget(spec, ctx, extra) {
      for (const st of spec.stages) {
        const Sx = ctx.cards.filter(function (x) {
          return st.from.indexOf(x.source) >= 0
            && (st.filter || []).every(function (f) { return filterOk(f, x, ctx); })
            && acceptOk(avoidStatus(x, ctx, []), st.accept || 'ok')
            && (extra ? extra(x) : true);
        });
        if (Sx.length) return sortByKeys(Sx, st.keys, ctx).list[0];
      }
      return null;
    }

    /* ── legal 에서 찾기 (7절) ── */
    /** @param {Ctx} ctx @param {string} id @returns {Move|null} */
    function legalReserve(ctx, id) { return ctx.legal.find(function (m) { return m.type === 'reserve' && m.cardId === id; }) || null; }
    /** @param {Ctx} ctx @param {Color} c @returns {Move|null} */
    function legalTake2(ctx, c) { return ctx.legal.find(function (m) { return m.type === 'take2' && m.color === c; }) || null; }
    /** take3 는 색 집합으로 맞댄다 @param {Ctx} ctx @param {Color[]} cols @returns {Move|null} */
    function legalTake3(ctx, cols) {
      return ctx.legal.find(function (m) {
        return m.type === 'take3' && m.colors.length === cols.length && cols.every(function (c) { return m.colors.indexOf(c) >= 0; });
      }) || null;
    }
    /** 예약의 대비 후보: 'leftT1' 이면 1단계 줄 왼쪽부터, 아니면(또는 1단계에 없으면) 읽는 순서. onlyT1 이면 1단계만.
     * @param {Ctx} ctx @param {'leftT1'|'any'} kind @param {boolean} [onlyT1] @returns {BotCand|null} */
    function reserveFallback(ctx, kind, onlyT1) {
      /** @type {BotCand[]} */
      const xs = [];
      for (const m of ctx.legal) {
        if (m.type !== 'reserve') continue;
        const card = cardOf(m.cardId);
        const l = locOf(ctx.v, m.cardId);
        xs.push({ card, source: l.source, tier: card.tier, slot: l.slot, buy: false });
      }
      if (!xs.length) return null;
      if (kind === 'leftT1') {
        const t1 = xs.filter(function (x) { return x.source === 't1'; }).sort(function (a, b) { return a.slot - b.slot; })[0];
        if (t1) return t1;
        if (onlyT1) return null;
      }
      return xs.sort(function (a, b) { return readIdx(a) - readIdx(b); })[0];
    }
    /** 예약이 실제로 나갈 때: 그 카드가 이번 차례의 목표(1.2 끝). 모자란 색은 반납 보호에 쓰일 때만 센다
     * @param {Ctx} ctx @param {BotCand} x */
    function setReserveTarget(ctx, x) {
      const T = mem.turn;
      T.target = x.card.id;
      T.targetOnBoard = x.source !== 'reserved';
      T.targetCard = x.card;
      T.missing = S.ret.protect.indexOf('targetMissing') >= 0 ? needOf(x.card, ctx).missing : [];
    }

    /* ── 보석 집기 (1.3 composeTake) ── */
    /** @param {Color[]} cols @param {string[]} fill @param {Ctx} ctx @returns {Color[]} */
    function fillOrder(cols, fill, ctx) {
      return cols.slice().sort(function (a, b) {
        for (const f of fill) {
          const d = f === 'pileHigh' ? ctx.v.supply[b] - ctx.v.supply[a] : held(ctx.me, a) - held(ctx.me, b);
          if (d) return d;
        }
        return C.indexOf(a) - C.indexOf(b);
      });
    }
    /** @param {BotTakeMode} mode @param {Ctx} ctx @returns {Move|null} */
    function composeTake(mode, ctx) {
      const T = mem.turn;
      const t = mode.target ? runTarget(S.targets[mode.target], ctx) : null;
      T.target = t ? t.card.id : null;
      T.targetOnBoard = !!(t && t.source !== 'reserved');
      T.targetCard = t ? t.card : null;
      const N = t ? needOf(t.card, ctx) : null;
      /** @type {Color[]} */
      const missing = N ? N.missing : [];
      T.missing = missing;
      /** @type {Color|null} */
      let wanted = null;
      if (N && mode.pair === 'needTwo' && missing.length === 1 && N.by[missing[0]] >= 2) wanted = missing[0];
      if (mode.pair === 'oneColor' && missing.length === 1) wanted = missing[0];
      if (wanted && legalTake2(ctx, wanted)) { T.taken = [wanted]; return legalTake2(ctx, wanted); }
      if (mode.pair === 'toTen' && ctx.tokenTotal === 8) {
        for (const c of fillOrder(C, mode.fill, ctx)) {
          const m2 = legalTake2(ctx, c);
          if (m2) { T.taken = [c]; return m2; }
        }
      }
      const avail = C.filter(function (c) { return ctx.v.supply[c] > 0; });
      if (!avail.length) return null;
      const want = Math.min(3, avail.length);
      /** @param {Color[]} low 착각으로 '못 집는다'고 보는 색 */
      const build = function (low) {
        const ch = missing.filter(function (c) { return avail.indexOf(c) >= 0 && low.indexOf(c) < 0; }).slice(0, 3);
        for (const c of fillOrder(avail.filter(function (c) { return low.indexOf(c) < 0 && ch.indexOf(c) < 0; }), mode.fill, ctx)) if (ch.length < want) ch.push(c);
        // 착각해도 규칙보다 적게 집지는 않는다
        for (const c of fillOrder(low.filter(function (c) { return ch.indexOf(c) < 0; }), mode.fill, ctx)) if (ch.length < want) ch.push(c);
        return ch;
      };
      let chosen = build([]);
      const e = mistakeEntry('pileUnder4Blocked', ctx);
      if (e) {
        /** @type {Color[]} */
        let low = [];
        if ((e.colorScope || 'any') === 'wantedPair') {
          if (wanted && ctx.v.supply[wanted] >= 1 && ctx.v.supply[wanted] <= 3) low = [wanted];
        } else {
          low = C.filter(function (c) { return ctx.v.supply[c] >= 1 && ctx.v.supply[c] <= 3; });
        }
        if (low.length && chosen.some(function (c) { return low.indexOf(c) >= 0; }) && roll('pileUnder4Blocked', ctx, e)) chosen = build(low);
      }
      T.taken = chosen;
      return legalTake3(ctx, chosen);
    }

    /* ── 행동 규칙 (1.2 runRule) ── */
    /** 산 카드의 겸용 태그(3.3) @param {BotPicked} p */
    function buyTags(p) {
      if (p.stage && p.stage.accept === 'exempt') roleTag('freeGrab');
      if (p.x.card.points === 0) {
        roleTag('cheapLoop');
        if (/** @type {number} */ (p.x.payTotal) >= 5) roleTag('lowValueBuy');
      }
      if (p.decidedBy === 'printedCost') roleTag('printedCost');
    }
    /** @param {BotActRule} rule @param {Ctx} ctx @returns {Move|null} */
    function runRule(rule, ctx) {
      switch (rule.do) {
        case 'buy': {
          if (rule.gate === 'noRoom' && ctx.roomToTake) return null;
          const p = runBuyPick(S.picks[/** @type {string} */ (rule.pick)], ctx.buys, rule.lift || [], 'buy', ctx);
          if (!p) return null;
          buyTags(p);
          return /** @type {Move} */ (p.x.move);
        }
        case 'freeGrab': {
          const cands = ctx.buys.filter(function (b) { return b.payTotal === 0; });
          const p = runBuyPick(S.picks[/** @type {string} */ (rule.pick)], cands, rule.lift || [], 'free', ctx);
          if (!p) return null;
          roleTag('freeGrab');
          buyTags(p);
          return /** @type {Move} */ (p.x.move);
        }
        case 'lastFlush': {
          const cands = ctx.buys.filter(function (b) { return b.card.points > 0; });
          const p = runBuyPick(S.picks[/** @type {string} */ (rule.pick)], cands, 'ALL', 'flush', ctx);
          if (!p) return null;
          buyTags(p);
          return /** @type {Move} */ (p.x.move);
        }
        case 'reserveOneShort': {
          const t = runTarget(S.targets[/** @type {string} */ (rule.target)], ctx, function (x) { return x.source !== 'reserved' && needOf(x.card, ctx).total === 1; });
          const m = t ? legalReserve(ctx, t.card.id) : null;
          if (m && t) setReserveTarget(ctx, t);
          return m;
        }
        case 'reserveWish': {
          const t = runTarget(S.targets[/** @type {string} */ (rule.target)], ctx);
          const m = t && t.source !== 'reserved' ? legalReserve(ctx, t.card.id) : null;
          if (m && t) setReserveTarget(ctx, t);
          return m;
        }
        case 'reserveForced': {
          const t = runTarget(S.targets[/** @type {string} */ (rule.target)], ctx);
          let m = t && t.source !== 'reserved' ? legalReserve(ctx, t.card.id) : null;
          if (m && t) setReserveTarget(ctx, t);
          if (!m && (rule.fallback === 'leftT1' || rule.fallback === 'any')) {
            const f = reserveFallback(ctx, rule.fallback);
            if (f) { m = legalReserve(ctx, f.card.id); if (m) setReserveTarget(ctx, f); }
          }
          return m;
        }
        case 'take': {
          for (const mode of S.take) {
            if (!condHolds(mode.when, ctx)) continue;
            const m = composeTake(mode, ctx);
            if (m) return m;
          }
          return null;
        }
      }
      return null;
    }

    /** 마지막 대비 (1.4): take3 → take2 → buy → reserve → reserveDeck. refused 의 수는 뺀다
     * @param {Move[]} legal @param {string[]} [refused] @returns {Move|null} */
    function fallbackAction(legal, refused) {
      const ok = function (/** @type {Move} */ m) { return !refused || refused.indexOf(moveKey(m)) < 0; };
      for (const t of ['take3', 'take2', 'buy', 'reserve', 'reserveDeck']) {
        const m = legal.find(function (x) { return x.type === t && ok(x); });
        if (m) return m;
      }
      return null;
    }

    /** 끊기의 구매 부분 (9절 S1·S2): 기피를 모두 풀고 문턱을 무시하며 굴림 실수를 쓰지 않는다 @param {Ctx} ctx */
    function breakBuy(ctx) {
      const p = runBuyPick(S.picks[S.safety.pick], ctx.buys, 'ALL', 'safety', ctx);
      if (!p) return null;
      buyTags(p);
      return /** @type {Move} */ (p.x.move);
    }

    /* ── D1 행동 (1.2 decideAction + 9절) ── */
    /** @param {PlayerView} v @returns {{move:Move|null, rule:BotActRule|null, via:string|null}} */
    function decideAction(v) {
      const ctx = ctxOf(v);
      const T = mem.turn;
      // S3 긴 판: 모든 기피를 풀고 점수 있는 카드 중 점수 큰 것(같으면 지불 적은 것)
      if (v.turnsTaken >= S.safety.longGameRounds * v.numPlayers) {
        const xs = ctx.buys.filter(function (b) { return b.card.points > 0; });
        if (xs.length) {
          const x = sortByKeys(xs, ['points', 'payment'], ctx).list[0];
          tags.push('S3');
          buyTags({ x, stage: null, decidedBy: null });
          return { move: /** @type {Move} */ (x.move), rule: null, via: 'S3' };
        }
      }
      /** @type {Move|null} */
      let m = null;
      /** @type {BotActRule|null} */
      let used = null;
      /** @type {string|null} */
      let via = null;
      for (const rule of S.act) {
        if (!condHolds(rule.when, ctx)) continue;
        if (rule.p !== undefined && rule.p < 1 && rng() >= rule.p) continue; // rng 를 부르는 자리 첫째
        m = runRule(rule, ctx);
        if (m) { used = rule; T.rule = rule; break; }
      }
      if (!m) { m = fallbackAction(ctx.legal); via = 'fallback'; tags.push('fallback'); }
      if (!m) return { move: null, rule: null, via };
      // S1 바꿔 집기 연속 상한
      if ((m.type === 'take3' || m.type === 'take2') && ctx.tokenTotal >= S.safety.swapFrom && mem.swapStreak >= S.safety.swapStreakMax) {
        /** @type {Move|null} */
        let b = breakBuy(ctx);
        if (!b) {
          const t = runTarget(S.targets[S.safety.target], ctx);
          if (t && t.source !== 'reserved') { b = legalReserve(ctx, t.card.id); if (b) setReserveTarget(ctx, t); }
          if (!b) {
            const f = reserveFallback(ctx, 'leftT1', true);
            if (f) { b = legalReserve(ctx, f.card.id); if (b) setReserveTarget(ctx, f); }
          }
        }
        if (b) { m = b; via = 'S1'; tags.push('S1'); }
      }
      // S2 오래 사지 않음
      if (m.type !== 'buy' && mem.noBuyStreak >= S.safety.noBuyStreakMax) {
        const b = breakBuy(ctx);
        if (b) { m = b; via = 'S2'; tags.push('S2'); }
      }
      if (m.type === 'buy' || m.type === 'reserve' || m.type === 'reserveDeck') T.taken = [];
      return { move: m, rule: used, via };
    }

    /* ── D2 반납 (1.5) ── */
    /** @param {PlayerView} v @returns {Move|null} */
    function decideReturn(v) {
      const me = meOf(v);
      const T = mem.turn;
      const n = me.tokenTotal - 10;
      /** @type {Record<string, number>} */
      const level = { gold: S.ret.keepGold ? Infinity : 0 };
      for (const c of C) level[c] = 0;
      S.ret.protect.forEach(function (/** @type {string} */ kind, /** @type {number} */ i) {
        /** @type {Color[]} */
        let set = [];
        if (kind === 'targetMissing') set = T.missing || [];
        else if (kind === 'justTaken') set = T.taken || [];
        else if (kind === 'targetCost' && T.targetCard) {
          const card = /** @type {CardDef} */ (T.targetCard);
          set = C.filter(function (c) { return card.cost[c] - (S.perception.target.bonus ? me.bonuses[c] : 0) > 0; });
        }
        for (const c of set) level[c] = Math.max(level[c], S.ret.protect.length - i);
      });
      /** @type {Record<string, number>} */
      const counts = {};
      /** @type {Record<string, number>} */
      const out = {};
      for (const c of TOKEN_KEYS) { counts[c] = /** @type {any} */ (me.tokens)[c]; out[c] = 0; }
      /** @param {string} c */
      const heldNow = function (c) { return counts[c] + (c !== 'gold' && S.perception.held.bonus ? /** @type {any} */ (me.bonuses)[c] : 0); };
      /** @param {string} c */
      const bonusOf = function (c) { return c === 'gold' ? 0 : /** @type {any} */ (me.bonuses)[c]; };
      for (let i = 0; i < n; i++) {
        const cands = TOKEN_KEYS.filter(function (c) { return counts[c] > 0; }).sort(function (a, b) {
          if (level[a] !== level[b]) return level[a] < level[b] ? -1 : 1;
          for (const o of S.ret.order) {
            const d = o === 'heldHigh' ? heldNow(b) - heldNow(a) : bonusOf(b) - bonusOf(a);
            if (d) return d;
          }
          return TOKEN_KEYS.indexOf(a) - TOKEN_KEYS.indexOf(b); // 색 순서, 황금은 맨 뒤
        });
        if (!cands.length) break;
        counts[cands[0]]--;
        out[cands[0]]++;
      }
      const m = v.legal.find(function (x) { return x.type === 'return' && TOKEN_KEYS.every(function (c) { return /** @type {any} */ (x.tokens)[c] === out[c]; }); });
      if (m) return m;
      tags.push('returnNoMatch');
      return v.legal.find(function (x) { return x.type === 'return'; }) || null;
    }

    /* ── D3 귀족 · D4 차례 넘기기 (1.6) ── */
    /** @param {PlayerView} v @returns {{move:Move|null, point:'D3'|'D4'}} */
    function decideEnd(v) {
      const T = mem.turn;
      const endTurn = v.legal.find(function (m) { return m.type === 'endTurn'; }) || null;
      if (T.nobleDone) return { move: endTurn, point: 'D4' };
      T.nobleDone = true;
      const ctx = ctxOf(v);
      const me = ctx.me;
      const claim = v.legal.filter(function (m) { return m.type === 'claimNoble'; })
        .sort(function (a, b) { return v.nobles.indexOf(/** @type {MoveClaimNoble} */ (a).nobleId) - v.nobles.indexOf(/** @type {MoveClaimNoble} */ (b).nobleId); });
      const L = S.noble.look;
      const bought = !!T.bought;
      /** @type {string[]} */
      const fired = [];
      if (L.indexOf('fanfareAny') >= 0 && (T.fanfare.self || T.fanfare.others)) fired.push('fanfareAny');
      if (L.indexOf('fanfareOthers') >= 0 && T.fanfare.others) fired.push('fanfareOthers');
      if (L.indexOf('finalTurn') >= 0 && v.finalRoundBy !== null) fired.push('finalTurn');
      if (L.indexOf('always') >= 0) fired.push('always');
      if (L.indexOf('milestone') >= 0 && bought) {
        const a = me.bonuses;
        const b = T.bonusesAtStart;
        const col = cardOf(T.bought).bonus;
        let mn = Infinity;
        for (const c of C) if (a[c] < mn) mn = a[c];
        const allEq = C.every(function (c) { return a[c] === a.w; }) && a.w >= 1;
        if (allEq || (b[col] === 0 && mn >= 1)) fired.push('milestone');
      }
      if (L.indexOf('watched') >= 0 && bought && mem.watched && v.nobles.indexOf(mem.watched) >= 0) fired.push('watched');
      for (const f of fired) tags.push('look:' + f);
      if (fired.some(function (f) { return LOOK_ALL.indexOf(f) >= 0; })) {
        const pick = /** @type {MoveClaimNoble|undefined} */ (claim[0]);
        if (fired.indexOf('milestone') >= 0 && S.noble.watchWithin !== undefined) {
          const within = /** @type {number} */ (S.noble.watchWithin);
          const rest = v.nobles.filter(function (id) { return !pick || id !== pick.nobleId; }).map(function (id) {
            const nb = D.noblesById[id];
            let short = 0;
            for (const c of C) short += Math.max(0, nb.require[c] - me.bonuses[c]);
            return { id, short, idx: v.nobles.indexOf(id) };
          }).filter(function (x) { return x.short <= within; }).sort(function (a, b) { return a.short - b.short || a.idx - b.idx; });
          mem.watched = rest.length ? rest[0].id : null;
        }
        if (pick) { tags.push('noble:look'); return { move: pick, point: 'D3' }; }
        return { move: endTurn, point: 'D3' };
      }
      if (fired.indexOf('watched') >= 0) {
        const w = claim.find(function (m) { return /** @type {MoveClaimNoble} */ (m).nobleId === mem.watched; });
        if (w) { mem.watched = null; tags.push('noble:watched'); return { move: w, point: 'D3' }; }
      }
      if (claim.length) {
        if (!roll('nobleMiss', ctx)) { tags.push('noble:chance'); return { move: claim[0], point: 'D3' }; }
        tags.push('noble:missed');
      }
      return { move: endTurn, point: 'D3' };
    }

    /* ── D0 기억 갱신 ── */
    /** 내 차례의 시작: current===you 인 state 의 turnsTaken 이 turn.id 와 다를 때 @param {PlayerView} v */
    function startTurnIfNeeded(v) {
      if (mem.turn && mem.turn.id === v.turnsTaken) return;
      const me = meOf(v);
      if (mem.lastTargetOnBoard && mem.lastTargetId) {
        const id = mem.lastTargetId;
        const mine = me.cards.indexOf(id) >= 0 || me.reserved.some(function (r) { return /** @type {any} */ (r).id === id; });
        if (!onBoard(v, id) && !mine) {
          if (!mem.snatched) emit({ type: 'snatched', turn: v.turnsTaken, cardId: id });
          mem.snatched = true;
        }
      }
      if (mem.watched && v.nobles.indexOf(mem.watched) < 0) mem.watched = null;
      mem.turn = {
        id: v.turnsTaken, tokensBefore: me.tokenTotal, bonusesAtStart: Object.assign({}, me.bonuses), fanfare: mem.fanfare,
        target: null, targetOnBoard: false, targetCard: null, missing: [], taken: [], takenEv: null, bought: null, reservedAct: false,
        returned: 0, percept: null, needCache: {}, nobleDone: false, rule: null,
      };
      mem.fanfare = { self: false, others: false };
    }

    /** state 를 받을 때마다: 새 판이면 기억을 처음으로, 내 차례의 시작이면 차례 기록을 새로 @param {PlayerView|null} v */
    function observeState(v) {
      if (!v) return;
      if ((seenTurns >= 0 && v.turnsTaken < seenTurns) || (sawOver && v.phase !== 'over')) {
        mem = fresh();
        emit({ type: 'newGame' });
      }
      seenTurns = v.turnsTaken;
      sawOver = v.phase === 'over';
      if (v.phase !== 'over' && v.you !== null && v.current === v.you) startTurnIfNeeded(v);
    }

    /** 내 차례 마감 (내 자리의 endTurn 사건) */
    function finishTurn() {
      const T = mem.turn;
      /** @type {'take'|'buy'|'reserve'|'pass'} */
      const type = T.bought ? 'buy' : T.reservedAct ? 'reserve' : T.takenEv ? 'take' : 'pass';
      mem.lastAction = { type, tokensBefore: T.tokensBefore, returned: T.returned };
      const swapped = type === 'take' && T.tokensBefore >= S.safety.swapFrom && T.returned > 0;
      tags = [];
      if (swapped) roleTag(mem.swapStreak ? 'swapRepeat' : 'swapTake');
      mem.swapStreak = swapped ? mem.swapStreak + 1 : 0;
      mem.noBuyStreak = T.bought ? 0 : mem.noBuyStreak + 1;
      mem.lastTargetId = T.bought ? null : T.target;
      mem.lastTargetOnBoard = !!(mem.lastTargetId && T.targetOnBoard);
      emit({ type: 'turnEnd', turn: T.id, action: type, tokensBefore: T.tokensBefore, returned: T.returned, swapped,
        swapStreak: mem.swapStreak, noBuyStreak: mem.noBuyStreak, rule: T.rule ? (T.rule.name || T.rule.do) : null, tags: tags.slice() });
      tags = [];
    }

    /** events 를 받을 때마다 (state 보다 먼저 온다) @param {GameEvent[]} evs @param {number|null} you */
    function observeEvents(evs, you) {
      if (!Array.isArray(evs) || you === null) return;
      for (const ev of evs) {
        const e = /** @type {any} */ (ev);
        if (e.type === 'noble') { if (e.seat === you) mem.fanfare.self = true; else mem.fanfare.others = true; }
        if (e.seat !== you || !mem.turn) continue;
        const T = mem.turn;
        if (e.type === 'take') { T.takenEv = C.filter(function (c) { return e.tokens[c] > 0; }); T.taken = T.takenEv.slice(); }
        else if (e.type === 'buy') T.bought = e.cardId;
        else if (e.type === 'reserve') T.reservedAct = true;
        else if (e.type === 'return') T.returned += tokSum(e.tokens);
        else if (e.type === 'endTurn') finishTurn();
      }
    }

    /** 지금 화면 정보에서 둘 수 하나 @param {PlayerView} v @returns {Move|null} */
    function decide(v) {
      rolls = [];
      tags = [];
      startTurnIfNeeded(v);
      /** @type {Move|null} */
      let move = null;
      /** @type {BotLogRecord} */
      const rec = { type: 'decision', turn: v.turnsTaken, phase: v.phase };
      if (v.phase === 'action') {
        const r = decideAction(v);
        move = r.move;
        rec.point = 'D1';
        if (r.rule) { rec.rule = r.rule.name || r.rule.do; rec.do = r.rule.do; }
        if (r.via) rec.via = r.via;
        rec.target = mem.turn.target;
      } else if (v.phase === 'return') {
        move = decideReturn(v);
        rec.point = 'D2';
      } else if (v.phase === 'end') {
        const r = decideEnd(v);
        move = r.move;
        rec.point = r.point;
      }
      rec.move = move;
      rec.rolls = rolls;
      rec.tags = tags;
      if (log) emit(rec);
      rolls = [];
      tags = [];
      return move;
    }

    /** 거부 뒤 다시 고르기(9절 오류): D1 을 다시 돌리지 않고, 거부된 수를 뺀 legal 에서 단계별 대비 순서로
     * @param {PlayerView} v @param {string[]} refused @param {boolean} last 상한을 넘겼으면 endTurn, 없으면 남은 첫 수
     * @returns {Move|null} */
    function retry(v, refused, last) {
      const ok = function (/** @type {Move} */ m) { return refused.indexOf(moveKey(m)) < 0; };
      if (last) return v.legal.find(function (m) { return m.type === 'endTurn' && ok(m); }) || v.legal.find(ok) || null;
      if (v.phase === 'action') return fallbackAction(v.legal, refused);
      if (v.phase === 'return') return v.legal.find(function (m) { return m.type === 'return' && ok(m); }) || null;
      return v.legal.find(function (m) { return m.type === 'endTurn' && ok(m); }) || v.legal.find(ok) || null;
    }

    return {
      observeState, observeEvents, decide, retry,
      /** 시험용: 지금 기억(읽기만) */
      memory: function () { return mem; },
      /** 마지막 대비 순서의 첫 수(판단 중 예외가 났을 때) @param {PlayerView} v */
      emergency: function (v) {
        if (v.phase === 'action') return fallbackAction(v.legal);
        return retry(v, [], false);
      },
      emit,
    };
  }

  /* ───────────── 연결에 붙이기 ───────────── */

  /**
   * @param {ClientConnection} client  자리 하나의 연결 (handle.clients[i])
   * @param {string} styleId
   * @param {{delayMs?:number, seed?:number, log?:(rec:BotLogRecord) => void}} [opts]
   * @returns {{stop:() => void}}
   */
  function attach(client, styleId, opts) {
    const S = defs[styleId];
    if (!S) throw new Error('Zap.bots.attach: 등록되지 않은 스타일 ' + String(styleId));
    if (!client || typeof client.on !== 'function' || typeof client.move !== 'function' || typeof client.view !== 'function' || typeof client.status !== 'function') {
      throw new Error('Zap.bots.attach: client 는 ClientConnection 이어야 합니다');
    }
    const o = opts || {};
    const delayMs = isNum(o.delayMs) && /** @type {number} */ (o.delayMs) >= 0 ? /** @type {number} */ (o.delayMs) : DEFAULT_DELAY_MS;
    attachCount += 1;
    // seed 가 없으면 스타일 id 와 붙인 순번에서 정한다(같은 페이지에서 붙이는 순서가 같으면 같은 흐름)
    const seed = isNum(o.seed) ? /** @type {number} */ (o.seed) : ((hashStr(styleId) ^ Math.imul(attachCount, 0x9e3779b1)) >>> 0);
    const rng = Zap.rules.rng(seed);
    /** @type {((rec:BotLogRecord) => void)|null} */
    const userLog = typeof o.log === 'function' ? o.log : null;
    /** @type {number|null} */
    let seat = null;
    const log = userLog ? function (/** @type {BotLogRecord} */ rec) { rec.seat = seat; rec.style = styleId; /** @type {any} */ (userLog)(rec); } : null;
    const brain = makeBrain(S, rng, log);

    let stopped = false;
    /** @type {any} */
    let timer = null;
    /** 수를 보낸 화면 정보(새 state 가 오기 전에는 같은 화면 정보로 다시 결정하지 않는다) @type {PlayerView|null} */
    let actedOn = null;
    /** 보냈고 답(state 또는 error)을 기다리는 수 @type {Move|null} */
    let sent = null;
    /** 이 화면 정보에서 거부된 수의 열쇠 @type {string[]} */
    let refused = [];
    let retries = 0;
    let gaveUp = false;
    /** 마지막 귀족 사건을 받은 때(ms). 귀족 움직임은 다음 수가 오면 잘리므로 그 뒤 두 간격은 비운다 */
    let lastNobleAt = -Infinity;
    const now = function () { return typeof Date !== 'undefined' ? Date.now() : 0; };
    /** 다음 수까지 기다릴 시간: delayMs, 단 귀족 사건 뒤 2×delayMs 가 지나기 전이면 그때까지
     * (화면의 지연은 귀족 → 차례 넘기기 → 다음 수가 각각 delayMs 간격일 때 귀족이 두 간격 동안 보이도록 정해졌다.
     *  사람이 귀족을 받고 곧바로 넘긴 경우에도 같은 간격을 지킨다) */
    const waitMs = function () { return delayMs > 0 ? Math.max(delayMs, lastNobleAt + 2 * delayMs - now()) : 0; };

    const dead = function () { return stopped || client.status() === 'closed'; };
    function clear() { if (timer !== null) { clearTimeout(timer); timer = null; } }
    /** @param {PlayerView|null} v @returns {v is PlayerView} */
    function myTurn(v) {
      return !!v && v.phase !== 'over' && v.you !== null && v.you === v.current && Array.isArray(v.legal) && v.legal.length > 0;
    }
    /** @param {number} ms */
    function schedule(ms) {
      clear();
      if (dead() || gaveUp || !myTurn(client.view())) return;
      timer = setTimeout(step, ms);
    }
    /** @param {PlayerView} v @param {Move|null} m */
    function inLegal(v, m) {
      if (!m) return false;
      if (v.legal.indexOf(m) >= 0) return true;
      const k = moveKey(m);
      return v.legal.some(function (x) { return moveKey(x) === k; });
    }

    function step() {
      timer = null;
      if (dead() || gaveUp) return;
      const v = client.view();
      if (!myTurn(v)) return;
      seat = v.you;
      /** @type {Move|null} */
      let move = null;
      if (v === actedOn) {
        // 같은 화면 정보: 거부된 뒤의 재시도만
        if (sent || !refused.length) return;
        const last = retries > RETRY_LIMIT;
        move = brain.retry(v, refused, last);
        if (log) log({ type: 'retry', turn: v.turnsTaken, phase: v.phase, attempt: retries, move });
        if (last) gaveUp = true;
      } else {
        try {
          move = brain.decide(v);
        } catch (e) {
          if (log) log({ type: 'exception', turn: v.turnsTaken, phase: v.phase, message: String(e && /** @type {any} */ (e).stack || e) });
          else if (globalThis.console) globalThis.console.error('[Zap.bots] 판단 중 오류', e);
          move = brain.emergency(v);
        }
        if (move && !inLegal(v, move)) {
          if (log) log({ type: 'notLegal', turn: v.turnsTaken, phase: v.phase, move });
          move = brain.emergency(v);
        }
      }
      actedOn = v;
      if (!move) return;
      sent = move;
      client.move(move);
    }

    client.on('events', function (evs) {
      if (stopped) return;
      const v = client.view();
      if (v && v.you !== null) seat = v.you;
      if (Array.isArray(evs) && evs.some(function (e) { return e && e.type === 'noble'; })) lastNobleAt = now();
      brain.observeEvents(evs, v ? v.you : null);
    });
    client.on('state', function (v) {
      if (stopped) return;
      if (v && v.you !== null) seat = v.you;
      brain.observeState(v);
      sent = null;
      refused = [];
      retries = 0;
      gaveUp = false;
      actedOn = null;
      schedule(waitMs());
    });
    client.on('error', function (err) {
      if (dead() || !sent) return;
      refused.push(moveKey(sent));
      if (log) log({ type: 'error', code: err && err.code, move: sent });
      sent = null;
      retries += 1;
      if (retries > RETRY_LIMIT + 1) { gaveUp = true; return; }
      schedule(Math.min(delayMs, RETRY_DELAY_MS));
    });
    client.on('status', function () { if (dead()) clear(); });

    // 판이 이미 시작된 뒤에 붙었으면 지금 화면 정보로 시작한다
    const v0 = client.view();
    if (v0) { if (v0.you !== null) seat = v0.you; brain.observeState(v0); }
    schedule(delayMs);

    return {
      stop: function () { stopped = true; clear(); },
    };
  }

  /** @type {any} */ (Zap).bots = { styles: styles, register: register, attach: attach };
})();
