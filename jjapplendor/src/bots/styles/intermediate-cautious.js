// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 중수 · 신중형 (기반부터 다 짓는 사람)
 *
 * 근거: docs/ai/personas/intermediate-cautious.md (3절 장면 → 선택이 기준). 형식: docs/ai/framework.md + framework-l2.md(둘째 층).
 * framework-l2.md 5.5 의 본보기 뼈대를 옮기고, 인간상 3절과 어긋난 곳 넷을 3절대로 고쳤다(각 줄 주석 '3절 우선').
 * 이 파일은 데이터만 담는다. engine.js 와 bots/l2/*.js 가 먼저 불려 있어야 register 가 통과한다.
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');
  const ALL = ['t3', 't2', 't1', 'reserved'];
  // 계획 밖 구매(실수 6 '서두른 구매 뒤 귀족을 확인하지 않는다'의 장면)
  const OFF_PLAN = ['넘침 막기 구매', '경보: 1점도', '경보: 마지막 차례'];
  // 점수 목표(3절 '점수 단계, 살 것이 없다': 3단계·예약 칸·2단계 2~3점 중 차례 셈 → 점수 → 예약 칸)
  const SCORE_GOAL = { from: ['t3', 'reserved', 't2'], pointsMin: 2, keys: ['turns', 'points', 'reserved', 'reading'] };
  // 쌓기 목표(3절 '목표 카드', '목표를 잃음'): 공개 3단계 중 모자란 보석 최소 → 보석/점
  const BUILD_GOAL = { from: ['t3'], keys: ['need', 'gemsPerPoint', 'reading'] };

  bots.register({
    id: 'intermediate-cautious', label: '중수 · 신중형', level: 'intermediate', temper: 'cautious', seatName: '신중형',
    desc: '보너스로 기반을 다 깔아야 안심하고 점수로 넘어갑니다.',
    pulls: { planGoalCard: 3, phaseShape: 3, phaseAlarm: 3, phaseBack: 2, guardGoal: 3, overflowGuard: 2, pickEngine: 3, pickGain: 3, freeGrab: 3 },
    shapes: ['colorSpread', 'cheapCollect'],
    roles: { freeGrab: 'strategy', cheapLoop: 'strategy' },
    perception: { target: { bonus: true, gold: true }, held: { bonus: true } },      // 보너스를 정확히 더한다(2절, 5절 끝)
    avoid: [{ kind: 'goldPay' }],                                                     // 쌓기엔 황금을 엔진에 안 쓴다(3절 '황금'). 점수 규칙은 lift

    l2: {
      plan: {
        kind: 'goalCard', goal: 'goal0', replanTarget: 'replan', lostTarget: 'lost', second: 'cost2OrBonus',
        shape: { main: 4, second: 3, base: 1 },                                      // 전환 조건(3절)
        switch: [
          { on: 'planGone' }, { on: 'planBought' },
          { on: 'closerT3', by: 'need', margin: 2, onlyNew: true, skipIfReserved: true, sameMainInScore: true },  // 3절 '새 카드가 깔림'
        ],
      },
      phase: {
        initial: 'build',
        toScore: [{ shapeMet: true }, { oppScoreMin: 11 }, { finalRound: true }],    // 전환 조건, 경보(3절)
        back: [{ mainBonusMax: 2, oppScoreMax: 10, finalRound: false }],              // 되돌아가기: 경보 전, 새 주 색 3장 미만(목표를 잃었을 때만 판정)
      },
      count: { turns: 'sum3half', supply: true },                                    // 1절 셈. 공급처는 넣는다(빠뜨리는 것은 실수 4)
      read: { bonus: 'always', tokens: 'always', gold: true, reserved: false, nobles: false, focus: 'goal' },  // 2절 '상대가 내 목표 카드를 살 수 있는가'
      endgame: { horizon: { kind: 'fixed', n: 2, includeBuy: false } },              // 경보 뒤 '두 차례 안'
      gainNobles: 'all',                                                              // 귀족 마무리 카드 +3
      offPlanRules: OFF_PLAN,
    },

    targets: {
      goal0: { stages: [{ from: ['t3'], keys: ['gemsPerPoint', 'mainInNobles', 'reading'] }] },   // 3절 '목표 카드'
      // 산 뒤(또는 목표가 없어 다시 시도): 점수 단계면 점수 목표, 쌓기면 쌓기 목표
      replan: { stages: [Object.assign({ when: { phase: 'score' } }, SCORE_GOAL), BUILD_GOAL] },
      // 잃은 뒤(3절 우선): 경보 뒤에만 점수 목표, 경보 전이면 단계와 상관없이 쌓기 목표(그 주 색이 3장 미만이면 phase.back 이 되돌림)
      lost: { stages: [Object.assign({ when: { phase: 'score', oppScoreMin: 11 } }, SCORE_GOAL), Object.assign({ when: { phase: 'score', finalRound: true } }, SCORE_GOAL), BUILD_GOAL] },
      goalT: { stages: [{ from: ['t3', 'reserved'], filter: ['plan'], keys: ['reading'] }] },
      next: { stages: [                                                               // 다음 카드(3절 낱말)
        // 3절 우선: 마른 색이 필요한 엔진 카드는 뒤로(3절 '목표 색이 공급처에서 마름 — 쌓는 단계')
        { from: ['t1', 't2'], filter: [{ f: 'any', of: ['engineCard', 'completesNoble'] }, 'pileOk'], keys: ['need', 'gapOrder', 'points', 'tierLow', 'reading'] },
        { from: ['t1', 't2'], filter: [{ f: 'any', of: ['engineCard', 'completesNoble'] }], keys: ['need', 'gapOrder', 'points', 'tierLow', 'reading'] },
        { from: ['t3', 'reserved'], filter: ['plan'], keys: ['reading'] },
      ] },
      scoreAim: { stages: [
        { from: ALL, filter: ['completesNoble', { f: 'turnsMax', n: 1 }], keys: ['gain', 'reading'] },
        { from: ['t3', 'reserved'], filter: ['plan'], keys: ['reading'] },
        SCORE_GOAL,
      ] },
      alarmAim: { stages: [
        { from: ALL, filter: ['gainPos', 'inHorizon'], keys: ['gain', 'turns', 'reading'] },   // 두 차례 안의 점수 최대
        { from: ALL, filter: ['gainPos'], keys: ['turns', 'gain', 'reading'] },               // 없으면 가장 가까운 것
      ] },
      dearGoal: { stages: [{ from: ['t3'], filter: ['plan', { f: 'litPayMin', n: 4 }], keys: ['reading'] }] },
      dryGoal: { stages: [{ from: ['t3'], filter: ['plan', { f: 'mainDry', short: 2, supplyMax: 1 }], keys: ['reading'] }] },
      nextScore: { stages: [{ from: ['t3', 't2'], filter: ['notPlan'], pointsMin: 2, keys: ['turns', 'points', 'reading'] }] },
    },

    picks: {
      win: { stages: [{ from: ALL, accept: 'any', filter: ['reachWin'], keys: ['gain', 'payment'] }] },
      nobleFin: { stages: [{ from: ALL, filter: ['completesNoble'], keys: ['points', 'payment'] }] },
      free: { stages: [{ from: ALL, filter: ['free'], keys: ['gapOrder', 'points'] }] },
      engine: { stages: [{ from: ['t1', 't2'], filter: ['engineCard'], keys: ['gapOrder', 'payment', 'points'] }] },
      goalCheap: { stages: [{ from: ['t3', 'reserved'], filter: ['plan', { f: 'payMax', n: 3 }], keys: ['reading'] }] },
      // 3절 우선: '점수가 2 이상인 것(귀족 3점을 더해 셈)' → 카드 점수가 아니라 gain 으로 거른다
      score: { stages: [{ from: ALL, accept: 'any', filter: [{ f: 'gainMin', n: 2 }], keys: ['gain', 'reserved', 'payment'] }] },
      alarm: { stages: [{ from: ALL, accept: 'any', filter: ['gainPos'], keys: ['gain', 'reserved', 'payment'] }] },
      overflow: { stages: [{ from: ['t1', 't2'], filter: [{ f: 'payMax', n: 3 }], keys: ['points', 'payment'] }] },
    },

    act: [
      { do: 'buy', name: '15점 닿기', when: { phase: 'score' }, pick: 'win', lift: ['goldPay'] },
      { do: 'guard', name: '목표 지키기: 사기', when: { planThreat: true }, target: 'goalT', buy: true, reserve: false, lift: ['goldPay'] },
      { do: 'guard', name: '목표 지키기: 예약', when: { planThreat: true, reservedMax: 1 }, target: 'goalT', buy: false, reserve: true },
      { do: 'buy', name: '귀족 마무리', when: { phase: 'build' }, pick: 'nobleFin' },
      { do: 'freeGrab', name: '공짜', when: { phase: 'build' }, pick: 'free' },
      { do: 'buy', name: '엔진 카드', when: { phase: 'build' }, pick: 'engine' },
      { do: 'buy', name: '목표(지불 3 이하)', when: { phase: 'build' }, pick: 'goalCheap' },
      { do: 'reserve', name: '목표 예약(지불 4 이상)', when: { phase: 'build', planReserved: false, reservedMax: 1 }, target: 'dearGoal' },
      { do: 'buy', name: '경보: 1점도', when: { phase: 'score', oppScoreMin: 11 }, pick: 'alarm', lift: ['goldPay'] },
      { do: 'buy', name: '경보: 마지막 차례', when: { phase: 'score', finalRound: true }, pick: 'alarm', lift: ['goldPay'] },
      { do: 'buy', name: '점수 우선', when: { phase: 'score' }, pick: 'score', lift: ['goldPay'] },
      { do: 'reserve', name: '목표 색 마름 예약', when: { phase: 'score', planReserved: false, reservedMax: 1 }, target: 'dryGoal' },
      { do: 'buy', name: '넘침 막기 구매', when: { tokensMin: 9 }, pick: 'overflow' },
      { do: 'take', name: '넘침 막기: 10 맞추기', when: { tokensMin: 8, tokensMax: 8 }, modes: ['10 맞추기', '10 맞추기: 경보', '10 맞추기: 점수'] },
      { do: 'reserve', name: '넘침 막기: 목표 예약', when: { tokensMin: 8, planReserved: false, reservedMax: 1 }, target: 'goalT' },
      { do: 'reserve', name: '넘침 막기: 다음 목표 예약', when: { tokensMin: 8, planReserved: true, reservedMax: 1 }, target: 'nextScore' },
      { do: 'reserveForced', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true }, target: 'goalT', fallback: 'any' },
      { do: 'take', name: '보석 집기' },
    ],

    take: [
      // 3절 우선: 8개의 같은 색 2개는 '겨누는 카드'(쌓기 = 다음 카드, 경보 = 경보 겨눔, 점수 = 점수 겨눔)의 모자란 색으로
      // 3절 우선(5.5 고침): 이 셋은 토큰 8개일 때만. when 이 없으면 마지막 '보석 집기'가 모드를 위에서부터 보므로 늘 같은 색 2개를 먼저 시험하게 된다
      { name: '10 맞추기', when: { phase: 'build', tokensMin: 8, tokensMax: 8 }, target: 'next', pair: 'missingTwo', pairOnly: true, fill: [] },
      { name: '10 맞추기: 경보', when: { phase: 'score', oppScoreMin: 11, tokensMin: 8, tokensMax: 8 }, target: 'alarmAim', pair: 'missingTwo', pairOnly: true, fill: [] },
      { name: '10 맞추기: 점수', when: { phase: 'score', tokensMin: 8, tokensMax: 8 }, target: 'scoreAim', pair: 'missingTwo', pairOnly: true, fill: [] },
      { name: '반납 적게', when: { tokensMin: 9 }, target: 'next', pair: 'missingTwo', fill: ['mainColor', 'secondColor', 'pileHigh'] },
      { name: '쌓기 집기', when: { phase: 'build' }, target: 'next', pair: 'needTwo', fill: ['mainColor', 'secondColor', 'pileHigh'] },
      { name: '경보 집기', when: { oppScoreMin: 11 }, target: 'alarmAim', pair: 'needTwo', fill: ['secondColor', 'mainColor', 'pileHigh'] },
      { name: '점수 집기', target: 'scoreAim', pair: 'needTwo', fill: ['secondColor', 'mainColor', 'pileHigh'] },
    ],

    // 3절 우선 '반납할 때': 겨누는 카드와 목표 카드 어느 쪽에도 필요 없는 색부터(필요 = 비용 − 보너스 > 0), 그중 많이 가진 색부터, 황금은 지킴
    ret: { keepGold: true, protect: ['targetCost', 'planMissing'], order: ['heldHigh'] },
    noble: { look: [], prefer: ['left'] },                                            // 늘 확인. 계획 밖 구매 뒤만 가끔 놓침
    mistakes: [
      { id: 'nobleMiss', p: 0.05, when: { boughtOffPlan: true } },                    // 실수 6 드물게
      { id: 'oppGoldMiss', p: 0.2 },                                                   // 실수 2 가끔
      { id: 'turnsNoSupply', p: 0.2 },                                                 // 실수 4 가끔
      { id: 'finalBlind', p: 0.2 },                                                    // 실수 5 가끔
    ],
    safety: { swapFrom: 10, swapStreakMax: 3, noBuyStreakMax: 12, longGameRounds: 60, pick: 'score', target: 'goalT', pingPongMax: 3, blockStreakMax: 3 },
  });
})();
