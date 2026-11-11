// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 둘째 층 ④ 접점 (Zap.botsL2: vocab·validate·withDefaults·makeL2)
 *
 * docs/ai/framework-l2.md 9.2 의 BotsL2API. engine.js 는 값 파일에 l2 가 있을 때만 이것을 부른다(0.4). 초보 값 파일에서는
 * 이 파일의 어떤 함수도 불리지 않고, rng 도 불리지 않는다.
 *
 * 한 사람에게 필요한 만큼만 구현한다(지금은 중수 신중형·충동형·수집형. 수집형의 계산은 calc.js 끝, 판단은 plan.js 끝의 Zap.botsL2.collector). 틀에 이름이 있지만 아직 구현하지 않은 칸은 vocab.PLANNED 에 두고,
 * 값 파일이 그것을 쓰면 register 가 '아직 구현되지 않은 칸'으로 거부한다. 다음 사람(대기 중인 중수들, framework-l2.md 12.4)이 필요한 칸을 IMPL 로 옮기며 넓힌다.
 */
(function () {
  'use strict';
  const Z = /** @type {any} */ (Zap);

  /* ───────────── 어휘 (5.3) ───────────── */

  /** 구현한 둘째 층 어휘 */
  const IMPL = {
    KEYS: ['turns', 'gain', 'rate', 'gemsPerPoint', 'mainInNobles', 'gapOrder', 'reserved', 'tierHigh', 'mainColor', 'planColor', 'feelCost', 'stepStones',
      'hurryNoble', 'nearNoble', 'gainRate'],
    FILTERS: ['engineCard', 'gapColor', 'completesNoble', 'gainPos', 'reachWin', 'finishes', 'threatened', 'inHorizon', 'planColor', 'offPlan', 'noGold', 'stepStone', 'missingDry', 'shortColor'],
    FILTER_OBJ: ['payMax', 'litPayMin', 'turnsMax', 'mainDry', 'costShape', 'any', 'not', 'gainMin', 'payPerPoint', 'nobleWithin', 'isTarget'],
    ACT_DO: ['reserve', 'guard', 'reserveDeck'],
    PAIRS: ['missingTwo', 'hurry'],
    FILLS: ['mainColor', 'secondColor', 'planCost', 'sideNoble', 'colorOrder', 'nobleNeed'],
    PROTECTS: ['planMissing', 'planColors'],
    ORDERS: ['offPlanFirst', 'colorRev'],
    LOOKS: ['plan', 'gainBuy'],
    PREFERS: ['left', 'plan', 'near'],
    MISTAKE_IDS: ['oppGoldMiss', 'turnsNoSupply', 'finalBlind', 'newCardOptimism', 'offPlanNobleBlind', 'goldAsFree', 'phaseCarry', 'oneDiscountMiss'],
    COND_NUM: ['mainBonusMin', 'mainBonusMax', 'planTurnsMin', 'planTurnsMax', 'myScoreMin', 'myScoreMax', 'oppScoreMin', 'oppScoreMax',
      'anyScoreMin', 'anyScoreMax', 'leaderGapMin', 'noBuyMin', 'reservedMin', 'supplyGoldMax', 'planNoblesLeft'],
    COND_BOOL: ['shapeMet', 'planReserved', 'planLit', 'planThreat', 'boughtOffPlan', 'nobleLate',
      'hurry', 'oppWinNext', 'replannedThisTurn', 'boardShortColorNone'],
    COND_STR: ['phase'],
  };
  /** 틀(5.3·4.3)에 이름이 있으나 아직 구현하지 않은 것 */
  const PLANNED = {
    KEYS: ['perPoint', 'nextHelp', 'planTurnsCut', 'planMissingMost', 'stepNet',
      'blockValue', 'oppScore', 'seatNext', 'rivalFirst'],
    FILTERS: ['planColorCost', 'onPath', 'offPath', 'notDelayPlan', 'planMissingColor', 'pileCovers', 'stepWorth'],
    FILTER_OBJ: ['perPointMax', 'payAfterBonusMax', 'planTurnsCut'],
    ACT_DO: ['block'],
    PAIRS: ['compare', 'dominant', 'mainTwo'],
    FILLS: ['reservedNeed', 'leaderPile', 'drain', 'stepWorth'],
    PROTECTS: ['nextMissing', 'reservedNeed', 'drainColors'],
    ORDERS: [],
    LOOKS: ['bought', 'boughtBonus'],
    PREFERS: ['rivalNear', 'refNear'],
    MISTAKE_IDS: ['oppBonusMiscount', 'oppNobleMiss', 'leaderTunnel',
      'reservedAsScore', 'stepNoPay', 'dropProtect', 'goldAhead', 'tieBlindFinal', 'refStale', 'endTurnsFlip'],
    COND: ['stance', 'refGapMin', 'refGapMax', 'refScoreMin', 'refScoreMax', 'planPileDropMin',
      'oppMainBonusMin', 'usefulTakeNone', 'topSnatched'],
  };
  /** @param {any} x */
  function isPlanned(x) {
    if (typeof x !== 'string') return false;
    for (const k of Object.keys(PLANNED)) if (/** @type {any} */ (PLANNED)[k].indexOf(x) >= 0) return true;
    return false;
  }

  /* ───────────── 검사 (5.6) ───────────── */

  /** @param {any} x */
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  /** @param {any} x */
  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  const NOT_YET = '아직 구현되지 않은 칸 ';

  /** engine.checkCond 가 모르는 칸 하나: 처리했으면 참 @param {string} k @param {any} val @param {string} at @param {string[]} errs */
  function checkCondKey(k, val, at, errs) {
    if (IMPL.COND_NUM.indexOf(k) >= 0) { if (!isNum(val)) errs.push(at + '.when.' + k + ': 수여야 합니다'); return true; }
    if (IMPL.COND_BOOL.indexOf(k) >= 0) { if (typeof val !== 'boolean') errs.push(at + '.when.' + k + ': 참/거짓이어야 합니다'); return true; }
    if (k === 'phase') { if (['build', 'score', 'wait'].indexOf(val) < 0) errs.push(at + ".when.phase: 'build'·'score'·'wait' 중 하나여야 합니다"); return true; }
    if (PLANNED.COND.indexOf(k) >= 0) { errs.push(at + '.when: ' + NOT_YET + k); return true; }
    return false;
  }

  /** 고르기 단계의 필터 목록(문자열과 객체) @param {any} list @param {string[]} base 초보 필터 @param {string} at @param {string[]} errs */
  function checkFilters(list, base, at, errs) {
    if (!Array.isArray(list)) { errs.push(at + ': 배열이어야 합니다'); return; }
    for (const f of list) checkFilter(f, base, at, errs);
  }
  /** @param {any} f @param {string[]} base @param {string} at @param {string[]} errs */
  function checkFilter(f, base, at, errs) {
    if (typeof f === 'string') {
      if (base.indexOf(f) >= 0 || IMPL.FILTERS.indexOf(f) >= 0) return;
      errs.push(at + ': ' + (isPlanned(f) || PLANNED.FILTERS.indexOf(f) >= 0 ? NOT_YET : '모르는 값 ') + JSON.stringify(f));
      return;
    }
    if (!isObj(f) || typeof f.f !== 'string') { errs.push(at + ': 필터는 이름이나 {f, …} 객체여야 합니다'); return; }
    if (PLANNED.FILTER_OBJ.indexOf(f.f) >= 0) { errs.push(at + ': ' + NOT_YET + f.f); return; }
    if (IMPL.FILTER_OBJ.indexOf(f.f) < 0) { errs.push(at + ': 모르는 필터 객체 ' + f.f); return; }
    const need = /** @type {Record<string, string[]>} */ ({ payPerPoint: ['k'], payMax: ['n'], litPayMin: ['n'], turnsMax: ['n'], gainMin: ['n'], nobleWithin: ['n'], mainDry: ['short', 'supplyMax'] });
    for (const k of need[f.f] || []) if (!isNum(f[k])) errs.push(at + '.' + f.f + '.' + k + ': 수여야 합니다');
    if (f.f === 'costShape' && !(Array.isArray(f.in) && f.in.every(function (/** @type {any} */ s) { return typeof s === 'string'; }))) errs.push(at + '.costShape.in: 문자열 배열이어야 합니다');
    if (f.f === 'any') { if (!Array.isArray(f.of) || !f.of.length) errs.push(at + '.any.of: 비지 않은 배열이어야 합니다'); else for (const g of f.of) checkFilter(g, base, at + '.any', errs); }
    if (f.f === 'not') checkFilter(f.of, base, at + '.not', errs);
  }

  /** @param {any} list @param {string} at @param {string[]} errs @param {(w:any, at:string, errs:string[]) => void} checkCond */
  function checkCondArray(list, at, errs, checkCond) {
    if (!Array.isArray(list)) { errs.push(at + ': 조건 객체의 배열이어야 합니다'); return; }
    list.forEach(function (w, i) { checkCond(w, at + '[' + i + ']', errs); });
  }

  /** l2 필드와 둘째 층 칸 전부(engine.validate 끝에서) @param {any} s @param {string[]} errs @param {{checkCond:(w:any, at:string, errs:string[]) => void}} base */
  function validate(s, errs, base) {
    const l2 = s.l2;
    if (!isObj(l2)) { errs.push('l2: 객체여야 합니다'); return; }
    if (s.level === 'beginner') errs.push("level: l2 가 있으면 'intermediate'·'expert' 여야 합니다");
    const targets = isObj(s.targets) ? s.targets : {};
    const tname = function (/** @type {any} */ n, /** @type {string} */ at) { if (typeof n !== 'string' || !targets[n]) errs.push(at + ': targets 에 없는 이름 ' + n); };
    const P = l2.plan;
    if (!isObj(P)) errs.push('l2.plan: 객체여야 합니다');
    else {
      if (P.kind === 'rolling' || P.kind === 'reservedAnchor') errs.push('l2.plan.kind: ' + NOT_YET + P.kind);
      else if (P.kind !== 'goalCard' && P.kind !== 'none' && P.kind !== 'nobleBundle') errs.push('l2.plan.kind: 모르는 값 ' + P.kind);
      if (P.kind === 'goalCard') {
        tname(P.goal, 'l2.plan.goal');
        if (P.replanTarget !== undefined) tname(P.replanTarget, 'l2.plan.replanTarget');
        if (P.lostTarget !== undefined) tname(P.lostTarget, 'l2.plan.lostTarget');
      }
      if (['cost2', 'cost2OrBonus', 'cost3only', 'none'].indexOf(P.second) < 0) errs.push('l2.plan.second: 모르는 값 ' + P.second);
      if (!isObj(P.shape) || !isNum(P.shape.main) || (P.shape.second !== undefined && !isNum(P.shape.second)) || (P.shape.base !== undefined && !isNum(P.shape.base))) {
        errs.push('l2.plan.shape: {main, second?, base?} (수) 여야 합니다');
      }
      if (typeof P.sideNoble !== 'boolean') errs.push('l2.plan.sideNoble: 참/거짓이어야 합니다');
      for (const k of ['anchor']) if (P[k] !== undefined) errs.push('l2.plan.' + k + ': ' + NOT_YET + k);
      if (!Array.isArray(P.switch)) errs.push('l2.plan.switch: 배열이어야 합니다');
      else P.switch.forEach(function (/** @type {any} */ sw, /** @type {number} */ i) {
        const at = 'l2.plan.switch[' + i + ']';
        if (!isObj(sw)) { errs.push(at + ': 객체여야 합니다'); return; }
        if (sw.on === 'planGone' || sw.on === 'planBought') return;
        if (sw.on === 'closerT3') {
          if (sw.by !== 'need' && sw.by !== 'turns') errs.push(at + ".by: 'need'·'turns' 여야 합니다");
          if (!isNum(sw.margin)) errs.push(at + '.margin: 수여야 합니다');
          for (const k of ['pointsDrop', 'newMargin']) if (sw[k] !== undefined && !isNum(sw[k])) errs.push(at + '.' + k + ': 수여야 합니다');
          for (const k of ['onlyNew', 'skipIfReserved', 'sameMainInScore']) if (sw[k] !== undefined && typeof sw[k] !== 'boolean') errs.push(at + '.' + k + ': 참/거짓이어야 합니다');
          if (sw.tie !== undefined && sw.tie !== 'points') errs.push(at + ".tie: 'points' 만 됩니다");
          return;
        }
        if (sw.on === 'planColorDry') { if (sw.exceptOneShort !== undefined && typeof sw.exceptOneShort !== 'boolean') errs.push(at + '.exceptOneShort: 참/거짓이어야 합니다'); return; }
        if (sw.on === 'rivalBoughtMain') { for (const k of ['left', 'keepTurns']) if (!isNum(sw[k])) errs.push(at + '.' + k + ': 수여야 합니다'); return; }
        if (sw.on === 'raceAbandon' || sw.on === 'nobleTaken') return;   // 수집형(검사는 collector.validate)
        if (sw.on === 'drawnT3') { if (!isNum(sw.margin)) errs.push(at + '.margin: 수여야 합니다'); return; }
        if (['better', 'planDryTurns', 'swapStreak'].indexOf(sw.on) >= 0) errs.push(at + '.on: ' + NOT_YET + sw.on);
        else errs.push(at + '.on: 모르는 값 ' + sw.on);
      });
    }
    const ph = l2.phase;
    if (!isObj(ph)) errs.push('l2.phase: 객체여야 합니다');
    else {
      if (ph.initial !== 'build' && ph.initial !== 'score') errs.push("l2.phase.initial: 'build'·'score' 여야 합니다");
      checkCondArray(ph.toScore, 'l2.phase.toScore', errs, base.checkCond);
      checkCondArray(ph.back, 'l2.phase.back', errs, base.checkCond);
      if (typeof ph.rejudge !== 'boolean') errs.push('l2.phase.rejudge: 참/거짓이어야 합니다');
      if (ph.wait !== undefined) errs.push('l2.phase.wait: ' + NOT_YET + 'wait');
    }
    if (Array.isArray(l2.stance) ? l2.stance.length : l2.stance !== undefined) errs.push('l2.stance: ' + NOT_YET + 'stance');
    const ct = l2.count;
    if (!isObj(ct) || ['sum3half', 'sum3full', 'sum3'].indexOf(ct.turns) < 0 || typeof ct.supply !== 'boolean') errs.push("l2.count: {turns:'sum3half'|'sum3full'|'sum3', supply} 여야 합니다");
    const rd = l2.read;
    if (!isObj(rd)) errs.push('l2.read: 객체여야 합니다');
    else {
      for (const k of ['bonus', 'tokens']) {
        if (rd[k] !== 'always' && rd[k] !== 'never' && rd[k] !== 'trigger') errs.push('l2.read.' + k + ': 모르는 값 ' + rd[k]);
      }
      const tg = isObj(rd.trigger) ? rd.trigger : {};
      if (rd.trigger !== undefined && !isObj(rd.trigger)) errs.push('l2.read.trigger: 객체여야 합니다');
      if (tg.boughtGoalColor !== undefined && typeof tg.boughtGoalColor !== 'boolean') errs.push('l2.read.trigger.boughtGoalColor: 참/거짓이어야 합니다');
      if (tg.pileDrop !== undefined) errs.push('l2.read.trigger: ' + NOT_YET + 'pileDrop');
      for (const k of Object.keys(tg)) if (k !== 'boughtGoalColor' && k !== 'pileDrop') errs.push('l2.read.trigger: 모르는 칸 ' + k);
      if ((rd.bonus === 'trigger' || rd.tokens === 'trigger') && !tg.boughtGoalColor) errs.push("l2.read: 'trigger' 에는 read.trigger 의 계기가 있어야 합니다");
      if (typeof rd.gold !== 'boolean') errs.push('l2.read.gold: 참/거짓이어야 합니다');
      if (rd.reserved) errs.push('l2.read.reserved: ' + NOT_YET + 'reserved');
      if (rd.nobles) errs.push('l2.read.nobles: ' + NOT_YET + 'nobles');
      if (rd.focus !== 'goal' && rd.focus !== 'planNobles') errs.push('l2.read.focus: ' + (['all', 'ref'].indexOf(rd.focus) >= 0 ? NOT_YET : '모르는 값 ') + rd.focus);
    }
    const hz = l2.endgame && l2.endgame.horizon;
    if (!isObj(hz) || typeof hz.includeBuy !== 'boolean') errs.push('l2.endgame.horizon: {kind, n?, includeBuy} 여야 합니다');
    else if (hz.kind === 'fixed') { if (!isNum(hz.n)) errs.push('l2.endgame.horizon.n: fixed 에는 수가 필요합니다'); }
    else if (hz.kind === 'byScore') { /* 충동형: 점수로만 어림(6.6) */ }
    else if (['ceil3', 'twoPerCard'].indexOf(hz.kind) >= 0) errs.push('l2.endgame.horizon.kind: ' + NOT_YET + hz.kind);
    else if (hz.kind !== 'none') errs.push('l2.endgame.horizon.kind: 모르는 값 ' + hz.kind);
    if (l2.gainNobles !== 'all' && l2.gainNobles !== 'plan') errs.push("l2.gainNobles: 'all'·'plan' 여야 합니다");
    if (l2.block !== undefined) errs.push('l2.block: ' + NOT_YET + 'block');
    if (!Array.isArray(l2.offPlanRules) || l2.offPlanRules.some(function (/** @type {any} */ x) { return typeof x !== 'string'; })) errs.push('l2.offPlanRules: 문자열 배열이어야 합니다');
    // 규칙
    const takeNames = Array.isArray(s.take) ? s.take.map(function (/** @type {any} */ m) { return m && m.name; }) : [];
    (Array.isArray(s.act) ? s.act : []).forEach(function (/** @type {any} */ r, /** @type {number} */ i) {
      const at = 'act[' + i + ']';
      if (!isObj(r)) return;
      if (r.do === 'reserve' || r.do === 'guard') tname(r.target, at + '.target');
      if (r.do === 'guard') for (const k of ['buy', 'reserve']) if (r[k] !== undefined && typeof r[k] !== 'boolean') errs.push(at + '.' + k + ': 참/거짓이어야 합니다');
      if (r.modes !== undefined) {
        if (r.do !== 'take') errs.push(at + ".modes: do 가 'take' 일 때만 됩니다");
        if (!Array.isArray(r.modes) || !r.modes.length) errs.push(at + '.modes: 비지 않은 배열이어야 합니다');
        else for (const n of r.modes) if (takeNames.indexOf(n) < 0) errs.push(at + '.modes: take 에 없는 이름 ' + n);
      }
      if (r.do === 'reserveDeck') {
        if (!Array.isArray(r.tiers) || !r.tiers.length || r.tiers.some(function (/** @type {any} */ t) { return [1, 2, 3].indexOf(t) < 0; })) errs.push(at + '.tiers: 1·2·3 의 비지 않은 배열이어야 합니다');
      } else if (r.tiers !== undefined) errs.push(at + ".tiers: do 가 'reserveDeck' 일 때만 됩니다");
      for (const k of ['oncePerGame', 'kind', 'focus', 'min', 'vsMyBuy', 'vsMe', 'skipNobleOnly']) if (r[k] !== undefined) errs.push(at + '.' + k + ': ' + NOT_YET + k);
    });
    (Array.isArray(s.take) ? s.take : []).forEach(function (/** @type {any} */ m, /** @type {number} */ i) {
      if (!isObj(m)) return;
      if (m.pairOnly !== undefined && typeof m.pairOnly !== 'boolean') errs.push('take[' + i + '].pairOnly: 참/거짓이어야 합니다');
      if (m.afterReturn !== undefined) errs.push('take[' + i + '].afterReturn: ' + NOT_YET + 'afterReturn');
    });
    const nb = s.noble;
    if (isObj(nb)) {
      if (nb.lookWhen !== undefined) checkCondArray(nb.lookWhen, 'noble.lookWhen', errs, base.checkCond);
      if (nb.bonusMin !== undefined) errs.push('noble.bonusMin: ' + NOT_YET + 'bonusMin');
      if (!Array.isArray(nb.prefer)) errs.push('noble.prefer: 배열이어야 합니다');
      else for (const x of nb.prefer) if (IMPL.PREFERS.indexOf(x) < 0) errs.push('noble.prefer: ' + (PLANNED.PREFERS.indexOf(x) >= 0 ? NOT_YET : '모르는 값 ') + x);
    }
    (Array.isArray(s.mistakes) ? s.mistakes : []).forEach(function (/** @type {any} */ m, /** @type {number} */ i) {
      if (isObj(m) && m.protect !== undefined) errs.push('mistakes[' + i + '].protect: ' + NOT_YET + 'protect');
    });
    const sf = s.safety;
    Z.botsL2.collector.validate(s, errs);
    if (isObj(sf)) for (const k of ['pingPongMax', 'blockStreakMax']) if (!(Number.isInteger(sf[k]) && sf[k] >= 1)) errs.push('safety.' + k + ': 1 이상의 정수여야 합니다');
  }

  /** @param {any} v */
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /** 5.2 의 기본값을 채운 사본(register 가 기본값을 채운 뒤, 검사 전에) @param {any} s */
  function withDefaults(s) {
    const o = clone(s);
    const l2 = o.l2;
    if (!isObj(l2)) return o;
    l2.plan = Object.assign({ kind: 'none', second: 'none', shape: { main: 3 }, sideNoble: false, switch: [{ on: 'planGone' }, { on: 'planBought' }] }, l2.plan || {});
    if (l2.plan.kind === 'nobleBundle') {
      if (l2.plan.bundle === undefined) l2.plan.bundle = { maxColors: 3, single: true };
      if (l2.plan.race === undefined) l2.plan.race = { hurryLead: 0, abandonLead: 2 };
      if (l2.plan.replanWithin === undefined) l2.plan.replanWithin = 4;
    }
    l2.phase = Object.assign({ initial: 'build', toScore: [{ shapeMet: true }], back: [], rejudge: false }, l2.phase || {});
    if (l2.stance === undefined) l2.stance = [];
    l2.count = Object.assign({ turns: 'sum3half', supply: false }, l2.count || {});
    l2.read = Object.assign({ bonus: 'never', tokens: 'never', gold: true, reserved: false, nobles: false, focus: 'goal' }, l2.read || {});
    l2.endgame = Object.assign({ horizon: { kind: 'none', includeBuy: false } }, l2.endgame || {});
    if (l2.gainNobles === undefined) l2.gainNobles = 'all';
    if (l2.offPlanRules === undefined) l2.offPlanRules = [];
    if (isObj(o.noble) && o.noble.prefer === undefined) o.noble.prefer = ['left'];
    if (isObj(o.safety)) {
      if (o.safety.pingPongMax === undefined) o.safety.pingPongMax = 3;
      if (o.safety.blockStreakMax === undefined) o.safety.blockStreakMax = 3;
    }
    return o;
  }

  /* ───────────── 판단 (9.2 L2Brain) ───────────── */

  /** @param {any} S 기본값을 채운 스타일(l2 있음) @param {() => number} rng @param {any} host engine.js 의 함수들 */
  function makeL2(S, rng, host) {
    const calc = Z.botsL2.calc;
    const memory = Z.botsL2.memory;
    const planMod = Z.botsL2.plan;
    const D = Z.data;
    const l2 = S.l2;
    let L = memory.newMem(l2.phase.initial);
    /** 수집형 실수 oneDiscountMiss 가 값 파일에 있을 때만 그 셈(과 굴림)을 연다 */
    const hasDiscountMiss = S.mistakes.some(function (/** @type {any} */ m) { return m.id === 'oneDiscountMiss'; });

    /** 이번 차례 문맥(P 가 만든다) @returns {any} */
    function TL() { const T = host.mem().turn; return T && T.l2 ? T.l2 : null; }
    /** @param {any} ctx */
    function you(ctx) { return /** @type {number} */ (ctx.v.you); }
    /** @returns {CardDef|null} */
    function planCard() { const m = host.mem(); return m.plan ? host.cardOf(m.plan.cardId) : null; }
    /** @param {L2Cand} x */
    function isPlan(x) { const m = host.mem(); return !!m.plan && x.card.id === m.plan.cardId; }

    /** 실수 turnsNoSupply 의 장면(3.2, 신5-4): 이 카드나 아직 못 사는 후보 중, 지각 셈으로 모자란 색의 공급처 더미가 1~3 인 카드가 있다
     * @param {CardDef} card @param {any} ctx */
    function lowPileScene(card, ctx) {
      /** @param {CardDef} c */
      const low = function (c) {
        return host.needOf(c, ctx).missing.some(function (/** @type {Color} */ k) { const s = ctx.v.supply[k]; return s >= 1 && s <= 3; });
      };
      return low(card) || (ctx.cards || []).some(function (/** @type {L2Cand} */ x) { return !x.buy && low(x.card); });
    }

    /** 6.1 내 차례 셈(지각 셈 needOf 위에 공급처). 처음 셀 때, 모자란 색 더미가 1~3 인 후보가 있으면 실수 turnsNoSupply 를 한 번 굴린다
     * (11-12 수정: 전에는 장면 조건 없이 굴렸다) @param {CardDef} card @param {any} ctx */
    function turns(card, ctx) {
      const X = TL();
      if (X && X.turnsCache[card.id] !== undefined) return X.turnsCache[card.id];
      let supply = l2.count.supply;
      if (supply && X) {
        if (X.rolls.turnsNoSupply === undefined) {
          const e = host.mistakeEntry('turnsNoSupply', ctx);
          X.rolls.turnsNoSupply = e && lowPileScene(card, ctx) ? host.roll('turnsNoSupply', ctx, e) : false;
        }
        if (X.rolls.turnsNoSupply) supply = false;
      }
      const N0 = host.needOf(card, ctx);
      const t = calc.turnsOf(hasDiscountMiss ? M.discountMiss(card, ctx, N0) : N0, l2.count, supply ? ctx.v.supply : null);
      if (X) X.turnsCache[card.id] = t;
      return t;
    }
    /** @param {L2Cand} x @param {any} ctx */
    function turnsX(x, ctx) { return x.buy ? 0 : turns(x.card, ctx); }
    /** @param {CardDef} card @param {any} ctx */
    function gain(card, ctx) { return calc.gainOf(ctx.v, you(ctx), card, nobleScope(ctx)); }
    /** 실수 offPlanNobleBlind(3.2): 처음 gain 을 셀 때, 계획 밖 귀족이 차는 켜진 카드가 있으면 한 번 굴린다 @param {any} ctx */
    function offPlanBlind(ctx) {
      const X = TL();
      if (!X) return false;
      if (X.rolls.offPlanNobleBlind === undefined) {
        let hit = false;
        const e = host.mistakeEntry('offPlanNobleBlind', ctx);
        if (e && ctx.buys.some(function (/** @type {L2Cand} */ b) {
          return calc.nobleCompletions(ctx.v, you(ctx), b.card, null).some(function (/** @type {string} */ id) { return L.nobles.indexOf(id) < 0; });
        })) hit = host.roll('offPlanNobleBlind', ctx, e);
        X.rolls.offPlanNobleBlind = hit;
      }
      return X.rolls.offPlanNobleBlind;
    }
    /** gain·completesNoble 이 보는 귀족(null = 전부) @param {any} ctx @returns {string[]|null} */
    function nobleScope(ctx) { return l2.gainNobles === 'plan' || offPlanBlind(ctx) ? L.nobles : null; }
    /** 실수 goldAsFree(3.2): 처음 payMax 를 볼 때, 황금이 든 켜진 카드가 있으면 한 번 @param {any} ctx */
    function goldFree(ctx) {
      const X = TL();
      if (!X) return false;
      if (X.rolls.goldAsFree === undefined) {
        let hit = false;
        const e = host.mistakeEntry('goldAsFree', ctx);
        if (e && ctx.buys.some(function (/** @type {L2Cand} */ b) { return /** @type {number} */ (b.payGold) > 0; })) hit = host.roll('goldAsFree', ctx, e);
        X.rolls.goldAsFree = hit;
      }
      return X.rolls.goldAsFree;
    }
    /** 6.3 상대 읽기. 이번 차례 처음 필요해질 때(목표 위협을 처음 셀 때) 한 번 만든다. 그때 황금을 쥔 상대마다 자리 순서로
     * 실수 oppGoldMiss 를 굴린다(9.5 는 P ① 자리로 적었으나, 그때는 첫 차례의 목표가 아직 없어 굴릴 장면이 서지 않는다).
     * P 를 거치지 않은 차례(D3 등)에는 실수 없이 새로 센다 @param {any} ctx */
    function readR(ctx) {
      const X = TL();
      if (X && X.R) return X.R;
      if (!X) return calc.readOpponents(ctx.v, you(ctx), l2.read, {});
      /** @type {Record<number, boolean>} */
      const goldMiss = {};
      const v = ctx.v;
      const me = you(ctx);
      if (l2.read.gold && l2.read.tokens === 'always') {
        for (let k = 1; k < v.numPlayers; k++) {
          const s = (me + k) % v.numPlayers;
          if (v.players[s].tokens.gold > 0) {
            const e = host.mistakeEntry('oppGoldMiss', ctx);
            if (e) goldMiss[s] = host.roll('oppGoldMiss', ctx, e);
          }
        }
      }
      X.R = calc.readOpponents(v, me, l2.read, goldMiss, X.open || {});
      return X.R;
    }
    /** 6.3 threatened (focus 'goal': 목표 카드 하나) @param {L2Cand} x @param {any} ctx */
    function threatened(x, ctx) {
      if (x.source === 'reserved' || !isPlan(x)) return false;
      return readR(ctx).seats.some(function (/** @type {any} */ r) { return calc.oppCanBuy(r, x.card); });
    }
    /** @param {any} ctx */
    function gapsNow(ctx) { return calc.gaps(ctx.v, you(ctx), L.colors, l2.plan.shape); }
    /** @param {any} ctx */
    function endFacts(ctx) { return calc.endgameFacts(ctx.v, you(ctx), l2.endgame); }
    /** 계획 색(주·보조) @returns {Color[]} */
    function planColors() { return L.colors ? [L.colors.main].concat(L.colors.second ? [L.colors.second] : []) : l2.plan.kind === 'nobleBundle' ? M.planColors() : []; }

    const B = { S, host, L: function () { return L; }, turns, M: /** @type {any} */ (null) };
    /** 수집형(nobleBundle)의 판단 갈래(plan.js 끝). 만들 때 아무것도 부르지 않는다 */
    const M = Z.botsL2.collector.mixin({ S, host, L: B.L, turns, readR, TL });
    B.M = M;

    /** P (2.2): 내 차례의 첫 action 결정에서 한 번 @param {PlayerView} v @param {any} ctx */
    function planStep(v, ctx) {
      const m = host.mem();
      /** @type {any} */
      const X = { R: null, E: null, rolls: {}, turnsCache: {}, finalBlind: false };
      m.turn.l2 = X;
      memory.onTurnStart(L, m.boardPrev, m.boardNow || []);
      // ① 상대 읽기는 처음 필요해질 때(readR). 실수 oppGoldMiss 도 그때 굴린다
      // read 'trigger'(충): 지난 내 차례 뒤 내 목표 주 색 카드를 산 상대만 연다. oppLog 는 P 끝에 비우므로 여기서 적어 둔다
      X.open = {};
      if (l2.read.trigger && l2.read.trigger.boughtGoalColor) {
        for (let k = 1; k < v.numPlayers; k++) { const s = (/** @type {number} */ (v.you) + k) % v.numPlayers; X.open[s] = calc.boughtColor(L.oppLog[s], L.colors ? L.colors.main : null); }
      }
      // ② 종반
      X.E = endFacts(ctx);
      // ③④ 계획과 단계
      planMod.planPart(B, v, ctx);
      // D1 시작의 finalBlind(9.5: P ③ 뒤)
      if (ctx.finalRound) {
        const e = host.mistakeEntry('finalBlind', ctx);
        if (e) X.finalBlind = host.roll('finalBlind', ctx, e);
      }
      memory.onPlanEnd(L, v);
      host.emit({ type: 'l2turn', turn: m.turn.id, phase: L.phase, plan: m.plan ? m.plan.cardId : null, colors: L.colors });
    }

    return {
      reset: function () { L = memory.newMem(l2.phase.initial); },
      /** @param {any[]} evs @param {number} y */
      onEvents: function (evs, y) { memory.onEvents(L, evs, y); },
      /** D1 시작(engine.decideAction 에서 ctxOf 직후) @param {PlayerView} v @param {any} ctx */
      beginD1: function (v, ctx) {
        const T = host.mem().turn;
        if (!T.l2) planStep(v, ctx);
        if (T.l2.finalBlind) ctx.finalRound = false;
      },
      /** 시험용: 둘째 층 기억(읽기만) */
      memory: function () { return L; },

      /** 4.3 조건 칸 하나 @param {string} name @param {any} val @param {any} ctx */
      cond: function (name, val, ctx) {
        const v = ctx.v;
        const me = ctx.me;
        switch (name) {
          case 'phase': return L.phase === val;
          case 'shapeMet': return calc.shapeMet(v, you(ctx), L.colors, l2.plan.shape) === val;
          case 'mainBonusMin': return !!L.colors && me.bonuses[L.colors.main] >= val;
          case 'mainBonusMax': return !!L.colors && me.bonuses[L.colors.main] <= val;
          case 'planTurnsMin': { const c = planCard(); return !!c && turns(c, ctx) >= val; }
          case 'planTurnsMax': { const c = planCard(); return !!c && turns(c, ctx) <= val; }
          case 'planReserved': { const c = planCard(); return (!!c && me.reserved.some(function (/** @type {any} */ r) { return r && r.id === c.id; })) === val; }
          case 'planLit': { const c = planCard(); return (!!c && ctx.buys.some(function (/** @type {L2Cand} */ b) { return b.card.id === c.id; })) === val; }
          case 'planThreat': {
            const c = planCard();
            const x = c ? ctx.cards.find(function (/** @type {L2Cand} */ y) { return y.card.id === c.id && y.source !== 'reserved'; }) : null;
            return (!!x && threatened(x, ctx)) === val;
          }
          case 'myScoreMin': return me.score >= val;
          case 'myScoreMax': return me.score <= val;
          case 'oppScoreMin': return endFacts(ctx).oppMax >= val;
          case 'oppScoreMax': return endFacts(ctx).oppMax <= val;
          case 'anyScoreMin': return endFacts(ctx).anyMax >= val;
          case 'anyScoreMax': return endFacts(ctx).anyMax <= val;
          case 'leaderGapMin': return endFacts(ctx).oppMax - me.score >= val;
          case 'noBuyMin': return host.mem().noBuyStreak >= val;
          case 'reservedMin': return me.reserved.length >= val;
          case 'supplyGoldMax': return v.supply.gold <= val;
          case 'nobleLate': {
            const ids = v.legal.filter(function (/** @type {any} */ x) { return x.type === 'claimNoble'; }).map(function (/** @type {any} */ x) { return x.nobleId; });
            return L.nobleLateIds.some(function (/** @type {string} */ id) { return ids.indexOf(id) >= 0; }) === val;
          }
          case 'boughtOffPlan': {
            const T = host.mem().turn;
            let off = false;
            if (T && T.bought && T.rule && l2.offPlanRules.indexOf(T.rule.name) >= 0) off = planColors().indexOf(host.cardOf(T.bought).bonus) < 0;
            return off === val;
          }
        }
        const r = M.cond(name, val, ctx);
        if (r !== undefined) return r;
        throw new Error('l2: 모르는 조건 ' + name);
      },

      /** 5.3 키(작을수록 앞) @param {string} k @param {L2Cand} x @param {any} ctx */
      key: function (k, x, ctx) {
        switch (k) {
          case 'turns': return turnsX(x, ctx);
          case 'gain': return -gain(x.card, ctx);
          case 'rate': return -gain(x.card, ctx) / (turnsX(x, ctx) + 1);
          case 'gemsPerPoint': return calc.gemsPerPoint(x.card);
          case 'mainInNobles': return -calc.mainInNobles(ctx.v, x.card);
          case 'gapOrder': { const g = gapsNow(ctx).find(function (/** @type {any} */ q) { return q.c === x.card.bonus; }); return g ? g.rank : 99; }
          case 'reserved': return x.source === 'reserved' ? 0 : 1;
          case 'tierHigh': return -x.tier;
          case 'mainColor': return L.colors && x.card.bonus === L.colors.main ? 0 : 1;
          case 'planColor': return planColors().indexOf(x.card.bonus) >= 0 ? 0 : 1;
          case 'feelCost': return calc.feelCost(ctx.v, you(ctx), x);
          case 'stepStones': return -calc.stepStonesOf(ctx.v, x.card, calc.mainCostColor(x.card));
        }
        if (k === 'gainRate') return -gain(x.card, ctx) / Math.max(1, turnsX(x, ctx));
        const r = M.key(k, x, ctx);
        if (r !== undefined) return r;
        throw new Error('l2: 모르는 키 ' + k);
      },

      /** 5.3 필터(문자열·객체) @param {any} f @param {L2Cand} x @param {any} ctx @returns {boolean} */
      filter: function (f, x, ctx) {
        if (typeof f === 'string') {
          switch (f) {
            case 'engineCard': {
              const gc = gapsNow(ctx).map(function (/** @type {any} */ q) { return q.c; });
              if (x.tier === 1) return gc.indexOf(x.card.bonus) >= 0;
              if (x.tier === 2) return gc.indexOf(x.card.bonus) >= 0 && planColors().indexOf(x.card.bonus) >= 0;
              return false;
            }
            case 'gapColor': return gapsNow(ctx).some(function (/** @type {any} */ q) { return q.c === x.card.bonus; });
            case 'completesNoble': return calc.nobleCompletions(ctx.v, you(ctx), x.card, nobleScope(ctx)).length > 0;
            case 'stepStone': return calc.isStepStone(ctx.v, you(ctx), x, L.colors, l2.plan.shape);
            case 'missingDry': return calc.missingDry(host.needOf(x.card, ctx), ctx.v.supply);
            case 'gainPos': return gain(x.card, ctx) >= 1;
            case 'reachWin': case 'finishes': return ctx.me.score + gain(x.card, ctx) >= 15;
            case 'threatened': return threatened(x, ctx);
            case 'inHorizon': return turnsX(x, ctx) + (l2.endgame.horizon.includeBuy ? 1 : 0) <= endFacts(ctx).horizon;
            case 'planColor': return planColors().indexOf(x.card.bonus) >= 0;
            case 'offPlan': return planColors().indexOf(x.card.bonus) < 0;
            case 'noGold': return !!x.buy && x.payGold === 0;
          }
          const r = M.filter(f, x, ctx);
          if (r !== undefined) return r;
          throw new Error('l2: 모르는 필터 ' + f);
        }
        switch (f.f) {
          case 'payMax': return !!x.buy && /** @type {number} */ (x.payTotal) - (goldFree(ctx) ? /** @type {number} */ (x.payGold) : 0) <= f.n;
          case 'payPerPoint': return calc.payPerPoint(ctx.v, you(ctx), x, f.k);
          case 'litPayMin': {
            const b = x.buy ? x : ctx.buys.find(function (/** @type {L2Cand} */ y) { return y.card.id === x.card.id; });
            return !!b && /** @type {number} */ (b.payTotal) >= f.n;
          }
          case 'turnsMax': return turnsX(x, ctx) <= f.n;
          case 'gainMin': return gain(x.card, ctx) >= f.n;
          case 'mainDry': {
            if (!L.colors) return false;
            const c = L.colors.main;
            return host.needOf(x.card, ctx).by[c] >= f.short && ctx.v.supply[c] <= f.supplyMax;
          }
          case 'costShape': return f.in.indexOf(calc.costShape(x.card)) >= 0;
          case 'any': return f.of.some(function (/** @type {any} */ g) { return host.filterOk(g, x, ctx); });
          case 'not': return !host.filterOk(f.of, x, ctx);
        }
        const r = M.filter(f, x, ctx);
        if (r !== undefined) return r;
        throw new Error('l2: 모르는 필터 ' + JSON.stringify(f));
      },

      /** 2.4 행동 규칙 reserve·guard @param {any} rule @param {any} ctx @returns {Move|null} */
      rule: function (rule, ctx) {
        if (rule.do === 'reserve') {
          const t = host.runTarget(S.targets[rule.target], ctx, function (/** @type {L2Cand} */ x) { return x.source !== 'reserved'; });
          if (!t) return null;
          const m = host.legalReserve(ctx, t.card.id);
          if (m) host.setReserveTarget(ctx, t);
          return m;
        }
        if (rule.do === 'reserveDeck') {
          for (const t of rule.tiers) {
            const m = ctx.legal.find(function (/** @type {any} */ y) { return y.type === 'reserveDeck' && y.tier === t; });
            if (m) return m;
          }
          return null;
        }
        if (rule.do === 'guard') {
          const t = host.runTarget(S.targets[rule.target], ctx);
          if (!t) return null;
          if (rule.buy !== false) {
            const b = ctx.buys.find(function (/** @type {L2Cand} */ y) { return y.card.id === t.card.id && host.acceptOk(host.avoidStatus(y, ctx, rule.lift || []), 'ok'); });
            if (b) return /** @type {Move} */ (b.move);
          }
          if (rule.reserve !== false && t.source !== 'reserved') {
            const m = host.legalReserve(ctx, t.card.id);   // 예약 칸이 찼으면 legal 에 없어 null
            if (m) host.setReserveTarget(ctx, t);
            return m;
          }
          return null;
        }
        return null;
      },

      /** 2.5 같은 색 2개의 색(초보 pair 가 정하지 못했을 때) @param {any} mode @param {any} N @param {Color[]} missing @param {any} ctx @returns {Color|null} */
      pair: function (mode, N, missing, ctx) {
        if (mode.pair === 'missingTwo') { for (const c of missing) if (host.legalTake2(ctx, c)) return c; }
        if (mode.pair === 'hurry') return M.pair(mode, N, missing, ctx);
        return null;
      },

      /** 2.5 fill 의 정렬 값(작을수록 앞) @param {string} name @param {Color} c @param {any} ctx */
      fillRank: function (name, c, ctx) {
        if (name === 'mainColor') return L.colors && c === L.colors.main ? 0 : 1;
        if (name === 'secondColor') return L.colors && c === L.colors.second ? 0 : 1;
        if (name === 'sideNoble') return calc.nobleGapColors(ctx.v, you(ctx), L.nobles).indexOf(c) >= 0 ? 0 : 1;
        if (name === 'nobleNeed') return M.fillRank(name, c, ctx);
        if (name === 'planCost') { const pc = planCard(); const i = pc ? host.needOf(pc, ctx).missing.indexOf(c) : -1; return i < 0 ? 99 : i; }
        return 0;
      },

      /** 2.7 귀족을 보는 계기 더하기(D3): 'plan' 계획 귀족이 claimable, 'gainBuy' 이번에 산 카드가 고를 때 귀족 +3 을 얻었음
       * (offPlanNobleBlind 가 맞았으면 계획 밖 귀족에는 서지 않는다) @param {any} ctx @param {string[]} fired */
      looks: function (ctx, fired) {
        const look = S.noble.look;
        const claim = ctx.v.legal.filter(function (/** @type {any} */ x) { return x.type === 'claimNoble'; }).map(function (/** @type {any} */ x) { return x.nobleId; });
        if (!claim.length) return;
        if (S.noble.lookWhen && planMod.anyCond(B, S.noble.lookWhen, ctx)) fired.push('lookWhen');
        if (look.indexOf('plan') >= 0 && L.nobles.some(function (/** @type {string} */ id) { return claim.indexOf(id) >= 0; })) fired.push('plan');
        const T = host.mem().turn;
        if (look.indexOf('gainBuy') >= 0 && T.bought) {
          const card = host.cardOf(T.bought);
          const b0 = T.bonusesAtStart;
          /** @type {Record<string, number>} */
          const after = {};
          for (const c of D.COLORS) after[c] = b0[c] + (card.bonus === c ? 1 : 0);
          const blind = !!(T.l2 && T.l2.rolls.offPlanNobleBlind);
          const hit = claim.some(function (/** @type {string} */ id) {
            const nb = D.noblesById[id];
            if (blind && L.nobles.indexOf(id) < 0) return false;
            return D.COLORS.some(function (/** @type {Color} */ c) { return b0[c] < nb.require[c]; }) && D.COLORS.every(function (/** @type {Color} */ c) { return after[c] >= nb.require[c]; });
          });
          if (hit) fired.push('gainBuy');
        }
      },
      /** 줄 전체를 보는 둘째 층 계기인가 @param {string} f */
      lookAll: function (f) { return f === 'gainBuy' || f === 'lookWhen'; },
      /** claimable 중 prefer 순서의 첫째 @param {any[]} claim view.nobles 순서로 정렬된 claimNoble 수 @param {boolean} onlyPlan */
      prefer: function (claim, onlyPlan) {
        const xs = claim.filter(function (/** @type {any} */ m) { return !onlyPlan || L.nobles.indexOf(m.nobleId) >= 0; });
        const pr = S.noble.prefer;
        xs.sort(function (/** @type {any} */ a, /** @type {any} */ b) {
          for (const p of pr) {
            if (p === 'plan') { const d = (L.nobles.indexOf(a.nobleId) >= 0 ? 0 : 1) - (L.nobles.indexOf(b.nobleId) >= 0 ? 0 : 1); if (d) return d; }
            if (p === 'near') { const d = M.nearRank(a.nobleId) - M.nearRank(b.nobleId); if (d) return d; }
          }
          return 0;   // 'left': claim 이 이미 view.nobles 순서(안정 정렬)
        });
        return xs[0] || null;
      },
      /** 2.6 반납 order(둘째 층 이름): 작을수록 먼저 돌려줌 @param {string} name @param {string} c */
      orderRank: function (name, c) { const r = M.orderRank(name, c); return r === undefined ? 0 : r; },
      /** D3 끝: claimable 인데 받지 않고 차례를 넘기면 다음 차례의 조건 nobleLate 용으로 적는다 @param {PlayerView} v @param {Move|null} move */
      nobleEnd: function (v, move) {
        const ids = v.legal.filter(function (/** @type {any} */ x) { return x.type === 'claimNoble'; }).map(function (/** @type {any} */ x) { return x.nobleId; });
        L.nobleLateIds = move && move.type === 'endTurn' ? ids : [];
      },

      /** 2.6 반납 보호 색. planMissing 은 '목표 카드에 토큰이 필요한 색'(비용 − 보너스 > 0)으로 센다(신중형 3절 '필요 없는 색부터')
       * @param {string} kind @param {PlayerView} v @returns {Color[]} */
      protectSet: function (kind, v) {
        const me = v.players[/** @type {number} */ (v.you)];
        if (kind === 'planMissing') {
          const pc = planCard();
          return pc ? D.COLORS.filter(function (/** @type {Color} */ c) { return pc.cost[c] - me.bonuses[c] > 0; }) : [];
        }
        if (kind === 'planColors') return planColors();
        return [];
      },
    };
  }

  Z.botsL2 = Z.botsL2 || {};
  Object.assign(Z.botsL2, {
    vocab: { IMPL, PLANNED, isPlanned },
    checkCondKey, checkFilters, validate, withDefaults, makeL2,
  });
})();
