// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 한 장 집착형 (그 카드만 보는 사람)
 *
 * 근거: docs/ai/personas/beginner-fixated.md. 형식과 항목의 뜻: docs/ai/framework.md(11-11 추가분 포함)와
 * docs/ai/framework-b2.md. 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes-b2.md.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  bots.register({
    id: 'beginner-fixated',
    label: '초보 · 한 장 집착형',
    desc: '맨 위 줄의 큰 카드 한 장을 정하면 살 때까지 그 색만 모읍니다. 다른 카드는 손이 꽉 찼을 때만 삽니다.',
    level: 'beginner',
    temper: 'fixated',
    seatName: '한 장 집착형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음). 3=상 2=중 1=하 0=없음
    pulls: {
      planHold: 3, pickPlanFirst: 3, pairTopAny: 3, reservePlan: 2, shedBuy: 2, swapTake: 2,
      gateNow: 0, pickMinPay: 0, pickLowColor: 0, gateFull: 0, lastFlush: 0, aimBig: 0,
    },
    // 결과로만: 손이 9~10개로 찬 모양, 단색 7을 노리는 고효율 직행 모양
    shapes: ['tokenHoard', 'directRush'],
    // 기질 때문에 치르는 값(실수가 아님): 대상 밖 점수 포기, 대상 색 더미를 혼자 말림
    prices: ['passLitPoints', 'drainOwnColor'],
    // 대상 색 기다리기(바꿔 집기)는 이 사람이 의도한 수(4절). 털기 구매의 0점·비싼 카드는 실수 10
    roles: { swapTake: 'strategy', swapRepeat: 'strategy', cheapLoop: 'mistake', lowValueBuy: 'mistake' },

    // 대상의 모자람은 토큰과 황금으로만 센다(보너스는 빼지 않음: 실수 7, 내장)
    perception: { target: { bonus: false, gold: true }, held: { bonus: false } },
    avoid: [],

    picks: {
      // 대상이 켜지면 무엇보다 먼저(황금 제안도 그대로)
      plan: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], filter: ['plan'], accept: 'any', keys: ['reading'] }] },
      // 털기 구매: 대상이 아닌 공개 카드, 지불에 대상 색·황금 없음, 토큰 1개 이상. 많이 내는 것 → 점수 → 읽는 순서
      shed: { stages: [{ from: ['t3', 't2', 't1'], filter: ['notPlan', 'payAvoidsPlan', 'paid'], keys: ['paymentHigh', 'points'] }] },
      // 공급처 바닥의 마지막 수와 안전장치의 끊기: 대상 색 토큰을 가장 적게 내는 켜진 카드
      leastPlanPay: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], accept: 'any', keys: ['planColorPay'] }] },
    },

    targets: {
      // 대상 고르기: 3단계에서 칩 색 수 적은 것 → 총 모자람 → 점수 → 읽는 순서. 3단계 줄이 비면 2단계
      pickT: {
        stages: [
          { from: ['t3'], keys: ['costColors', 'need', 'points'] },
          { from: ['t2'], keys: ['costColors', 'need', 'points'] },
        ],
      },
      // 잃은 뒤 고르기(빼앗긴 차례에만): 총 모자람 → 칩 색 수 → 점수 → 읽는 순서
      lostT: {
        stages: [
          { from: ['t3'], keys: ['need', 'costColors', 'points'] },
          { from: ['t2'], keys: ['need', 'costColors', 'points'] },
        ],
      },
      // 집기의 목표는 언제나 지금의 대상(판 위든 예약 칸이든)
      planT: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], filter: ['plan'], accept: 'any', keys: ['reading'] }] },
    },

    act: [
      // 순서 2: 대상이 없으면 새로 고른다(빼앗긴 직후면 잃은 뒤 고르기)
      { do: 'plan', name: '잃은 뒤 고르기', when: { planLostNow: true }, target: 'lostT' },
      { do: 'plan', name: '대상 고르기', target: 'pickT' },
      // 순서 1: 대상이 켜졌으면 산다(보유·종료 안내와 상관없음)
      { do: 'buy', name: '대상 구매', gate: 'always', pick: 'plan' },
      // 순서 2 끝: 잃은 적이 있으면 새 대상을 곧바로 예약(찜 예약)
      { do: 'reservePlan', name: '잃은 뒤 예약', when: { planFresh: true, snatched: true, planOnBoard: true } },
      // 공급처에 색 보석이 없음: 대상 예약 → 털기 → 대상 색을 가장 적게 내는 카드
      { do: 'reservePlan', name: '바닥 예약', when: { supplyNoGems: true, planOnBoard: true } },
      { do: 'buy', name: '바닥 털기', when: { supplyNoGems: true }, gate: 'always', pick: 'shed' },
      { do: 'buy', name: '바닥 구매', when: { supplyNoGems: true }, gate: 'always', pick: 'leastPlanPay' },
      // 순서 3: 보유 10 → (가) 막힘 예약 (나) 털기 구매 (다) 바꿔 집기(아래 take)
      { do: 'reservePlan', name: '막힘 예약', when: { tokensMin: 10, planOnBoard: true } },
      { do: 'buy', name: '털기 구매', when: { tokensMin: 10 }, gate: 'always', pick: 'shed' },
      // 순서 3(다)·4: 대상 색을 집는다
      { do: 'take', name: '대상 색 쌓기' },
    ],

    take: [
      // 가장 많이 모자란 색(같으면 큰 칩 색 → 왼쪽 색)이 2개 이상 모자라고 더미 4 이상이면 그 색 2개.
      // 아니면 많이 모자란 대상 색부터, 남는 칸은 대상 색이 아닌 색 중 더미가 높은 색(실수 1)
      { name: '대상 색 쌓기', target: 'planT', pair: 'topTwoAny', missingTie: 'costHigh', fill: ['offTarget', 'pileHigh'] },
    ],

    // 황금은 남김. 군더더기(대상 비용에 없는 색) 많은 것부터 → 칩 수보다 더 가진 대상 색 → 큰 칩이 아닌 대상 색부터
    ret: { keepGold: true, protect: ['targetUpTo'], order: ['targetCostLow', 'heldHigh'] },

    // 귀족 줄도 팡파르도 보지 않는다(실수 6)
    noble: { look: [] },

    mistakes: [
      { id: 'nobleMiss', p: 0.9 },          // 실수 6 조건이 찰 때마다 거의 매번
      { id: 'pileUnder4Blocked', p: 0.2 },  // 실수 8 가끔
    ],

    // 대상 색 기다리기를 넉넉히 두되(4), 2·3인전의 끝없는 빈 수만 자른다. 끊기는 대상 색을 가장 적게 쓰는 카드
    safety: { swapFrom: 10, swapStreakMax: 4, noBuyStreakMax: 14, longGameRounds: 60, pick: 'leastPlanPay', target: 'planT' },
  });
})();
