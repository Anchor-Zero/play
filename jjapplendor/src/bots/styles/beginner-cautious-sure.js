/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 확실형 (확실한 카드만 고르는 사람)
 *
 * 근거: docs/ai/personas/beginner-cautious-sure.md. 형식과 항목의 뜻: docs/ai/framework.md (11·12절이 이 파일이 쓰는 새 칸).
 * 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes.md 5절.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 * 지금 실행부는 11-11 추가분(framework.md 12절)을 모르므로, 그것이 구현되기 전에는 register 가 실패한다(정상).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  const ALL = ['t3', 't2', 't1', 'reserved'];
  // 확실함의 순서(3절 '새 목표를 정한다'): 모자란 개수 → 비용 색 가짓수 → 필요한 색의 가장 낮은 더미가 높은 것 → 점수 → 낮은 단계 → 왼쪽
  const SURE_KEYS = ['need', 'costColors', 'needPileMin', 'points', 'tierLow'];

  bots.register({
    id: 'beginner-cautious-sure',
    label: '초보 · 확실형',
    desc: '가장 확실히 살 수 있는 카드 한 장을 정해 그 색만 모으고, 살 수 있게 되면 바로 삽니다.',
    level: 'beginner',
    temper: 'cautious',
    seatName: '확실형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음, 분석 도구의 검증용). 3=상 2=중 1=하 0=없음
    pulls: {
      aimNearest: 3, planHold: 3, pickPlanFirst: 3, pickHarmless: 3, pairNeedTwo: 3, fillTargetSpare: 3, lastFlush: 3, planDropPile: 3,
      reservePlan: 2, swapTake: 1, gateNow: 1,
      gateFull: 0, aimNone: 0, pairToTen: 0, pickNobleColor: 0, aimBig: 0, reserveWish: 0, reserveOneShort: 0,
    },
    // 1단계를 많이 사서 싼 카드 모으기처럼, 보너스가 몰려 색 사다리처럼 보이는 것은 결과 모양(4절)
    shapes: ['cheapCollect', 'colorLadder'],
    // 손해 없는 줍기는 전략(실수 10 은 결과). 10개에서의 바꿔 집기는 의도한 수, 되풀이만 실수(실수 8)
    roles: { freeGrab: 'strategy', cheapLoop: 'strategy', lowValueBuy: 'strategy', swapTake: 'strategy', swapRepeat: 'mistake' },

    // 목표 셈에는 보너스를 넣고, 황금은 모자란 합에서만 뺀다('목표용 예비'). 채움·반납의 '가진 개수'는 토큰만
    perception: { target: { bonus: true, gold: 'total' }, held: { bonus: false } },
    avoid: [],

    picks: {
      // 목표 즉시 구매: 목표가 켜지면 토큰 수·황금과 상관없이
      plan: { stages: [{ from: ALL, accept: 'any', filter: ['plan'], keys: [] }] },
      // 손해 없는 줍기: 지불에 목표에 쓰일 색도 황금도 없는 켜진 카드 → 점수 → 덜 내는 것 → 낮은 단계 → 왼쪽 (실수 3 내장)
      harmless: { stages: [{ from: ALL, filter: ['notPlan', 'payAvoidsPlan'], keys: ['points', 'payment', 'tierLow'] }] },
      // 마지막 털기: 손해 따지지 않고 점수 큰 것 → 덜 내는 것 (안전장치 끊기도 이것, 7절 여섯째)
      flush: { stages: [{ from: ALL, keys: ['points', 'payment'] }] },
    },

    targets: {
      sure: {
        stages: [
          // 예약 칸에 카드가 있으면 그중 모자란 개수가 가장 적은 것
          { from: ['reserved'], accept: 'any', keys: ['need'] },
          // 1·2단계 공개 카드 가운데 필요한 색이 바닥나지 않은 것(3단계는 후보 아님)
          { from: ['t1', 't2'], filter: ['pileOk', 'notPlan'], keys: SURE_KEYS },
          // 모두 빠지면 빼는 조건 없이
          { from: ['t1', 't2'], filter: ['notPlan'], keys: SURE_KEYS },
        ],
      },
      plan: { stages: [{ from: ALL, accept: 'any', filter: ['plan'], keys: [] }] },
    },

    act: [
      { do: 'lastFlush', name: '마지막 털기', when: { finalRound: true }, pick: 'flush' },
      // 차례 순서 1: 판 위 목표에 필요한 색 더미가 0 이면 놓는다(예약 목표는 놓지 않음). 사라진 목표는 차례 시작에 저절로 풀림
      { do: 'planDrop', name: '목표 놓기(필요한 색 바닥)', when: { planOnBoard: true, planPileEmpty: true } },
      { do: 'plan', name: '가까운 한 장 고르기', target: 'sure' },
      // 차례 순서 2·3
      { do: 'buy', name: '목표 즉시 구매', gate: 'always', pick: 'plan' },
      { do: 'buy', name: '손해 없는 줍기', gate: 'always', pick: 'harmless', tag: 'freeGrab' },
      // 차례 순서 4: 빼앗긴 뒤에만, 판 위 목표가 4개 이상 모자라면(칸이 찼으면 legal 에 없어 아래로)
      { do: 'reservePlan', name: '목표 지키기 예약', when: { snatched: true, planOnBoard: true, planNeedMin: 4 } },
      // 공급처의 색 보석이 모두 바닥(인간상에 없는 장면, 짐작): 판 위 목표를 예약
      { do: 'reservePlan', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true } },
      // 차례 순서 5
      { do: 'take', name: '목표 색으로 쌓기' },
    ],

    take: [
      // 한 색만 2개 이상 모자라고 더미 4개 이상이면 같은 색 2개. 아니면 필요 개수 큰 색부터(같으면 높은 더미),
      // 남는 칸은 목표 색의 여유분 → 높은 더미(실수 9 내장). 10개에서도 집고 돌려준다(바꿔 집기)
      { name: '목표 색으로 쌓기', target: 'plan', pair: 'needTwo', missingTie: 'pileHigh', fill: ['targetSpare', 'pileHigh'] },
    ],

    // 황금과 필요 개수 안의 목표 색은 지킨다. 목표에 안 쓰는 색 → 목표 색의 여유분 순으로, 많이 가진 색부터. 방금 집은 색은 따지지 않음
    ret: { keepGold: true, protect: ['targetUpTo', 'targetCost'], order: ['heldHigh'] },

    // 직전 자기 차례 이후 상대의 귀족 방문을 봤을 때, 그리고 마지막 차례에만 귀족 줄을 눌러 본다(실수 6)
    noble: { look: ['fanfareOthers', 'finalTurn'] },

    mistakes: [
      { id: 'nobleMiss', p: 0.9 },                         // 실수 6 계기가 없는 차례에 거의 매번
      { id: 'dropBonus', p: 0.2, bonusScope: 'single' },   // 실수 4 한 장뿐인 색의 보너스를 가끔 빼먹음
      { id: 'pileLowAsEmpty', p: 0.2 },                    // 실수 5 1~3개 더미를 바닥으로 착각, 가끔
    ],

    // 바꿔 집기 연속 상한은 기존 신중형과 같은 3(실수 8). 끊기는 손해 따지지 않고 켜진 카드를 산다
    safety: { swapFrom: 10, swapStreakMax: 3, noBuyStreakMax: 12, longGameRounds: 60, pick: 'flush', target: 'sure' },
  });
})();
