// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 둘째 층 ② 순수 계산 (Zap.botsL2.calc)
 *
 * docs/ai/framework-l2.md 6절의 공용 계산 가운데 중수 신중형이 쓰는 것과, 같은 뼈대로 이어 쓸 것만 둔다.
 * 모두 view·자리·값만 받는 순수 함수다(입력을 바꾸지 않고 rng 를 부르지 않는다). 굴림 실수의 결과는 인자로 받는다.
 * 게임을 앞으로 진행해 보는 계산은 없다: 카드 한 장마다 '모자란 것'을 세고 그것을 3·2 로 나눈 어림뿐이다.
 * 상대 자리는 view 의 공개 칸(점수·보너스·토큰)만 읽고, 상대 예약 칸은 어디에도 넣지 않는다(read.reserved 미구현).
 */
/** 둘째 층 파일들이 보는 고르기 후보(engine.js 의 BotCand 와 같은 꼴)
 * @typedef {{card:CardDef, source:'t1'|'t2'|'t3'|'reserved', tier:Tier, slot:number, buy:boolean, move?:Move, payTotal?:number, payGold?:number}} L2Cand */
(function () {
  'use strict';
  const Z = /** @type {any} */ (Zap);
  const INF = 99;

  /** @returns {Color[]} */
  function colors() { return Z.data.COLORS; }

  /** 색별 0 @returns {Record<string, number>} */
  function zero5() { const o = {}; for (const c of colors()) /** @type {any} */ (o)[c] = 0; return o; }

  /** 6.1 needReal: 보너스·토큰을 빼고 남은 모자람에서 황금을 가장 큰 색부터 하나씩 뺀다
   * @param {CardDef} card @param {{tokens:Record<string, number>, bonuses:Record<string, number>, gold:number}} P
   * @returns {{by:Record<string, number>, total:number, missing:Color[]}} */
  function needReal(card, P) {
    const C = colors();
    /** @type {Record<string, number>} */
    const by = {};
    for (const c of C) by[c] = Math.max(0, card.cost[c] - (P.bonuses[c] || 0) - (P.tokens[c] || 0));
    let g = P.gold || 0;
    while (g > 0) {
      /** @type {Color|null} */
      let best = null;
      for (const c of C) if (by[c] > 0 && (best === null || by[c] > by[best])) best = c;
      if (best === null) break;
      by[best]--; g--;
    }
    let total = 0;
    for (const c of C) total += by[c];
    const missing = C.filter(function (c) { return by[c] > 0; }).sort(function (a, b) { return by[b] - by[a] || C.indexOf(a) - C.indexOf(b); });
    return { by, total, missing };
  }

  /** 6.1 turnsTo: 모자람 N 에서 '몇 차례면 사는가'. 공급처를 넣으면 마른 색은 INF
   * @param {{by:Record<string, number>, total:number, missing:Color[]}} N @param {{turns:string, supply:boolean}} count
   * @param {Record<string, number>|null} supply null 이면 공급처를 넣지 않는다 */
  function turnsOf(N, count, supply) {
    if (N.total === 0) return 0;
    let M = 0;
    for (const c of N.missing) if (N.by[c] > M) M = N.by[c];
    let h = count.turns === 'sum3half' ? Math.ceil(M / 2) : count.turns === 'sum3full' ? M : 0;
    if (count.supply && supply) {
      for (const c of N.missing) {
        if (supply[c] === 0) return INF;
        if (N.by[c] >= 2 && supply[c] < 4) h = Math.max(h, N.by[c]);
        if (supply[c] < N.by[c]) h = Math.max(h, N.by[c]);
      }
    }
    return Math.max(Math.ceil(N.total / 3), h);
  }

  /** 비용이 가장 큰 색(같으면 색 순서) @param {CardDef} card @returns {Color} */
  function mainCostColor(card) {
    const C = colors();
    let best = C[0];
    for (const c of C) if (card.cost[c] > card.cost[best]) best = c;
    return best;
  }

  /** 2.3 colorsOf: 목표 카드에서 주·보조·바탕 색
   * @param {CardDef} card @param {'cost2'|'cost2OrBonus'|'cost3only'|'none'} second
   * @returns {{main:Color, second:Color|null, base:Color[]}} */
  function colorsOf(card, second) {
    const C = colors();
    const main = mainCostColor(card);
    /** @type {Color|null} */
    let c2 = null;
    for (const c of C) if (c !== main && card.cost[c] > 0 && (c2 === null || card.cost[c] > card.cost[c2])) c2 = c;
    /** @type {Color|null} */
    let sec = null;
    if (second === 'cost2') sec = c2;
    else if (second === 'cost2OrBonus') sec = c2 !== null ? c2 : (card.bonus !== main ? card.bonus : null);
    else if (second === 'cost3only') sec = c2 !== null && card.cost[c2] === 3 ? c2 : null;
    return { main, second: sec, base: C.filter(function (c) { return c !== main && c !== sec; }) };
  }

  /** 비용 꼴: 큰 순으로 '-' 로 이음(예 '7-3') @param {CardDef} card */
  function costShape(card) {
    return colors().map(function (c) { return card.cost[c]; }).filter(function (n) { return n > 0; }).sort(function (a, b) { return b - a; }).join('-');
  }

  /** 적힌 비용 합 ÷ 점수(점수 0 이면 맨 뒤) @param {CardDef} card */
  function gemsPerPoint(card) {
    let s = 0;
    for (const c of colors()) s += card.cost[c];
    return card.points > 0 ? s / card.points : 1000 + s;
  }

  /** 카드의 주 비용 색을 조건에 가진 공개 귀족 수 @param {PlayerView} v @param {CardDef} card */
  function mainInNobles(v, card) {
    const m = mainCostColor(card);
    let n = 0;
    for (const id of v.nobles) { const nb = Z.data.noblesById[id]; if (nb && nb.require[m] > 0) n++; }
    return n;
  }

  /** @param {Record<string, number>} b @param {any} nb */
  function meets(b, nb) {
    for (const c of colors()) if ((b[c] || 0) < nb.require[c]) return false;
    return true;
  }

  /** 이 카드의 보너스 한 장으로 새로 채워지는 공개 귀족(view.nobles 순서) @param {PlayerView} v @param {number} you @param {CardDef} card
   * @param {string[]|null} only null 이면 모든 귀족, 아니면 그 id 만 @returns {string[]} */
  function nobleCompletions(v, you, card, only) {
    const b = v.players[you].bonuses;
    /** @type {Record<string, number>} */
    const after = {};
    for (const c of colors()) after[c] = b[c] + (card.bonus === c ? 1 : 0);
    const out = [];
    for (const id of v.nobles) {
      if (only && only.indexOf(id) < 0) continue;
      const nb = Z.data.noblesById[id];
      if (nb && !meets(/** @type {any} */ (b), nb) && meets(after, nb)) out.push(id);
    }
    return out;
  }

  /** 6.2 gainOf: 점수 + (귀족이 차면 3, 한 번) @param {PlayerView} v @param {number} you @param {CardDef} card @param {string[]|null} only */
  function gainOf(v, you, card, only) {
    return card.points + (nobleCompletions(v, you, card, only).length ? 3 : 0);
  }

  /** 6.7 gaps: 빈칸(전환 모양에서 모자란 자리)과 빈칸 순서
   * @param {PlayerView} v @param {number} you @param {{main:Color, second:Color|null, base:Color[]}|null} cols
   * @param {{main:number, second?:number, base?:number}} shape @returns {{c:Color, rank:number}[]} */
  function gaps(v, you, cols, shape) {
    if (!cols) return [];
    const b = v.players[you].bonuses;
    /** @type {{c:Color, rank:number}[]} */
    const list = [];
    if (b[cols.main] < shape.main) list.push({ c: cols.main, rank: 0 });
    if (cols.second && b[cols.second] < (shape.second || 0)) list.push({ c: cols.second, rank: 1 });
    const C = colors();
    /** @type {Record<string, number>} */
    const inN = {};
    for (const c of C) inN[c] = 0;
    for (const id of v.nobles) { const nb = Z.data.noblesById[id]; if (nb) for (const c of C) if (nb.require[c] > 0) inN[c]++; }
    const bases = cols.base.slice().sort(function (a, c) { return inN[c] - inN[a] || v.supply[c] - v.supply[a] || C.indexOf(a) - C.indexOf(c); });
    bases.forEach(function (c, i) { if (b[c] < (shape.base || 0)) list.push({ c, rank: 2 + i }); });
    return list;
  }

  /** 계획 모양이 섰는가(조건 shapeMet) @param {PlayerView} v @param {number} you @param {{main:Color, second:Color|null, base:Color[]}|null} cols
   * @param {{main:number, second?:number, base?:number}} shape */
  function shapeMet(v, you, cols, shape) {
    if (!cols) return false;
    const b = v.players[you].bonuses;
    if (b[cols.main] < shape.main) return false;
    if (shape.second !== undefined && cols.second && b[cols.second] < shape.second) return false;
    if (shape.base !== undefined) for (const c of cols.base) if (b[c] < shape.base) return false;
    return true;
  }

  /** 6.3 readOpponents: 상대마다 '다음 차례에 살 수 있는가'를 셀 재료. 지금은 read.bonus·tokens 가 'always'·'never' 만
   * @param {PlayerView} v @param {number} you @param {{bonus:string, tokens:string, gold:boolean}} read @param {Record<number, boolean>} goldMiss 자리 → 실수 oppGoldMiss 맞음
   * @param {Record<number, boolean>} [open] 자리 → read 'trigger' 의 계기가 섰음(6.3 triggerOpen)
   * @returns {{seats:{seat:number, score:number, seeB:boolean, seeT:boolean, P:{tokens:Record<string, number>, bonuses:Record<string, number>, gold:number}, reservedCards:string[]}[], leader:number|null}} */
  function readOpponents(v, you, read, goldMiss, open) {
    const n = v.numPlayers;
    const seats = [];
    /** @type {number|null} */
    let leader = null;
    for (let k = 1; k < n; k++) {
      const s = (you + k) % n;      // 나 다음에 먼저 두는 자리부터(동점이면 앞선 것이 선두)
      const p = v.players[s];
      const op = !!(open && open[s]);
      const seeB = read.bonus === 'always' || (read.bonus === 'trigger' && op);
      const seeT = read.tokens === 'always' || (read.tokens === 'trigger' && op);
      /** @type {Record<string, number>} */
      const tok = zero5();
      if (seeT) for (const c of colors()) tok[c] = /** @type {any} */ (p.tokens)[c];
      const gold = seeT && read.gold && !goldMiss[s] ? p.tokens.gold : 0;
      seats.push({ seat: s, score: p.score, seeB, seeT, P: { tokens: tok, bonuses: seeB ? Object.assign({}, p.bonuses) : zero5(), gold }, reservedCards: [] });
      if (leader === null || p.score > v.players[leader].score) leader = s;
    }
    return { seats, leader };
  }

  /** 6.3 oppCanBuy @param {{seeB:boolean, seeT:boolean, P:any}} r @param {CardDef} card */
  function oppCanBuy(r, card) { return (r.seeT || r.seeB) ? needReal(card, r.P).total === 0 : false; }

  /** 6.6 endgameFacts (horizon 은 'fixed'·'byScore'·'none') @param {PlayerView} v @param {number} you @param {{horizon:{kind:string, n?:number}}} endgame */
  function endgameFacts(v, you, endgame) {
    let oppMax = 0;
    for (let s = 0; s < v.numPlayers; s++) if (s !== you && v.players[s].score > oppMax) oppMax = v.players[s].score;
    const myScore = v.players[you].score;
    const h = endgame.horizon;
    // byScore(충): 인간상 3절 '누군가(자기 포함) 12점 이상' → 그 점수로 어림(13+ → 1, 12 → 2)
    const horizon = h.kind === 'fixed' ? /** @type {number} */ (h.n) : h.kind === 'byScore' ? horizonByScore(Math.max(oppMax, myScore)) : INF;
    return { myScore, oppMax, anyMax: Math.max(oppMax, myScore), horizon };
  }

  /** 6.6 seatsStillToPlay @param {PlayerView} v @returns {number[]|null} */
  function seatsStillToPlay(v) {
    if (v.finalRoundBy === null) return null;
    const n = v.numPlayers;
    const last = (v.firstPlayer - 1 + n) % n;
    const out = [];
    let s = v.current;
    while (s !== last) { s = (s + 1) % n; out.push(s); }
    return out;
  }

  /* ── 중수 충동형이 더한 것 ── */
  /** 귀족 하나의 모자란 카드 수(초보 7절 nobleShort) @param {Record<string, number>} b @param {any} nb */
  function nobleShort(b, nb) {
    let s = 0;
    for (const c of colors()) s += Math.max(0, nb.require[c] - (b[c] || 0));
    return s;
  }

  /** 2.3 sideNoble: 조건에 main 이 든 공개 귀족 중 모자람이 가장 작은 것(같으면 왼쪽). 없으면 null
   * @param {PlayerView} v @param {number} you @param {Color} main @returns {string|null} */
  function sideNoble(v, you, main) {
    const b = v.players[you].bonuses;
    /** @type {string|null} */
    let best = null;
    let bs = INF;
    for (const id of v.nobles) {
      const nb = Z.data.noblesById[id];
      if (!nb || !(nb.require[main] > 0)) continue;
      const s = nobleShort(/** @type {any} */ (b), nb);
      if (s < bs) { bs = s; best = id; }
    }
    return best;
  }

  /** 계획 귀족 조건 중 내 보너스가 못 미친 색(fill sideNoble) @param {PlayerView} v @param {number} you @param {string[]} ids @returns {Color[]} */
  function nobleGapColors(v, you, ids) {
    const b = v.players[you].bonuses;
    /** @type {Color[]} */
    const out = [];
    for (const id of ids) {
      if (v.nobles.indexOf(id) < 0) continue;
      const nb = Z.data.noblesById[id];
      if (!nb) continue;
      for (const c of colors()) if (nb.require[c] > b[c] && out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }

  /** 6.2 payReal: 살 카드면 제안의 지불 합, 아니면 Σmax(0, 비용 − 보너스) @param {PlayerView} v @param {number} you @param {{card:CardDef, buy:boolean, payTotal?:number}} x */
  function payReal(v, you, x) {
    if (x.buy) return /** @type {number} */ (x.payTotal);
    const b = v.players[you].bonuses;
    let s = 0;
    for (const c of colors()) s += Math.max(0, x.card.cost[c] - b[c]);
    return s;
  }

  /** 필터 payPerPoint: 점수 ≥ 1 이고 지불 ≤ 점수 × k @param {PlayerView} v @param {number} you @param {any} x @param {number} k */
  function payPerPoint(v, you, x, k) { return x.card.points >= 1 && payReal(v, you, x) <= x.card.points * k; }

  /** 키 feelCost: 실제 지불 − 점수 @param {PlayerView} v @param {number} you @param {any} x */
  function feelCost(v, you, x) { return payReal(v, you, x) - x.card.points; }

  /** 키 stepStones: 카드의 주 비용 색 보너스를 주는 1·2단계 공개 카드 수 @param {PlayerView} v @param {CardDef} card @param {Color} main 그 카드의 주 비용 색 */
  function stepStonesOf(v, card, main) {
    let n = 0;
    for (const t of [1, 2]) for (const id of v.market[/** @type {Tier} */ (t)]) { if (id && id !== card.id && Z.data.cardsById[id].bonus === main) n++; }
    return n;
  }

  /** 필터 stepStone: 1·2단계, 보너스가 주 색이고 주 색 보너스 < shape.main (또는 보조 색이고 < shape.second)
   * @param {PlayerView} v @param {number} you @param {{card:CardDef, tier:number}} x @param {{main:Color, second:Color|null}|null} cols @param {{main:number, second?:number}} shape */
  function isStepStone(v, you, x, cols, shape) {
    if (!cols || x.tier > 2) return false;
    const b = v.players[you].bonuses;
    if (x.card.bonus === cols.main) return b[cols.main] < shape.main;
    if (cols.second && shape.second !== undefined && x.card.bonus === cols.second) return b[cols.second] < shape.second;
    return false;
  }

  /** 필터 missingDry: 정확히 1 개 모자라고 그 색 공급처가 0 @param {{by:Record<string, number>, total:number, missing:Color[]}} N @param {Record<string, number>} supply */
  function missingDry(N, supply) { return N.total === 1 && N.missing.length === 1 && supply[N.missing[0]] === 0; }

  /** 6.6 horizon byScore: 기준 점수 ≥ 13 → 1, ≥ 12 → 2, 아니면 INF @param {number} score */
  function horizonByScore(score) { return score >= 13 ? 1 : score >= 12 ? 2 : INF; }

  /** 6.3 triggerOpen(충): 이 상대가 지난 내 차례 이후 내 목표 주 색 보너스 카드를 샀는가
   * @param {{bought:string[]}|undefined} log oppLog[s] @param {Color|null} main */
  function boughtColor(log, main) {
    if (!log || !main) return false;
    return log.bought.some(function (id) { const c = Z.data.cardsById[id]; return !!c && c.bonus === main; });
  }

  /** 6.3 oppLeft: 보너스만으로 센 남은 비용 @param {Record<string, number>} bonuses @param {CardDef} card */
  function oppLeft(bonuses, card) {
    let s = 0;
    for (const c of colors()) s += Math.max(0, card.cost[c] - (bonuses[c] || 0));
    return s;
  }

  /** 실수 newCardOptimism 의 낙관 셈: ceil(T/3) 만 @param {{total:number}} N */
  function turnsOptimistic(N) { return Math.ceil(N.total / 3); }

  /** 실수 newCardOptimism 을 굴릴 장면: 한 색 모자람이 4 이상 @param {{by:Record<string, number>, missing:Color[]}} N */
  function heavyOneColor(N) { return N.missing.some(function (c) { return N.by[c] >= 4; }); }

  /** 내 예약 칸의 덱에서 뽑은 3단계 카드 중 아직 본 적 없는 것 @param {PlayerView} v @param {number} you @param {string[]} seen @returns {string[]} */
  function newDrawnT3(v, you, seen) {
    const out = [];
    for (const r of v.players[you].reserved) {
      const x = /** @type {any} */ (r);
      if (x && typeof x.id === 'string' && x.fromDeck && seen.indexOf(x.id) < 0) { const c = Z.data.cardsById[x.id]; if (c && c.tier === 3) out.push(x.id); }
    }
    return out;
  }

  Z.botsL2 = Z.botsL2 || {};
  Z.botsL2.calc = {
    INF, needReal, turnsOf, mainCostColor, colorsOf, costShape, gemsPerPoint, mainInNobles, nobleCompletions, gainOf,
    gaps, shapeMet, readOpponents, oppCanBuy, endgameFacts, seatsStillToPlay,
    nobleShort, sideNoble, nobleGapColors, payReal, payPerPoint, feelCost, stepStonesOf, isStepStone, missingDry,
    horizonByScore, boughtColor, oppLeft, turnsOptimistic, heavyOneColor, newDrawnT3,
  };
})();
