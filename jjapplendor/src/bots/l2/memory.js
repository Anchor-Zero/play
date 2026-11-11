// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 둘째 층 ① 사건과 기억 (Zap.botsL2.memory)
 *
 * docs/ai/framework-l2.md 7절의 기억 mem.l2 의 모양과 갱신. 차례를 넘는 목표 카드는 초보 기억 mem.plan(초보 틀 11.4)을 그대로 쓰고,
 * 여기에는 목표에서 끌어낸 색·단계·다시 세운 기록처럼 카드 한 장으로 담기지 않는 것만 둔다(7.1).
 * l2 가 없는 값 파일에서는 만들지도 갱신하지도 않는다(engine.js 가 부르지 않는다). rng 를 부르지 않는다.
 * 지금 채우는 칸은 중수 신중형이 쓰는 것과 사건 기록(oppLog·oppDeckReserved)뿐이다. 맞수(rivals)·마름 셈(dryTurns)·
 * 서두름(hurry)·덱 블라인드(blindUsed)·견제 연속(blockStreak)·놓친 귀족(nobleLateIds)·직전 최상위(lastTopId)는 자리만 두고 쓰지 않는다.
 */
(function () {
  'use strict';
  const Z = /** @type {any} */ (Zap);

  /** @param {'build'|'score'|'wait'} initialPhase */
  function newMem(initialPhase) {
    return {
      turnNo: 0,
      /** P 가 마지막으로 정한 목표 카드 id(엔진이 mem.plan 을 비운 까닭을 다음 P 가 알아내는 데 쓴다) @type {string|null} */
      planId: null,
      /** @type {{main:Color, second:Color|null, base:Color[]}|null} */
      colors: null,
      /** @type {string[]} */
      nobles: [],
      /** @type {'build'|'score'|'wait'} */
      phase: initialPhase,
      /** @type {{turn:number, reason:string, cardId:string|null}[]} 최근 6 개 */
      replans: [],
      /** @type {string[]} */
      excluded: [],
      /** @type {string[]} 지난 내 차례 시작 이후 새로 깔린 공개 카드 */
      newIds: [],
      /** @type {Record<string, number>|null} */
      prevSupply: null,
      /** @type {Record<number, {bought:string[], reservedPublic:string[], reservedDeck:number[], took:Record<string, number>}>} */
      oppLog: {},
      /** @type {Record<number, number[]>} */
      oppDeckReserved: {},
      /** S4: 이 차례 번호(turnNo)까지 closerT3·better 계기를 끈다 */
      pingPongUntil: 0,
      /** 지난 내 차례 끝에 claimable 인데 받지 않은 귀족(조건 nobleLate) @type {string[]} */
      nobleLateIds: [],
      /** 계기 drawnT3 가 이미 본, 덱에서 뽑은 내 3단계 예약 카드 @type {string[]} */
      drawnSeen: [],
    };
  }
  /** @typedef {ReturnType<typeof newMem>} L2Mem */

  /** D0: 사건마다(내 차례가 아니어도). 남의 산 카드·공개 예약·덱 예약 단계·집은 색 @param {L2Mem} L @param {any[]} evs @param {number} you */
  function onEvents(L, evs, you) {
    for (const e of evs) {
      if (!e || typeof e.seat !== 'number' || e.seat === you) continue;
      const s = e.seat;
      const log = L.oppLog[s] || (L.oppLog[s] = { bought: [], reservedPublic: [], reservedDeck: [], took: {} });
      if (e.type === 'buy') {
        log.bought.push(e.cardId);
        if (e.fromReserve && L.oppDeckReserved[s] && L.oppDeckReserved[s].length) {
          const c = Z.data.cardsById[e.cardId];
          const i = c ? L.oppDeckReserved[s].indexOf(c.tier) : -1;
          if (i >= 0) L.oppDeckReserved[s].splice(i, 1);
        }
      } else if (e.type === 'reserve') {
        if (e.fromDeck) { log.reservedDeck.push(e.tier); (L.oppDeckReserved[s] || (L.oppDeckReserved[s] = [])).push(e.tier); }
        else if (e.cardId) log.reservedPublic.push(e.cardId);
      } else if (e.type === 'take') {
        for (const c of Object.keys(e.tokens || {})) log.took[c] = (log.took[c] || 0) + (e.tokens[c] || 0);
      }
    }
  }

  /** P 시작: 차례 번호와 새로 깔린 카드 @param {L2Mem} L @param {string[]|null} boardPrev @param {string[]} boardNow */
  function onTurnStart(L, boardPrev, boardNow) {
    L.turnNo += 1;
    L.newIds = boardPrev ? boardNow.filter(function (id) { return boardPrev.indexOf(id) < 0; }) : [];
  }

  /** P 끝: 다음 차례 판정용 사진, 사건 기록 비움 @param {L2Mem} L @param {PlayerView} v */
  function onPlanEnd(L, v) {
    L.prevSupply = Object.assign({}, v.supply);
    L.oppLog = {};
  }

  /** 다시 세운 기록(최근 6 개) @param {L2Mem} L @param {string} reason @param {string|null} cardId */
  function noteReplan(L, reason, cardId) {
    L.replans.push({ turn: L.turnNo, reason, cardId });
    if (L.replans.length > 6) L.replans.shift();
  }

  Z.botsL2 = Z.botsL2 || {};
  Z.botsL2.memory = { newMem, onEvents, onTurnStart, onPlanEnd, noteReplan };
})();
