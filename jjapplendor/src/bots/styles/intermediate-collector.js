// @ts-check
/* 짭플렌더 — 컴퓨터 상대 스타일: 중수 · 수집형 (귀족을 정해 놓고 모으는 사람)
 *
 * 근거: docs/ai/personas/intermediate-collector.md (주석의 절 번호는 그 인간상의 것).
 * 형식: docs/ai/framework.md + docs/ai/framework-l2.md (5절). 짐작 값과 담지 못한 것: work/l2-values/notes.md.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 * 통합 때 고친 곳(인간상 3절에 맞춤, 칸은 실행부가 새로 둠): 목표 황금 예약·무엇을 예약하나의 isTarget, 계획 색 덱 예약(boardShortColorNone),
 * 다시 세운 차례의 귀족 줄 보기(replannedThisTurn).
 *
 * 단계 이름: 인간상의 '쌓기' = phase 'build', '마무리' = phase 'score'.
 * '종반'(누구든 11점 이상 또는 종료 안내)은 단계가 아니라 조건 anyScoreMin:11 로 규칙마다 건다(종료 안내가 뜨면 이미 15점 이상).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  const ALL = ['t3', 't2', 't1', 'reserved'];
  const PUBLIC = ['t3', 't2', 't1'];
  // 쌓기의 살 카드: 서두름 귀족 색 → 가까운 귀족 색 → 체감 비용 → 낮은 단계 → 왼쪽
  const BUILD_BUY_KEYS = ['hurryNoble', 'nearNoble', 'feelCost', 'tierLow', 'reading'];
  // 쌓기의 목표: 서두름 → 가까운 귀족 → 몇 차례 → 체감 비용 → 지난 목표 → 왼쪽
  const BUILD_AIM_KEYS = ['hurryNoble', 'nearNoble', 'turns', 'feelCost', 'lastTarget', 'reading'];
  const NOT_ONE_TURN = { f: 'not', of: { f: 'turnsMax', n: 1 } };   // 몇 차례 ≥ 2

  bots.register({
    id: 'intermediate-collector', label: '중수 · 수집형', level: 'intermediate', temper: 'collector', seatName: '수집형',
    desc: '귀족 둘을 정해 그 색만 모읍니다. 귀족을 받기 전엔 점수 카드에 덜 끌립니다.',

    // 인간상 4절의 끌림(실행부는 쓰지 않음). 3=상 2=중 1=하 0=없음
    pulls: {
      planNobleBundle: 3, pickShortColor: 3, pickFeelCost: 3, phaseNobles: 3, noblePlan: 3, fillPlan: 3, returnOffPlan: 3, pickGain: 3,
      nobleRace: 2, pairHurry: 2, reserveGoal: 2, reserveFullHand: 2, nobleEndRow: 2, gateNow: 2,
      nobleReplan: 1, reserveDeck: 1,
      blockValue: 0, guardGoal: 0, switchCloser: 0,
    },
    shapes: ['engineLook', 'colorLadder', 'cheapCollect'],        // 색 사다리·싼 카드 모으기는 귀족 묶음의 결과(4절)
    roles: { freeGrab: 'strategy', cheapLoop: 'strategy' },
    perception: { target: { bonus: true, gold: true }, held: { bonus: false } },   // 실제 지불을 바르게 셈(실수 6·7 만 굴림)
    avoid: [],

    l2: {
      plan: {
        kind: 'nobleBundle',
        bundle: { maxColors: 3, single: true },                   // 귀족 둘, 색 합집합 세 색 이하. 없으면 한 장
        race: { hurryLead: 0, abandonLead: 2 },                   // 같거나 한 장 밀리면 서두름, 두 장 밀리면 포기
        replanWithin: 4,                                          // 다시 세울 귀족은 4장 이하만
        switch: [{ on: 'raceAbandon' }, { on: 'nobleTaken' }],    // 계획에서 벗어나는 계기는 이 둘(받음은 자동)뿐. 목표 카드를 빼앗겨도 계획은 그대로
      },
      phase: {
        initial: 'build',
        toScore: [{ planNoblesLeft: 0 }],                         // 계획 귀족을 다 받았거나 계획이 없으면 마무리
      },
      count: { turns: 'sum3full', supply: false },                // 몇 차례 = max(⌈합/3⌉, 한 색 최대 부족). 같은 색 2개를 셈에 넣지 않음(7절 넷째)
      read: { bonus: 'always', tokens: 'never', gold: false, reserved: false, nobles: false, focus: 'planNobles' },   // 실수 1·3 내장
      endgame: { horizon: { kind: 'none', includeBuy: false } },  // oppWinNext 는 보너스·점수만(실수 4 내장)
      gainNobles: 'all',                                          // 종반엔 계획 밖 귀족도 덤으로
    },

    targets: {
      aim: { stages: [
        { from: ['reserved'], accept: 'any', keys: ['turns', 'reading'] },                                             // 예약 칸 카드가 목표
        { when: { anyScoreMin: 11, oppWinNext: true }, from: ALL, filter: ['gainPos', { f: 'turnsMax', n: 1 }], keys: ['gain', 'reading'] },   // 짐작(노트)
        { when: { anyScoreMin: 11 }, from: PUBLIC, filter: ['gainPos'], keys: ['gainRate', 'reading'] },              // 종반: 얻는 점수 ÷ 차례
        { when: { phase: 'build' }, from: ['t1', 't2'], filter: ['shortColor', 'pileOk'], keys: BUILD_AIM_KEYS },     // 바닥난 색이 필요 없는 후보 먼저
        { when: { phase: 'build' }, from: ['t1', 't2'], filter: ['shortColor'], keys: BUILD_AIM_KEYS },
        { when: { phase: 'score' }, from: PUBLIC, pointsMin: 1, filter: [{ f: 'turnsMax', n: 3 }], keys: ['points', 'turns', 'planColor', 'reading'] },
        { when: { phase: 'score' }, from: PUBLIC, pointsMin: 1, keys: ['turns', 'points', 'reading'] },
      ] },
      // 무엇을 예약하나: 목표가 공개 카드면 목표. 아니면 종반·마무리는 점수가 가장 높은 공개 카드, 쌓기는 모자란 색 카드
      resv: { stages: [
        { from: PUBLIC, filter: [{ f: 'isTarget', of: 'aim' }], keys: ['reading'] },
        { when: { anyScoreMin: 11 }, from: PUBLIC, pointsMin: 1, keys: ['points', 'reading'] },
        { when: { phase: 'score' }, from: PUBLIC, pointsMin: 1, keys: ['points', 'reading'] },
        { when: { phase: 'build' }, from: ['t1', 't2', 't3'], filter: ['shortColor'], keys: BUILD_AIM_KEYS },
      ] },
      // 황금 예약: 이번 차례 목표(aim 의 첫 후보)가 공개 줄의 2·3단계이고 몇 차례 ≥ 2
      goldGoal: { stages: [
        { from: ['t2', 't3'], filter: [{ f: 'isTarget', of: 'aim' }, NOT_ONE_TURN], keys: ['reading'] },
      ] },
    },

    picks: {
      win: { stages: [{ from: ALL, accept: 'any', filter: ['reachWin'], keys: ['gain', 'payment', 'reading'] }] },
      reservedFirst: { stages: [{ from: ['reserved'], accept: 'any', keys: ['reading'] }] },
      // 쌓기: 모자란 색(1·2·3단계) → 계획 밖이라도 공짜에 2점 이상 → 안 삼
      build: { stages: [
        { from: PUBLIC, filter: ['shortColor'], keys: BUILD_BUY_KEYS },
        { from: PUBLIC, filter: ['free'], pointsMin: 2, keys: ['points', 'reading'] },
      ] },
      // 마무리: 점수 최대(지불 → 계획 색 → 왼쪽) → 두 장 이하 귀족의 모자란 색 0점(지불 적은 것) → 안 삼
      finish: { stages: [
        { from: ALL, pointsMin: 1, keys: ['points', 'payment', 'planColor', 'reading'] },
        { from: PUBLIC, filter: [{ f: 'nobleWithin', n: 2 }], keys: ['payment', 'reading'] },
      ] },
      // 종반: 얻는 점수(계획 밖 귀족 +3 포함) 최대, 0 이면 안 삼
      endgame: { stages: [{ from: ALL, accept: 'any', filter: ['gainPos'], keys: ['gain', 'payment', 'reading'] }] },
      anyCheap: { stages: [{ from: ALL, accept: 'any', keys: ['payment', 'reading'] }] },   // 10개에 예약도 못 할 때 + 안전장치
    },

    act: [
      { do: 'buy', name: '15점 닿기', pick: 'win' },
      { do: 'buy', name: '종반: 얻는 점수', when: { anyScoreMin: 11 }, pick: 'endgame' },
      { do: 'buy', name: '예약 카드 먼저', when: { anyScoreMax: 10 }, pick: 'reservedFirst' },
      { do: 'buy', name: '쌓기: 모자란 색', when: { phase: 'build', anyScoreMax: 10 }, pick: 'build' },
      { do: 'buy', name: '마무리: 점수', when: { phase: 'score', anyScoreMax: 10 }, pick: 'finish' },
      // 사지 않는 차례(3절 1~5번). 예약 칸 하나는 비워 둠: 셋째 칸은 강제 예약만
      { do: 'reserveForced', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true }, target: 'resv', fallback: 'any' },
      { do: 'reserve', name: '9개 이상 예약', when: { tokensMin: 9, reservedMax: 1 }, target: 'resv' },
      { do: 'reserveDeck', name: '9개 이상 예약(2단계 덱)', when: { tokensMin: 9, reservedMax: 1, phase: 'build' }, tiers: [2, 1] },
      { do: 'reserve', name: '목표 황금 예약', when: { supplyGold: true, reservedMax: 1, anyScoreMax: 10 }, target: 'goldGoal' },
      { do: 'reserveDeck', name: '계획 색 덱 예약', when: { phase: 'build', reservedMax: 0, tokensMax: 8, boardShortColorNone: true }, tiers: [2, 1] },   // 3절 4번
      { do: 'buy', name: '10개: 순서 밖 카드', when: { tokensMin: 10 }, pick: 'anyCheap' },
      { do: 'take', name: '보석 집기' },
    ],

    take: [
      { name: '8개 10 맞추기', when: { tokensMin: 8, tokensMax: 8 }, target: 'aim', pair: 'missingTwo', fill: ['nobleNeed', 'heldLow'] },
      // 한 색만 2개 이상 모자람, 또는 서두름 귀족 색이 2개 이상 모자람 → 같은 색 2개. 남는 칸은 다음에 살 계획 색 → 내 토큰 적은 색
      { name: '계획 색 모으기', target: 'aim', pair: 'hurry', fill: ['nobleNeed', 'heldLow'] },
    ],

    // 황금과 목표에 필요한 만큼은 지킴. 계획 밖 색 → 계획 색, 많이 쌓인 색부터, 같으면 검→흰. 예약 카드의 색은 지키지 않음(실수 5 내장)
    ret: { keepGold: true, protect: ['targetUpTo'], order: ['offPlanFirst', 'heldHigh', 'colorRev'] },
    // 계획 귀족은 사지 않은 차례에도 매 차례. 종반과 다시 세운 차례엔 줄 전체. 둘이면 가까운 귀족 → 왼쪽
    noble: { look: ['plan'], lookWhen: [{ anyScoreMin: 11 }, { replannedThisTurn: true }], prefer: ['near', 'left'] },

    mistakes: [
      { id: 'nobleMiss', p: 1 },                                   // 실수 2: 쌓기·마무리에서 계획 밖 귀족은 보지 않음(3절이 '누르지 않는다'로 적음)
      { id: 'dropGold', p: 0.2, when: { afterReserve: true } },    // 실수 7 예약 바로 다음 차례, 가끔
      { id: 'oneDiscountMiss', p: 0.05 },                          // 실수 6 드물게
    ],
    safety: { swapFrom: 10, swapStreakMax: 2, noBuyStreakMax: 12, longGameRounds: 60, pick: 'anyCheap', target: 'aim', pingPongMax: 3, blockStreakMax: 3 },
  });
})();
