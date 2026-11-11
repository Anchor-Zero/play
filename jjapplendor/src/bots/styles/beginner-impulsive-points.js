/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 큰 숫자형 (큰 숫자에 꽂히는 사람)
 *
 * 근거: docs/ai/personas/beginner-impulsive-points.md. 형식과 항목의 뜻: docs/ai/framework.md (11·12절이 이 파일이 쓰는 새 칸).
 * 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes.md 5절.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 * 지금 실행부는 11-11 추가분(framework.md 12절)을 모르므로, 그것이 구현되기 전에는 register 가 실패한다(정상).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  const ALL = ['t3', 't2', 't1', 'reserved'];

  bots.register({
    id: 'beginner-impulsive-points',
    label: '초보 · 큰 숫자형',
    desc: '판에서 가장 큰 점수 카드에 꽂혀 바로 예약하고 그 색만 모읍니다. 0점 카드는 켜져도 사지 않습니다.',
    level: 'beginner',
    temper: 'impulsive',
    seatName: '큰숫자형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음, 분석 도구의 검증용). 3=상 2=중 1=하 0=없음
    pulls: {
      aimBig: 3, planHold: 3, reservePlan: 3, pickPointsOnly: 3, fillNext: 3, pairTopTwo: 3, lastFlush: 3, pickPlanFirst: 1,
      planSwitchBored: 2, planSwitchBigger: 2, pickNoOverlap: 1,
      gateNow: 0, aimNearest: 0, gateFull: 0, aimNone: 0, aimLowColor: 0, pickNobleColor: 0, pickWatched: 0, nobleOnMilestone: 0,
    },
    // 토큰 쌓기와 고효율 직행은 결과 모양으로만 닮는다(4절)
    shapes: ['tokenHoard', 'directRush'],
    // 10개 찬 손의 바꿔 집기는 실수 7. 인쇄된 비용으로 동률을 깨는 것은 이 사람의 규칙
    roles: { printedCost: 'strategy', swapTake: 'mistake', swapRepeat: 'mistake' },

    // 모자란 개수: 토큰과 황금은 넣고 보너스는 넣지 않는다(3절 머리, 실수 2 는 이 값에 내장)
    perception: { target: { bonus: false, gold: 'total' }, held: { bonus: false } },
    avoid: [],

    picks: {
      main: {
        stages: [
          // 순서 2: 켜진 큰 카드(3점 이상, 꽂힌 카드 포함) → 숫자 큰 것 → 꽂힌 카드 → 인쇄된 비용 → 읽는 순서
          { from: ALL, pointsMin: 3, keys: ['points', 'plan', 'printedCost'] },
          // 순서 3: 켜진 작은 카드(1·2점) 가운데 꽂힌 카드와 인쇄된 색이 겹치지 않는 것(실수 8 내장)
          { from: ALL, pointsMin: 1, pointsMax: 2, filter: ['noPlanOverlap'], keys: ['points', 'printedCost'] },
        ],
      },
      // 순서 1: 종료 안내 뒤 켜진 숫자 카드(겹침 무관, lastFlush 가 1점 이상만 거름) → 숫자 큰 것 → 인쇄된 비용
      flush: { stages: [{ from: ALL, keys: ['points', 'printedCost'] }] },
      // 공급처 바닥·칸도 참: 0점 카드까지 숫자 큰 것 → 인쇄된 비용 (안전장치 끊기도 이것)
      any: { stages: [{ from: ALL, keys: ['points', 'printedCost'] }] },
    },

    targets: {
      // 첫 꽂힘 규칙: 판 위와 예약 칸에서 숫자 큰 것 → 인쇄된 비용 → 읽는 순서 (실수 1: 토큰 한도를 보지 않음)
      fixate: { stages: [{ from: ALL, keys: ['points', 'printedCost'] }] },
      // 공급처가 바닥일 때 예약할 판 위 카드(같은 규칙, 판 위만)
      fixateBoard: { stages: [{ from: ['t3', 't2', 't1'], keys: ['points', 'printedCost'] }] },
      // 더 큰 숫자로 옮김: 내 지난 차례 뒤 새로 깔린 카드 가운데 꽂힌 카드보다 숫자가 큰 것
      bigger: { stages: [{ from: ['t3', 't2', 't1'], filter: ['fresh', 'beatsPlan'], keys: ['points', 'printedCost'] }] },
      // 지루함 갈아타기: 꽂힌 카드를 뺀 큰 카드 중 모자란 개수 → 숫자 → 읽는 순서. 큰 카드가 없으면 숫자 있는 카드 전부(7절 넷째)
      bored: {
        stages: [
          { from: ALL, pointsMin: 3, filter: ['notPlan'], keys: ['need', 'points'] },
          { from: ALL, pointsMin: 1, filter: ['notPlan'], keys: ['need', 'points'] },
        ],
      },
      // 지금 꽂힌 카드(집기의 목표)
      plan: { stages: [{ from: ALL, accept: 'any', filter: ['plan'], keys: [] }] },
    },

    act: [
      { do: 'lastFlush', name: '종료 뒤 숫자 줍기', when: { finalRound: true }, pick: 'flush' },
      { do: 'buy', name: '숫자 있는 눈앞 구매', gate: 'always', pick: 'main' },
      // 순서 4(가)
      { do: 'plan', name: '첫 꽂힘', when: { hasPlan: false }, target: 'fixate' },
      // 순서 4(나)
      { do: 'plan', name: '더 큰 숫자로 옮김', when: { hasPlan: true, planNeedMin: 3 }, target: 'bigger', replace: true },
      // 순서 4(다): 칸이 찼으면 legal 에 없어 아래로
      { do: 'reservePlan', name: '꽂힌 카드 예약(토큰 10)', when: { tokensMin: 10, planOnBoard: true } },
      // 순서 4(라)
      { do: 'plan', name: '지루함 갈아타기', when: { hasPlan: true, planIdleMin: 4, planNeedMin: 3 }, target: 'bored', replace: true },
      // 순서 5
      { do: 'reservePlan', name: '꽂힌 카드 예약(새로 꽂힘)', when: { planFresh: true, planOnBoard: true } },
      // 공급처의 색 보석이 모두 바닥: 꽂힌 카드 → 첫 꽂힘 카드 예약 → 켜진 카드(0점 포함)
      { do: 'reservePlan', name: '강제 예약(공급처 바닥, 꽂힌 카드)', when: { supplyNoGems: true } },
      { do: 'reserveForced', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true }, target: 'fixateBoard', fallback: 'none' },
      { do: 'buy', name: '공급처 바닥: 켜진 카드', when: { supplyNoGems: true }, gate: 'always', pick: 'any' },
      // 순서 6
      { do: 'take', name: '꽂힌 카드 색 모으기' },
    ],

    take: [
      // 공급처에 남은 모자란 색이 한두 색이고 가장 많이 모자란 색이 2개 이상이면 그 색 2개(큰 칩부터).
      // 남는 칸은 '다음 큰 카드'(꽂힌 카드를 뺀 첫 꽂힘 후보)의 모자란 색 → 높은 더미. 품절 색은 기다린다(실수 3).
      // 토큰 10개에서도 그대로 집는다(실수 7: 바꿔 집기)
      { name: '꽂힌 카드 색 모으기', target: 'plan', pair: 'topTwo', fill: ['next', 'pileHigh'], nextTarget: 'fixate', nextCount: 1 },
    ],

    // 황금은 지킨다. 꽂힌 카드에 없는 색 → 꽂힌 카드 색의 칩 수를 넘는 여유분 → 꽂힌 카드 색(많이 가진 색부터)
    ret: { keepGold: true, protect: ['targetUpTo', 'targetCost'], order: ['heldHigh'] },

    // 직전 한 바퀴 안에 팡파르(나 포함)를 들은 차례에만 귀족 줄을 본다(실수 5)
    noble: { look: ['fanfareAny'] },

    mistakes: [
      { id: 'nobleMiss', p: 0.9 },                                                                  // 실수 5 거의 매번
      { id: 'rowSkip', rows: ['reserved'], exceptPlan: true, p: 0.5, when: { litScoringBoard: true } }, // 실수 6 판 위에 다른 켜진 숫자 카드, 자주
      { id: 'rowSkip', rows: ['reserved'], exceptPlan: true, p: 0.2 },                              //        없으면 가끔
      { id: 'pileUnder4Blocked', p: 0.2, colorScope: 'wantedPair' },                                // 실수 10 가끔
    ],

    // 바꿔 집기는 지루함 셈 4 까지 이어지므로 상한 4. 예약은 '반쯤의 구매'라 무구매 셈을 끊는다(7절 셋째)
    safety: { swapFrom: 10, swapStreakMax: 4, noBuyStreakMax: 12, noBuyResets: ['buy', 'reserve'], longGameRounds: 60, pick: 'any', target: 'fixateBoard' },
  });
})();
