// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 둘째 층 ③ 계획·단계 (Zap.botsL2.plan)
 *
 * docs/ai/framework-l2.md 2.2 planStep 의 ③④ 와 2.3 makePlan·firstSwitch·replan, 8절 S4.
 * P 는 수를 고르지 않는다. D1 에서 쓸 사실(목표 카드·색·단계)을 정해 두고, 이번 차례에 무엇을 할지는 여전히 값 파일의 act 가 정한다.
 *
 * 지금 구현한 것: 계획 종류 goalCard(와 계획 없음 'none'), nobleBundle(수집형, 이 파일 끝의 Zap.botsL2.collector), 계기 planGone·planBought·closerT3(+tie·newCardOptimism)·planColorDry·rivalBoughtMain·drawnT3(충동형),
 * 곁다리 귀족(sideNoble, 사라지면 새로 정함), 실수 phaseCarry, 단계 build·score 의 전환(toScore)과
 * 되돌아가기(back), 다시 판정(rejudge), S4 왕복 잠금, 그리고 수집형의 계기 raceAbandon·nobleTaken·경주 셈(collector). 구현하지 않은 것(검사가 거부한다):
 * 계획 종류 rolling·reservedAnchor(와 anchor 칸), 계기 better·planDryTurns·swapStreak, 기다림 단계(wait), 태세(stance). 목록의 기준은 hooks.js 의 IMPL·PLANNED 와 framework-l2.md 12절.
 *
 * 인간상과 맞춘 것 두 가지(보고서에 적음):
 *  - 되돌아가기(phase.back)는 '목표를 잃음'(planGone)으로 다시 세울 때만 판정한다. 산 뒤(planBought)·새 카드로 바꿀 때(closerT3)는
 *    단계를 그대로 잇는다(신중형 3절 '쌓는 단계로 돌아가는 길은 목표를 잃음 하나뿐', '산 것이므로 원래 단계를 그대로 잇는다').
 *  - plan.lostTarget(새 칸): 목표를 잃었을 때 쓰는 targets 이름. 없으면 replanTarget. 신중형은 '점수 단계·경보 없음에서 잃음'과
 *    '점수 단계에서 산 뒤'의 새 목표가 다르다(3절 '목표를 잃음' / '점수 단계, 살 것이 없다').
 *  - closerT3 가 서면 그 더 가까운 카드가 곧 새 목표다(목표 명세를 다시 돌리지 않는다).
 */
(function () {
  'use strict';
  const Z = /** @type {any} */ (Zap);

  /** @param {any} B @param {any[]} arr @param {any} ctx */
  function anyCond(B, arr, ctx) {
    for (const w of arr || []) if (B.host.condHolds(w, ctx)) return true;
    return false;
  }

  /** 목표를 정한다(초보 기억 mem.plan 과 둘째 층 기억을 함께) @param {any} B @param {any} ctx @param {L2Cand|null} t */
  function setPlan(B, ctx, t) {
    const m = B.host.mem();
    const L = B.L();
    const P = B.S.l2.plan;
    if (!t) { m.plan = null; L.planId = null; return; }   // 색(L.colors)은 그대로 둔다: 쌓던 모양은 목표가 잠시 없어도 남는다
    m.plan = { cardId: t.card.id, setTurn: m.turn.id, idle: 0, onBoard: t.source !== 'reserved' };
    L.planId = t.card.id;
    L.colors = Z.botsL2.calc.colorsOf(t.card, P.second);
    if (P.sideNoble) refreshSideNoble(B, ctx, true);
  }

  /** 곁다리 귀족(2.3 sideNoble): 계획을 세울 때 정하고, 그 귀족이 줄에서 사라지면(남이 받음·내가 받음) 새로 정한다(충3 '상대가 귀족을 받음')
   * @param {any} B @param {any} ctx @param {boolean} force */
  function refreshSideNoble(B, ctx, force) {
    const L = B.L();
    if (!L.colors) return;
    if (!force && L.nobles.length && L.nobles.every(function (/** @type {string} */ id) { return ctx.v.nobles.indexOf(id) >= 0; })) return;
    const id = Z.botsL2.calc.sideNoble(ctx.v, /** @type {number} */ (ctx.v.you), L.colors.main);
    L.nobles = id ? [id] : [];
  }

  /** S4 갈아타기 왕복: 최근 2×k 기록이 두 카드 사이를 오가면 다음 3 차례 closerT3 를 끈다 @param {any} B */
  function pingPong(B) {
    const L = B.L();
    const k = B.S.safety.pingPongMax;
    const rs = L.replans.slice(-2 * k);
    if (rs.length < 2 * k) return;
    const ids = rs.map(function (/** @type {any} */ r) { return r.cardId; });
    const set = ids.filter(function (/** @type {any} */ x, /** @type {number} */ i) { return ids.indexOf(x) === i; });
    if (set.length !== 2) return;
    for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1]) return;
    L.pingPongUntil = L.turnNo + 3;
    B.host.tag('S4');
  }

  /** 2.3 makePlan / replan. reason: 'start' | 'planGone' | 'planBought' | 'none'(목표가 없어 다시 시도) | 'closerT3'
   * @param {any} B @param {any} ctx @param {string} reason @param {L2Cand|null} [given] closerT3 가 고른 카드
   * @param {(x:L2Cand) => boolean} [extra] 이번 다시 세우기에서만 거르는 것(planColorDry: 마른 색을 요구하는 카드 뺌) */
  function makePlan(B, ctx, reason, given, extra) {
    const L = B.L();
    const l2 = B.S.l2;
    const P = l2.plan;
    const m = B.host.mem();
    const prev = m.plan ? m.plan.cardId : L.planId;
    /** @type {L2Cand|null} */
    let t = null;
    if (given) t = given;
    else {
      const name = reason === 'start' ? P.goal : reason === 'planGone' ? (P.lostTarget || P.replanTarget || P.goal) : (P.replanTarget || P.goal);
      t = B.host.runTarget(B.S.targets[name], ctx, function (/** @type {L2Cand} */ x) { return L.excluded.indexOf(x.card.id) < 0 && (!extra || extra(x)); });
    }
    setPlan(B, ctx, t);
    Z.botsL2.memory.noteReplan(L, reason, t ? t.card.id : null);
    B.host.emit({ type: 'l2plan', turn: m.turn.id, reason, cardId: t ? t.card.id : null, prev, phase: L.phase });
    // 단계 판정
    if (reason === 'start') L.phase = l2.phase.initial;
    else if (reason === 'planGone' && t && anyCond(B, l2.phase.back, ctx)) {
      if (L.phase !== 'build') B.host.emit({ type: 'l2phase', turn: m.turn.id, from: L.phase, to: 'build', why: 'back' });
      L.phase = 'build';
    } else if (l2.phase.rejudge && t && !carry(B, ctx)) {
      const to = anyCond(B, l2.phase.toScore, ctx) ? 'score' : 'build';
      if (to !== L.phase) B.host.emit({ type: 'l2phase', turn: m.turn.id, from: L.phase, to, why: 'rejudge' });
      L.phase = to;
    }
    if (reason === 'closerT3') pingPong(B);
  }

  /** 실수 phaseCarry(3.2): 직전 다시 세우기(첫 세우기 빼고)가 2 차례 안이면 한 번 굴려, 맞으면 단계를 다시 판정하지 않는다
   * (noteReplan 뒤에 부르므로 이번 기록은 맨 끝, 직전 기록은 그 앞) @param {any} B @param {any} ctx */
  function carry(B, ctx) {
    const L = B.L();
    const prev = L.replans.length >= 2 ? L.replans[L.replans.length - 2] : null;
    if (!prev || prev.reason === 'start' || L.turnNo - prev.turn > 2) return false;
    const e = B.host.mistakeEntry('phaseCarry', ctx);
    return e ? B.host.roll('phaseCarry', ctx, e) : false;
  }

  /** 2.3 firstSwitch 의 closerT3 (planGone·planBought 는 엔진의 자동 해제 뒤 planStep 이 직접 판정한다)
   * @param {any} B @param {any} ctx @param {any} sw @returns {L2Cand|null} */
  function closerT3(B, ctx, sw) {
    const L = B.L();
    const m = B.host.mem();
    const calc = Z.botsL2.calc;
    if (L.turnNo <= L.pingPongUntil) return null;
    const goal = B.host.cardOf(m.plan.cardId);
    const reserved = ctx.me.reserved.some(function (/** @type {any} */ r) { return r && r.id === goal.id; });
    if (sw.skipIfReserved && reserved) return null;
    /** @type {string[]} 실수 newCardOptimism 이 맞으면 낙관 셈(ceil(T/3))으로 볼 새 카드 */
    let rosy = [];
    if (sw.by === 'turns') {
      const heavy = ctx.cards.filter(function (/** @type {L2Cand} */ x) {
        return x.source === 't3' && x.card.id !== goal.id && L.newIds.indexOf(x.card.id) >= 0 && calc.heavyOneColor(B.host.needOf(x.card, ctx));
      });
      if (heavy.length) {
        const e = B.host.mistakeEntry('newCardOptimism', ctx);
        if (e && B.host.roll('newCardOptimism', ctx, e)) rosy = heavy.map(function (/** @type {L2Cand} */ x) { return x.card.id; });
      }
    }
    const val = function (/** @type {CardDef} */ c) {
      if (rosy.indexOf(c.id) >= 0) return calc.turnsOptimistic(B.host.needOf(c, ctx));
      return sw.by === 'turns' ? B.turns(c, ctx) : B.host.needOf(c, ctx).total;
    };
    const gv = val(goal);
    /** @type {L2Cand[]} */
    const out = ctx.cards.filter(function (/** @type {L2Cand} */ x) {
      if (x.source !== 't3' || x.card.id === goal.id || L.excluded.indexOf(x.card.id) >= 0) return false;
      const isNew = L.newIds.indexOf(x.card.id) >= 0;
      if (sw.onlyNew && !isNew) return false;
      const margin = isNew && sw.newMargin !== undefined ? sw.newMargin : sw.margin;
      if (!(val(x.card) <= gv - margin)) return false;
      if (sw.pointsDrop !== undefined && x.card.points < goal.points - sw.pointsDrop) return false;
      if (sw.sameMainInScore && L.phase === 'score' && L.colors && calc.mainCostColor(x.card) !== L.colors.main) return false;
      return true;
    });
    if (!out.length) return null;
    // 동률: 기본은 적힌 비용÷점수(신중형), tie:'points' 면 점수가 큰 것(충3 '차례 셈이 작은 것, 점수가 큰 것, 읽는 순서')
    out.sort(function (a, b) {
      return val(a.card) - val(b.card) || (sw.tie === 'points' ? b.card.points - a.card.points : calc.gemsPerPoint(a.card) - calc.gemsPerPoint(b.card)) || a.slot - b.slot;
    });
    return out[0];
  }

  /** 1개 모자라고 황금 거래 예약이 되는가(공개 줄의 목표, 공급처 황금, legal 예약) @param {any} B @param {any} ctx @param {CardDef} goal */
  function goldDeal(B, ctx, goal) {
    return B.host.needOf(goal, ctx).total === 1 && ctx.v.supply.gold > 0 && !!B.host.legalReserve(ctx, goal.id);
  }

  /** 계기 planColorDry(충3 '목표 색 더미가 비었고 목표가 그 색을 아직 요구함'): 계획 주 색이 목표에 아직 모자라고(황금은 needOf 가 이미 뺌)
   * 그 더미가 0. 틀 2.3 표는 '모자란 색 중 하나'로 적었으나 인간상 3절은 목표 색(주 색)이라 3절을 따랐다. 서지 않으면 null
   * @param {any} B @param {any} ctx @param {any} sw @returns {Color[]|null} */
  function planColorDry(B, ctx, sw) {
    const L = B.L();
    if (!L.colors) return null;
    const goal = B.host.cardOf(B.host.mem().plan.cardId);
    const N = B.host.needOf(goal, ctx);
    const c0 = L.colors.main;
    if (!(N.by[c0] > 0 && ctx.v.supply[c0] === 0)) return null;
    const dry = [c0];
    if (sw.exceptOneShort && goldDeal(B, ctx, goal)) return null;   // 황금 거래 예약에 맡김
    return dry;
  }

  /** 계기 rivalBoughtMain(충3 '상대'): 지난 내 차례 이후 내 목표 주 색 카드를 산 상대의 보너스만으로 센 목표 남은 비용 ≤ left,
   * 내 목표 차례 셈 > keepTurns, 황금 거래 안 됨 @param {any} B @param {any} ctx @param {any} sw */
  function rivalBoughtMain(B, ctx, sw) {
    const L = B.L();
    const calc = Z.botsL2.calc;
    if (!L.colors) return false;
    const goal = B.host.cardOf(B.host.mem().plan.cardId);
    const v = ctx.v;
    let hit = false;
    for (let k = 1; k < v.numPlayers; k++) {
      const s = (/** @type {number} */ (v.you) + k) % v.numPlayers;
      if (calc.boughtColor(L.oppLog[s], L.colors.main) && calc.oppLeft(v.players[s].bonuses, goal) <= sw.left) { hit = true; break; }
    }
    if (!hit) return false;
    if (B.turns(goal, ctx) <= sw.keepTurns) return false;
    return !goldDeal(B, ctx, goal);
  }

  /** 계기 drawnT3(충3 '덱 뽑기'): 덱에서 뽑아 처음 본 내 3단계 예약 카드의 차례 셈이 목표보다 margin 이상 작음 @param {any} B @param {any} ctx @param {any} sw
   * @returns {L2Cand|null} */
  function drawnT3(B, ctx, sw) {
    const L = B.L();
    const ids = Z.botsL2.calc.newDrawnT3(ctx.v, /** @type {number} */ (ctx.v.you), L.drawnSeen);
    if (!ids.length) return null;
    const gv = B.turns(B.host.cardOf(B.host.mem().plan.cardId), ctx);
    const xs = ctx.cards.filter(function (/** @type {L2Cand} */ x) { return x.source === 'reserved' && ids.indexOf(x.card.id) >= 0 && B.turns(x.card, ctx) <= gv - sw.margin; });
    xs.sort(function (a, b) { return B.turns(a.card, ctx) - B.turns(b.card, ctx) || b.card.points - a.card.points || a.slot - b.slot; });
    return xs[0] || null;
  }

  /** P ③④: 계획 세우기·유지·바꾸기, 단계 전환 @param {any} B @param {PlayerView} v @param {any} ctx */
  function planPart(B, v, ctx) {
    const L = B.L();
    const l2 = B.S.l2;
    const P = l2.plan;
    const m = B.host.mem();
    if (P.kind === 'nobleBundle') B.M.planPart(v, ctx);   // 수집형: 아래 Zap.botsL2.collector
    if (P.kind === 'goalCard') {
      if (m.plan && m.plan.cardId !== L.planId) {
        // 초보 규칙 plan(replace) 이 목표를 바꿨다: 같은 기억이므로 색만 따라간다(7.1)
        L.planId = m.plan.cardId;
        L.colors = Z.botsL2.calc.colorsOf(B.host.cardOf(m.plan.cardId), P.second);
      }
      if (!m.plan) {
        /** @type {string} */
        let reason = 'none';
        if (L.turnNo === 1 && L.replans.length === 0) reason = 'start';
        else if (L.planId !== null) reason = ctx.me.cards.indexOf(L.planId) >= 0 ? 'planBought' : 'planGone';
        makePlan(B, ctx, reason);
      } else {
        for (const sw of P.switch) {
          // planGone·planBought 는 위(목표가 비었을 때)에서. 나머지는 적힌 순서로 처음 선 것 하나
          if (sw.on === 'closerT3') {
            const t = closerT3(B, ctx, sw);
            if (t) { makePlan(B, ctx, 'closerT3', t); break; }
          } else if (sw.on === 'planColorDry') {
            const dry = planColorDry(B, ctx, sw);
            if (dry) {
              makePlan(B, ctx, 'planColorDry', null, function (/** @type {L2Cand} */ x) {
                const N = B.host.needOf(x.card, ctx);
                return dry.every(function (/** @type {Color} */ c) { return N.by[c] === 0; });
              });
              break;
            }
          } else if (sw.on === 'rivalBoughtMain') {
            if (rivalBoughtMain(B, ctx, sw)) {
              L.excluded.push(m.plan.cardId);   // 판 끝까지 뺀다(2.3)
              makePlan(B, ctx, 'rivalBoughtMain');
              break;
            }
          } else if (sw.on === 'drawnT3') {
            const t = drawnT3(B, ctx, sw);
            if (t) { makePlan(B, ctx, 'drawnT3', t); break; }
          }
        }
      }
    }
    if (P.sideNoble) refreshSideNoble(B, ctx, false);
    if (P.switch.some(function (/** @type {any} */ sw) { return sw.on === 'drawnT3'; })) {
      // 뽑은 카드는 처음 본 차례에만 견준다(그 뒤에는 거래로 켜지기를 기다림)
      for (const id of Z.botsL2.calc.newDrawnT3(v, /** @type {number} */ (v.you), L.drawnSeen)) L.drawnSeen.push(id);
    }
    // ④ 단계: 쌓기 → 점수 (되돌아가기는 makePlan 안에서만)
    if (L.phase === 'build' && anyCond(B, l2.phase.toScore, ctx)) {
      L.phase = 'score';
      B.host.emit({ type: 'l2phase', turn: m.turn.id, from: 'build', to: 'score', why: 'toScore' });
    }
  }

  Z.botsL2 = Z.botsL2 || {};
  Z.botsL2.plan = { planPart, makePlan, closerT3, anyCond, refreshSideNoble };
})();

/*
 * 짭플렌더 — 컴퓨터 상대 둘째 층: 중수 수집형이 더하는 판단 (Zap.botsL2.collector)
 *
 * 근거: docs/ai/personas/intermediate-collector.md 3절(기준), docs/ai/framework-l2.md 2.3·2.5~2.7·4.3·5.3·6.5·6.6, work/l2-values/notes.md 1.2·3절.
 * hooks.js 의 makeL2 가 mixin(B) 을 한 번 만들고, 자기가 모르는 이름일 때 여기 갈래를 부른다. 이름을 모르면 undefined 를 돌려준다
 * (그러면 hooks 가 원래대로 '모르는 …' 오류를 던진다). 초보·다른 중수 값 파일에서는 이 이름들이 검사에서 막히거나 쓰이지 않으므로
 * 여기 코드는 불리지 않고 rng 도 불리지 않는다. rng 를 부르는 곳은 실수 oneDiscountMiss(값 파일에 그 항목이 있을 때만) 하나다.
 *
 * 둘째 층 기억에 더하는 칸(L): nobles(받지 않은 계획 귀족, 신중형 기억의 같은 칸), received(받은 계획 귀족), planNobles(이 계획에 든 귀족 전부:
 * 계획 색을 받은 뒤에도 잇기 위함), need(필요 수), hurry(이번 차례 서두름 귀족), rebuiltTurn(다시 세운 차례 번호), started.
 *
 * '틀에 없음'(notes 3절)을 정한 것:
 *  - 조건 replannedThisTurn(참/거짓): 이번 차례 P 에서 귀족 계획을 다시 세웠다(다시 세우기가 귀족을 못 찾아 계획이 없어진 차례 포함). noble.lookWhen 에 쓴다.
 *  - 조건 boardShortColorNone(참/거짓): 1·2단계 공개 줄에 보너스가 모자란 색인 카드가 한 장도 없다. 3절 '사지 않는 차례' 4번 덱 예약에 쓴다.
 *  - 필터 {f:'isTarget', of:<targets 이름>}: 후보가 그 목표 명세의 첫 후보(=이번 차례 목표)와 같은 카드다. 3절 3번 황금 예약
 *    ('목표가 공개 줄의 2·3단계이고 몇 차례 ≥ 2')과 '무엇을 예약하나'(목표가 공개면 목표)를 바로 옮긴다. 명세 안에서 isTarget 을 다시 부르면 막는다.
 *  - 계획 색(키 planColor·반납 offPlanFirst)은 이 계획에 든 귀족 전부(받은 것 포함)의 색이다. 마무리 단계에도 계획 색이 남는다(notes 3절 8).
 */
(function () {
  'use strict';
  const Z = /** @type {any} */ (Zap);

  /** 수집형 어휘(hooks 의 IMPL 에 더할 것) */
  const VOCAB = {
    KEYS: ['hurryNoble', 'nearNoble', 'gainRate'],   // gainRate 는 hooks 의 gain·turnsX 로 센다
    FILTERS: ['shortColor'],
    FILTER_OBJ: ['nobleWithin', 'isTarget'],
    ACT_DO: ['reserveDeck'],
    PAIRS: ['hurry'],
    FILLS: ['nobleNeed'],
    PROTECTS: [],
    ORDERS: ['offPlanFirst', 'colorRev'],
    LOOKS: ['plan'],
    PREFERS: ['near'],
    MISTAKE_IDS: ['oneDiscountMiss'],
    COND_NUM: ['planNoblesLeft'],
    COND_BOOL: ['hurry', 'oppWinNext', 'replannedThisTurn', 'boardShortColorNone'],
    SWITCH: ['raceAbandon', 'nobleTaken'],
    PLAN_KIND: ['nobleBundle'],
    READ_FOCUS: ['planNobles'],
  };

  /**
   * @param {{S:any, host:any, L:() => any, turns:(card:CardDef, ctx:any) => number, readR:(ctx:any) => any, TL:() => any}} B
   */
  function mixin(B) {
    const calc = Z.botsL2.calc;
    const C = /** @type {Color[]} */ (Z.data.COLORS);
    const S = B.S;
    const host = B.host;

    /** 기억 칸을 처음 쓸 때 만든다 */
    function Lc() {
      const L = B.L();
      if (L.received === undefined) {
        L.received = []; L.planNobles = []; L.need = null; L.hurry = []; L.rebuiltTurn = -1; L.started = false;
        if (!Array.isArray(L.nobles)) L.nobles = [];
      }
      return L;
    }
    /** @param {any} ctx @returns {number} */
    function you(ctx) { return ctx.v.you; }
    /** @param {any} ctx @returns {Record<string, number>} */
    function bon(ctx) { return ctx.me.bonuses; }
    /** 받지 않은 계획 귀족 기준의 모자란 색 @param {any} ctx */
    function shortNow(ctx) { const L = Lc(); return calc.shortColors(L.nobles.length ? L.need : null, bon(ctx)); }
    /** 계획 색(이 계획에 든 귀족 전부의 색) @returns {Color[]} */
    function planColors() {
      const L = Lc();
      /** @type {Color[]} */
      const out = [];
      for (const id of L.planNobles) for (const c of calc.nobleColorsOf(id)) if (out.indexOf(c) < 0) out.push(c);
      return out;
    }
    /** @param {any} plan {nobles, need}|null @param {string} reason @param {any} ctx */
    function setNoblePlan(plan, reason, ctx) {
      const L = Lc();
      L.nobles = plan ? plan.nobles.slice() : [];
      L.planNobles = plan ? plan.nobles.slice() : [];
      L.received = [];
      L.need = plan ? plan.need : null;
      Z.botsL2.memory.noteReplan(L, reason, null);
      host.emit({ type: 'l2plan', turn: host.mem().turn.id, reason, nobles: L.nobles.slice(), need: L.need, phase: L.phase });
    }
    /** 남은 계획 귀족의 필요 수 다시 세기 */
    function reneed() { const L = Lc(); L.need = L.nobles.length ? calc.needOfNobles(L.nobles) : null; }

    /** P ③(nobleBundle): 세우기·받음·잃음·경주 셈·다시 세우기. 단계 전환(④)은 hooks/plan 의 공용 자리가 한다 @param {PlayerView} v @param {any} ctx */
    function planPart(v, ctx) {
      const L = Lc();
      const P = S.l2.plan;
      const me = ctx.me;
      const R = B.readR(ctx);
      const sw = (P.switch || []).map(function (/** @type {any} */ s) { return s.on; });
      L.hurry = [];
      if (!L.started) {
        L.started = true;
        setNoblePlan(calc.bundlePlan(v, P.bundle), 'start', ctx);
        L.phase = S.l2.phase.initial;
      } else if (L.nobles.length) {
        // 받음: 계획에서 뺀다(필요 수는 남은 귀족 기준). 잃음: 상대가 데려감
        let lost = false;
        for (const id of L.nobles.slice()) {
          if (me.nobles.indexOf(id) >= 0) { L.nobles.splice(L.nobles.indexOf(id), 1); L.received.push(id); }
          else if (v.nobles.indexOf(id) < 0) { L.nobles.splice(L.nobles.indexOf(id), 1); lost = true; }
        }
        reneed();
        if (lost && !L.nobles.length && sw.indexOf('nobleTaken') >= 0) rebuild(v, ctx, R, 'nobleTaken');
      }
      // 경주 셈(6.5): 포기는 빼고, 서두름은 이번 차례만
      if (L.nobles.length) {
        const rc = calc.raceNobles(v, you(ctx), L.nobles, R, P.race);
        if (rc.drop.length) {
          L.nobles = L.nobles.filter(function (/** @type {string} */ id) { return rc.drop.indexOf(id) < 0; });
          reneed();
          host.emit({ type: 'l2race', turn: host.mem().turn.id, drop: rc.drop });
          if (!L.nobles.length && sw.indexOf('raceAbandon') >= 0) {
            rebuild(v, ctx, R, 'raceAbandon');
            if (L.nobles.length) L.hurry = calc.raceNobles(v, you(ctx), L.nobles, R, P.race).hurry;
          }
        }
        if (L.nobles.length && !L.hurry.length) L.hurry = rc.hurry.filter(function (/** @type {string} */ id) { return L.nobles.indexOf(id) >= 0; });
      }
    }
    /** @param {PlayerView} v @param {any} ctx @param {any} R @param {string} reason */
    function rebuild(v, ctx, R, reason) {
      const L = Lc();
      setNoblePlan(calc.rebuildNoblePlan(v, you(ctx), R, S.l2.plan), reason, ctx);
      L.rebuiltTurn = L.turnNo;
    }

    /** 이번 차례 목표 명세 name 의 첫 후보 id(차례 캐시). 재귀(isTarget 안의 isTarget)는 null @param {string} name @param {any} ctx */
    let inTop = false;
    function topOf(name, ctx) {
      const X = B.TL();
      const cache = X ? (X.topCache || (X.topCache = {})) : {};
      if (cache[name] !== undefined) return cache[name];
      if (inTop) return null;
      inTop = true;
      let t;
      try { t = host.runTarget(S.targets[name], ctx); } finally { inTop = false; }
      cache[name] = t ? t.card.id : null;
      return cache[name];
    }

    /** 4.3 조건 칸. 모르면 undefined @param {string} name @param {any} val @param {any} ctx @returns {boolean|undefined} */
    function cond(name, val, ctx) {
      const L = Lc();
      switch (name) {
        case 'planNoblesLeft': return L.nobles.length <= val;
        case 'hurry': return (L.hurry.length > 0) === val;
        case 'oppWinNext': return calc.oppWinNext(ctx.v, B.readR(ctx)) === val;
        case 'replannedThisTurn': return (L.rebuiltTurn === L.turnNo) === val;
        case 'boardShortColorNone': {
          const sc = shortNow(ctx);
          const none = !ctx.cards.some(function (/** @type {any} */ x) { return (x.source === 't1' || x.source === 't2') && sc.indexOf(x.card.bonus) >= 0; });
          return none === val;
        }
      }
      return undefined;
    }

    /** 6.1 차례 셈 + 실수 oneDiscountMiss(세 색 이상 비용 카드에서 보너스 있는 첫 색의 할인을 빼먹음). 굴림은 그런 카드를 처음 셀 때 한 번
     * hooks 의 turns() 가 needOf 대신 이 모자람을 쓰도록 부른다 @param {CardDef} card @param {any} ctx @param {any} N needOf 결과 */
    function discountMiss(card, ctx, N) {
      const X = B.TL();
      if (!X) return N;
      const c0 = calc.discountMissColor(card, bon(ctx));
      if (!c0) return N;
      if (X.rolls.oneDiscountMiss === undefined) {
        const e = host.mistakeEntry('oneDiscountMiss', ctx);
        X.rolls.oneDiscountMiss = e ? host.roll('oneDiscountMiss', ctx, e) : false;
      }
      if (!X.rolls.oneDiscountMiss) return N;
      const me = ctx.me;
      const before = Math.max(0, card.cost[c0] - me.bonuses[c0] - me.tokens[c0]);
      const after = Math.max(0, card.cost[c0] - me.tokens[c0]);
      const by = Object.assign({}, N.by);
      by[c0] += after - before;
      let total = 0;
      for (const c of C) total += by[c];
      const missing = C.filter(function (c) { return by[c] > 0; }).sort(function (a, b) { return by[b] - by[a] || C.indexOf(a) - C.indexOf(b); });
      return { by, total, missing };
    }

    /** 5.3 키(작을수록 앞). 모르면 undefined @param {string} k @param {any} x @param {any} ctx @returns {number|undefined} */
    function key(k, x, ctx) {
      const L = Lc();
      switch (k) {
        case 'hurryNoble': {
          for (const id of L.hurry) if (calc.nobleMissing(id, bon(ctx)).indexOf(x.card.bonus) >= 0) return 0;
          return 1;
        }
        case 'nearNoble': {
          const n = calc.nearNoble(ctx.v, L.nobles, bon(ctx));
          return n && calc.nobleMissing(n, bon(ctx)).indexOf(x.card.bonus) >= 0 ? 0 : 1;
        }
        case 'planColor': return planColors().indexOf(x.card.bonus) >= 0 ? 0 : 1;
      }
      return undefined;
    }

    /** 5.3 필터. 모르면 undefined @param {any} f @param {any} x @param {any} ctx @returns {boolean|undefined} */
    function filter(f, x, ctx) {
      if (f === 'shortColor') return shortNow(ctx).indexOf(x.card.bonus) >= 0;
      if (f && typeof f === 'object') {
        if (f.f === 'nobleWithin') return calc.nobleWithinColors(ctx.v, you(ctx), f.n).indexOf(x.card.bonus) >= 0;
        if (f.f === 'isTarget') { const id = topOf(f.of, ctx); return id !== null && id === x.card.id; }
      }
      return undefined;
    }

    /** 2.4 reserveDeck: tiers 순서로 legal 한 덱 예약 @param {any} rule @param {any} ctx @returns {Move|null|undefined} */
    function rule(rule, ctx) {
      if (rule.do !== 'reserveDeck') return undefined;
      for (const t of rule.tiers || [2, 1]) {
        const m = ctx.legal.find(function (/** @type {any} */ y) { return y.type === 'reserveDeck' && y.tier === t; });
        if (m) return m;
      }
      return null;
    }

    /** 2.5 pair 'hurry': 한 색만 2개 이상 모자람 → 그 색, 아니면 서두름 귀족의 모자란 색이 목표에 2개 이상 모자람 → 그 색(모자란 수 큰 순)
     * @param {any} mode @param {any} N @param {Color[]} missing @param {any} ctx @returns {Color|null|undefined} */
    function pair(mode, N, missing, ctx) {
      if (mode.pair !== 'hurry') return undefined;
      const L = Lc();
      if (missing.length === 1 && N.by[missing[0]] >= 2 && host.legalTake2(ctx, missing[0])) return missing[0];
      /** @type {Color[]} */
      const hc = [];
      for (const id of L.hurry) for (const c of calc.nobleMissing(id, bon(ctx))) if (hc.indexOf(c) < 0) hc.push(c);
      for (const c of missing) if (hc.indexOf(c) >= 0 && N.by[c] >= 2 && host.legalTake2(ctx, c)) return c;
      return null;
    }

    /** 2.5 fill 'nobleNeed': 계획 색 중 필요 수까지 남은 수 큰 순(같으면 색 순서)으로 0,1,2…, 그 밖 99 @param {string} name @param {Color} c @param {any} ctx @returns {number|undefined} */
    function fillRank(name, c, ctx) {
      if (name !== 'nobleNeed') return undefined;
      const L = Lc();
      if (!L.need || !L.nobles.length) return 99;
      const b = bon(ctx);
      const need = L.need;
      const list = C.filter(function (q) { return need[q] - b[q] > 0; }).sort(function (a, q) { return (need[q] - b[q]) - (need[a] - b[a]) || C.indexOf(a) - C.indexOf(q); });
      const i = list.indexOf(c);
      return i < 0 ? 99 : i;
    }

    /** 2.6 반납 order(작을수록 먼저 돌려줌). 황금은 늘 맨 뒤 @param {string} name @param {string} c @returns {number|undefined} */
    function orderRank(name, c) {
      if (name === 'offPlanFirst') return c === 'gold' ? 9 : planColors().indexOf(/** @type {Color} */ (c)) >= 0 ? 1 : 0;
      if (name === 'colorRev') return c === 'gold' ? 9 : -C.indexOf(/** @type {Color} */ (c));
      return undefined;
    }

    /** 2.7 귀족 look 'plan': 받을 수 있는 귀족 중 받지 않은 계획 귀족이 있으면 참 @param {string} kind @param {string[]} claimable @returns {boolean|undefined} */
    function look(kind, claimable) {
      if (kind !== 'plan') return undefined;
      const L = Lc();
      return claimable.some(function (id) { return L.nobles.indexOf(id) >= 0; });
    }
    /** 'plan' 계기에서 받을 수 있는 계획 귀족만 @param {string[]} claimable */
    function planClaims(claimable) { const L = Lc(); return claimable.filter(function (id) { return L.nobles.indexOf(id) >= 0; }); }

    /** 2.7 prefer 정렬(받을 귀족 id 를 앞에서부터). near: 계획 귀족 중 차례 시작 보너스로 남은 장수가 적었던 것(같으면 4·4 → 왼쪽) 앞
     * @param {string[]} ids @param {string[]} prefer @param {PlayerView} v @param {Record<string, number>} bonusesAtStart @returns {string[]} */
    function preferSort(ids, prefer, v, bonusesAtStart) {
      const L = Lc();
      const rank = function (/** @type {string} */ id) {
        /** @type {number[]} */
        const r = [];
        for (const p of prefer) {
          if (p === 'near' || p === 'plan') {
            const inPlan = L.nobles.indexOf(id) >= 0 || L.planNobles.indexOf(id) >= 0;
            if (p === 'plan') r.push(inPlan ? 0 : 1);
            else r.push(inPlan ? calc.nobleLeft(id, bonusesAtStart) * 2 + (calc.nobleColorsOf(id).length === 2 ? 0 : 1) : 999);
          } else if (p === 'left') r.push(v.nobles.indexOf(id));
        }
        return r;
      };
      return ids.slice().sort(function (a, b) {
        const ra = rank(a);
        const rb = rank(b);
        for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
        return v.nobles.indexOf(a) - v.nobles.indexOf(b);
      });
    }

    /** prefer 'near' 의 정렬 값: 계획 귀족(받은 것 포함)은 차례 시작 보너스로 센 남은 장수(같으면 4·4 앞), 그 밖 999 @param {string} id */
    function nearRank(id) {
      const L = Lc();
      if (L.nobles.indexOf(id) < 0 && L.planNobles.indexOf(id) < 0) return 999;
      const b0 = host.mem().turn.bonusesAtStart;
      return calc.nobleLeft(id, b0) * 2 + (calc.nobleColorsOf(id).length === 2 ? 0 : 1);
    }

    return { planPart, cond, key, filter, rule, pair, fillRank, orderRank, look, planClaims, preferSort, nearRank, discountMiss, planColors, shortNow, topOf };
  }

  /** 검사(5.6) 중 수집형 칸. hooks.validate 가 부른다 @param {any} s @param {string[]} errs */
  function validate(s, errs) {
    const P = s.l2 && s.l2.plan;
    if (P && P.kind === 'nobleBundle') {
      const b = P.bundle;
      if (!(b && Number.isInteger(b.maxColors) && b.maxColors >= 1 && typeof b.single === 'boolean')) errs.push('l2.plan.bundle: {maxColors(정수), single(참/거짓)} 여야 합니다');
      const r = P.race;
      if (!(r && Number.isInteger(r.hurryLead) && Number.isInteger(r.abandonLead) && r.abandonLead > r.hurryLead)) errs.push('l2.plan.race: {hurryLead, abandonLead} 정수, abandonLead > hurryLead 여야 합니다');
      if (!(Number.isInteger(P.replanWithin) && P.replanWithin >= 0)) errs.push('l2.plan.replanWithin: 0 이상의 정수여야 합니다');
      if (P.goal !== undefined || P.replanTarget !== undefined) errs.push("l2.plan: nobleBundle 은 목표 카드가 없어 goal·replanTarget 을 쓰지 않습니다");
      for (const sw of P.switch || []) if (sw && ['raceAbandon', 'nobleTaken'].indexOf(sw.on) < 0) errs.push("l2.plan.switch: nobleBundle 의 계기는 'raceAbandon'·'nobleTaken' 뿐입니다 (" + (sw && sw.on) + ')');
    } else if (P) {
      for (const k of ['bundle', 'race', 'replanWithin']) if (P[k] !== undefined) errs.push('l2.plan.' + k + ": kind 'nobleBundle' 에서만 씁니다");
      for (const sw of P.switch || []) if (sw && (sw.on === 'raceAbandon' || sw.on === 'nobleTaken')) errs.push('l2.plan.switch: ' + sw.on + " 은 kind 'nobleBundle' 에서만 씁니다");
    }
    const targets = s.targets || {};
    /** @param {any} f @param {string} at */
    const chkF = function (f, at) {
      if (!f || typeof f !== 'object') return;
      if (f.f === 'isTarget') {
        if (typeof f.of !== 'string' || !targets[f.of]) errs.push(at + '.isTarget.of: targets 에 없는 이름 ' + f.of);
        else if (JSON.stringify(targets[f.of]).indexOf('"isTarget"') >= 0) errs.push(at + '.isTarget.of: 가리키는 명세 안에 isTarget 을 쓸 수 없습니다');
      }
      if (f.f === 'nobleWithin' && !(Number.isInteger(f.n) && f.n >= 1)) errs.push(at + '.nobleWithin.n: 1 이상의 정수여야 합니다');
      if (f.f === 'any' && Array.isArray(f.of)) for (const g of f.of) chkF(g, at);
      if (f.f === 'not') chkF(f.of, at);
    };
    for (const field of ['picks', 'targets']) {
      const o = s[field] || {};
      for (const name of Object.keys(o)) ((o[name] && o[name].stages) || []).forEach(function (/** @type {any} */ st, /** @type {number} */ i) {
        for (const f of (st && st.filter) || []) chkF(f, field + '.' + name + '.stages[' + i + '].filter');
      });
    }
    (s.act || []).forEach(function (/** @type {any} */ r, /** @type {number} */ i) {
      if (r && r.do === 'reserveDeck') {
        if (!Array.isArray(r.tiers) || !r.tiers.length || r.tiers.some(function (/** @type {any} */ t) { return [1, 2, 3].indexOf(t) < 0; })) errs.push('act[' + i + '].tiers: 1·2·3 의 비지 않은 배열이어야 합니다');
      }
    });
  }

  Z.botsL2 = Z.botsL2 || {};
  Z.botsL2.collector = { VOCAB, mixin, validate };
})();
