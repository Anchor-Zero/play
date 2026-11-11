// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 둘째 층 ③ 계획·단계 (Zap.botsL2.plan)
 *
 * docs/ai/framework-l2.md 2.2 planStep 의 ③④ 와 2.3 makePlan·firstSwitch·replan, 8절 S4.
 * P 는 수를 고르지 않는다. D1 에서 쓸 사실(목표 카드·색·단계)을 정해 두고, 이번 차례에 무엇을 할지는 여전히 값 파일의 act 가 정한다.
 *
 * 지금 구현한 것: 계획 종류 goalCard(와 계획 없음 'none'), 계기 planGone·planBought·closerT3(+tie·newCardOptimism)·planColorDry·rivalBoughtMain·drawnT3(충동형),
 * 곁다리 귀족(sideNoble, 사라지면 새로 정함), 실수 phaseCarry, 단계 build·score 의 전환(toScore)과
 * 되돌아가기(back), 다시 판정(rejudge), S4 왕복 잠금. 구현하지 않은 것(검사가 거부한다): nobleBundle·rolling·reservedAnchor, 곁다리 귀족,
 * 계기 better·planColorDry·planDryTurns·swapStreak·rivalBoughtMain·raceAbandon·nobleTaken, 기다림 단계, 태세, 경주 셈, 실수 phaseCarry·newCardOptimism.
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
