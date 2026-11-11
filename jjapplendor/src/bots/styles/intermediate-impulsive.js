// @ts-check
/* 짭플렌더 — 컴퓨터 상대 스타일: 중수 · 충동형 (좋은 거래를 못 지나치는 사람)
 *
 * 근거: docs/ai/personas/intermediate-impulsive.md (주석의 절 번호는 그 인간상의 것).
 * 형식: docs/ai/framework.md + docs/ai/framework-l2.md (5절). 짐작 값과 담지 못한 것: work/l2-values/notes.md.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 * 통합 때 고친 줄: plan.switch 에 drawnT3 를 더하고 closerT3 에 tie:'points' 를 더했다(인간상 3절 '덱 뽑기'·'계획 갈아타기').
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  const ALL = ['t3', 't2', 't1', 'reserved'];
  // 같은 무리 안에서: 거래 값 → 목표 색 보너스 → 실제 지불 → 읽는 순서(판 위가 예약 칸보다 앞 = 실수 5 내장)
  const DEAL_KEYS = ['gain', 'mainColor', 'payment', 'reading'];
  // 겨눔(켜지지 않은 카드): 거래 값 → 목표 색 → 실제 지불(점수가 같으면 feelCost 순서가 실제 지불 순서) → 읽는 순서
  const AIM_DEAL_KEYS = ['gain', 'mainColor', 'feelCost', 'reading'];
  const FILL = ['planCost', 'secondColor', 'sideNoble', 'pileHigh'];   // 목표 색(많이 모자란 것부터) → 이웃 색 → 곁다리 귀족 → 높은 더미
  const OFF_PLAN = ['공짜 거래'];                                       // 계획 밖 공짜 거래로 귀족이 우연히 찬 차례만 놓칠 수 있음(실수 2)

  bots.register({
    id: 'intermediate-impulsive', label: '중수 · 충동형', level: 'intermediate', temper: 'impulsive', seatName: '충동형',
    desc: '계획은 세우지만, 싸게 살 수 있는 카드가 보이면 그것부터 삽니다.',

    // 인간상 4절의 끌림(실행부는 쓰지 않음). 3=상 2=중 1=하 0=없음
    pulls: {
      pickDeal: 3, planGoalCard: 3, aimStep: 3, switchCloser: 3, aimHorizon: 3, pickGain: 3, pickWin: 3,
      aimNextDeal: 2, reserveOneShortL2: 2, switchRival: 2, switchDry: 2, gateNow: 2,
      reserveDeck: 1, sideNoble: 1,
      blockValue: 0, guardGoal: 0, reserveGoal: 0,
    },
    shapes: ['cheapCollect', 'colorSpread', 'colorLadder'],       // 공짜 거래·갈아타기의 결과 모양(4절)
    roles: { freeGrab: 'strategy', cheapLoop: 'strategy' },
    perception: { target: { bonus: true, gold: true }, held: { bonus: false } },   // 할인을 넣어 센다(하지 않는 실수)
    avoid: [],                                                    // 황금을 아끼지 않는다(3절 '황금')

    l2: {
      plan: {
        kind: 'goalCard', goal: 'goal0', second: 'cost3only',     // 7+3 이면 3개짜리 색이 이웃 색. 다시 세울 때도 같은 기준(3절 '계획 세우기')
        shape: { main: 3 },                                       // 디딤돌 3장
        sideNoble: true,                                          // 곁다리 귀족
        switch: [
          { on: 'planGone' }, { on: 'planBought' },
          { on: 'planColorDry', exceptOneShort: true },           // 목표 색 더미가 빔(1개 모자라 황금 거래가 되면 예약이 먼저)
          { on: 'rivalBoughtMain', left: 4, keepTurns: 1 },       // 3절 '상대'
          { on: 'drawnT3', margin: 1 },                           // 3절 '덱 뽑기': 뽑은 3단계 카드가 목표보다 차례 셈이 작으면 새 목표
          { on: 'closerT3', by: 'turns', margin: 1, pointsDrop: 1, newMargin: 0, tie: 'points' },   // 차례 셈 1 작고 점수 ≥ 목표−1, 새 카드는 같기만 해도. 여럿이면 차례 셈→점수 큰 것→읽는 순서
        ],
      },
      phase: {
        initial: 'build',
        toScore: [{ shapeMet: true }, { planTurnsMax: 2 }],       // 목표 색 3장 또는 목표 차례 셈 2 이하
        rejudge: true,                                            // 갈아탄 뒤 새 목표로 다시 판정(실수 8 은 phaseCarry)
      },
      count: { turns: 'sum3half', supply: false },                // 차례 셈 = max(⌈합/3⌉, ⌈한 색 최대/2⌉). 공급처는 셈에 넣지 않음
      read: { bonus: 'trigger', tokens: 'never', gold: false, reserved: false, nobles: false, focus: 'goal', trigger: { boughtGoalColor: true } },
      endgame: { horizon: { kind: 'byScore', includeBuy: false } },   // 13+ → 1차례, 12 → 2차례(값: 점수로만 어림)
      gainNobles: 'all',                                          // 켜진 카드를 귀족 줄 전체와 맞대 봄(빠뜨림은 실수 2)
      offPlanRules: OFF_PLAN,
    },

    targets: {
      // 목표 카드: 단색 7·7+3 중 차례 셈 → 디딤돌 수 → 4점(적힌 비용이 적은 쪽 = 단색 7) → 읽는 순서. 내 예약 3단계도 후보.
      // 하나도 없으면 6/3/3·단색 6·단색 5 로 넓혀 점수÷적힌 비용
      goal0: { stages: [
        { from: ['t3', 'reserved'], filter: [{ f: 'costShape', in: ['7', '7-3'] }], keys: ['turns', 'stepStones', 'printedCost', 'reading'] },
        { from: ['t3', 't2', 'reserved'], filter: [{ f: 'costShape', in: ['6-3-3', '6', '5'] }], keys: ['gemsPerPoint', 'reading'] },
      ] },
      // 보석 차례의 겨눔: 다음 차례 거래 → (깔기) 디딤돌 중 차례 셈 최소 → 목표
      aim: { stages: [
        { from: ALL, filter: [{ f: 'turnsMax', n: 1 }, { f: 'any', of: ['completesNoble', { f: 'payPerPoint', k: 2 }] }], keys: AIM_DEAL_KEYS },
        { when: { phase: 'build' }, from: ['t1', 't2'], filter: ['stepStone'], keys: ['turns', 'points', 'feelCost', 'reading'] },
        { from: ['t3', 'reserved'], filter: ['plan'], keys: ['reading'] },
      ] },
      // 종반 셈: 남은 차례 안에 닿는 것 중 거래 값 최대, 없으면 차례 셈이 가장 작은 점수 카드
      endAim: { stages: [
        { from: ALL, filter: ['gainPos', 'inHorizon'], keys: ['gain', 'turns', 'reading'] },
        { from: ALL, pointsMin: 1, keys: ['turns', 'points', 'reading'] },
      ] },
      // 황금 거래: 정확히 1개 모자란 공개 카드(규칙 reserveOneShort 가 모자람 1 과 공개 줄을 거름) → 점수 → 목표 색 → 읽는 순서
      oneShort: { stages: [{ from: ['t3', 't2', 't1'], keys: ['points', 'mainColor', 'reading'] }] },
      oneShortDry: { stages: [{ from: ['t3', 't2', 't1'], filter: ['missingDry'], keys: ['points', 'mainColor', 'reading'] }] },
      goalT: { stages: [{ from: ['t3'], filter: ['plan'], keys: ['reading'] }] },
      nearScore: { stages: [{ from: ['t3', 't2', 't1'], pointsMin: 1, keys: ['turns', 'points', 'reading'] }] },
    },

    picks: {
      win: { stages: [{ from: ALL, accept: 'any', filter: ['reachWin'], keys: DEAL_KEYS }] },
      // 거래 네 등급. 거래 아닌 켜진 카드는 어느 단계에도 걸리지 않아 사지 않는다(3절)
      deal: { stages: [
        { from: ALL, filter: ['completesNoble'], keys: DEAL_KEYS },                 // 귀족 거래
        { from: ALL, filter: [{ f: 'payPerPoint', k: 2 }], keys: DEAL_KEYS },        // 점수 거래(지불 ≤ 점수×2)
        { from: ALL, filter: [{ f: 'payMax', n: 1 }], keys: DEAL_KEYS },             // 공짜 거래(0점·색 무관). 실수 3 은 goldAsFree
        { from: ['t1', 't2'], filter: ['stepStone'], keys: DEAL_KEYS },              // 디딤돌(계획대로의 구매)
      ] },
      endBuy: { stages: [{ from: ALL, accept: 'any', filter: ['gainPos'], keys: DEAL_KEYS }] },   // 종반·마지막 차례: 거래 값 최대, 비싼 점수 카드도
      freeZero: { stages: [{ from: ALL, filter: [{ f: 'payMax', n: 1 }], keys: ['payment', 'reading'] }] },
      flush: { stages: [{ from: ALL, accept: 'any', keys: ['gain', 'payment', 'reading'] }] },   // 안전장치 끊기용
    },

    act: [
      { do: 'buy', name: '15점 닿기', pick: 'win' },                                       // 뒤 순서를 보지 않음(값)
      { do: 'buy', name: '마지막 차례: 점수', when: { finalRound: true }, pick: 'endBuy' },
      { do: 'buy', name: '마지막 차례: 공짜', when: { finalRound: true }, p: 0.2, pick: 'freeZero', tag: 'finalFreeBuy' },   // 실수 4 가끔
      { do: 'take', name: '마지막 차례: 3색', when: { finalRound: true }, modes: ['마지막 3색'] },
      { do: 'buy', name: '종반 몰기', when: { anyScoreMin: 12 }, pick: 'endBuy' },          // 0점 거래·디딤돌은 거래에서 뺌
      { do: 'buy', name: '거래 사기', when: { anyScoreMax: 11 }, pick: 'deal' },
      { do: 'reserveOneShort', name: '바닥: 황금 거래', when: { supplyNoGems: true, supplyGold: true }, target: 'oneShort' },
      { do: 'reserveForced', name: '바닥: 목표 예약', when: { supplyNoGems: true }, target: 'goalT' },
      { do: 'reserveForced', name: '바닥: 가까운 점수 카드', when: { supplyNoGems: true }, target: 'nearScore', fallback: 'any' },
      { do: 'reserveOneShort', name: '황금 거래(8개 이상)', when: { tokensMin: 8, supplyGold: true, reservedMax: 2 }, target: 'oneShort' },
      { do: 'reserveOneShort', name: '황금 거래(그 색 품절)', when: { supplyGold: true, reservedMax: 2 }, target: 'oneShortDry' },
      { do: 'reserveDeck', name: '3단계 덱 뽑기', when: { tokensMin: 9, reservedMax: 1, supplyGold: true }, tiers: [3] },
      { do: 'take', name: '보석 집기' },
    ],

    take: [
      { name: '마지막 3색', when: { finalRound: true }, target: null, pair: 'none', fill: ['colorOrder'] },
      { name: '종반 10 맞추기', when: { anyScoreMin: 12, tokensMin: 8, tokensMax: 8 }, target: 'endAim', pair: 'missingTwo', fill: FILL },
      { name: '종반 집기', when: { anyScoreMin: 12 }, target: 'endAim', pair: 'needTwo', fill: FILL },
      { name: '10 맞추기', when: { tokensMin: 8, tokensMax: 8 }, target: 'aim', pair: 'missingTwo', fill: FILL },   // 안 되면 3색 집고 반납
      { name: '거래·계획 집기', target: 'aim', pair: 'needTwo', fill: FILL },
    ],

    // 황금, 겨눈 카드의 모자란 색, 목표 카드의 모자란 색을 지킴. 나머지는 많이 가진 색부터(같으면 화면 순서).
    // 다음 차례 거래 카드의 색은 지키지 않는다(실수 7 내장)
    ret: { keepGold: true, protect: ['targetMissing', 'planMissing'], order: ['heldHigh'] },
    // 곁다리 귀족은 늘, 귀족 거래로 산 차례엔 줄 전체. 둘이 함께면 곁다리 먼저
    noble: { look: ['plan', 'gainBuy'], prefer: ['plan', 'left'] },

    mistakes: [
      { id: 'nobleMiss', p: 0.3, when: { nobleLate: true } },      // 놓친 귀족을 다음 차례에 알아채는 것은 자주
      { id: 'nobleMiss', p: 0.2, when: { boughtOffPlan: true } },  // 실수 2 가끔(계획 밖 공짜 거래로 우연히 찬 귀족)
      { id: 'offPlanNobleBlind', p: 0.2 },                         // 실수 2 가끔(켜진 카드를 맞대 볼 때)
      { id: 'newCardOptimism', p: 0.2 },                           // 실수 1 가끔
      { id: 'goldAsFree', p: 0.2, when: { afterReserve: true } },  // 실수 3 황금 거래 예약 바로 다음 차례, 가끔
      { id: 'phaseCarry', p: 0.2 },                                // 실수 8 가끔
    ],
    safety: { swapFrom: 10, swapStreakMax: 3, noBuyStreakMax: 12, longGameRounds: 60, pick: 'flush', target: 'aim', pingPongMax: 3, blockStreakMax: 3 },
  });
})();
