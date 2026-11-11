/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 알뜰형 (장수를 늘리는 사람)
 *
 * 근거: docs/ai/personas/beginner-collector-count.md. 형식과 항목의 뜻: docs/ai/framework.md (11·12절이 이 파일이 쓰는 새 칸).
 * 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes.md 5절.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 * 지금 실행부는 11-11 추가분(framework.md 12절)을 모르므로, 그것이 구현되기 전에는 register 가 실패한다(정상).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  // 살 카드 고르기(3절): 낼 개수 → 낮은 단계 → 적힌 비용 → 지난 차례에 겨눈 카드 → 점수 → 왼쪽(예약 칸은 같은 단계 줄의 맨 왼쪽)
  const BUY_KEYS = ['payCount', 'tierLow', 'printedCost', 'lastTarget', 'points', 'slotLeft'];
  // 겨눌 카드 고르기(3절): 모자란 수 → 낮은 단계 → 적힌 비용 → 지난 차례에 겨눈 카드 → 왼쪽
  const AIM_KEYS = ['need', 'tierLow', 'printedCost', 'lastTarget'];

  bots.register({
    id: 'beginner-collector-count',
    label: '초보 · 알뜰형',
    desc: '카드 장수가 늘어나는 것이 즐겁습니다. 토큰을 가장 적게 내는 카드부터 한 장씩 삽니다.',
    level: 'beginner',
    temper: 'collector',
    seatName: '알뜰형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음, 분석 도구의 검증용). 3=상 2=중 1=하 0=없음
    pulls: {
      gateNow: 3, pickMinPay: 3, aimNearest: 3, fillNext: 3, lastFlush: 3, pairNeedTwo: 3,
      pickLowColor: 0, aimLowColor: 0, avoidLead: 0, reserveWish: 0, nobleOnMilestone: 0, nobleWatch: 0, pickWatched: 0,
      gateFull: 0, aimNone: 0, planHold: 0, aimBig: 0,
    },
    // 구매가 몇 색에 쏠려 엔진형·색 사다리처럼 보이는 것은 결과 모양(4절)
    shapes: ['engineLook', 'colorLadder'],
    // 공짜 카드·싼 카드·저가치 카드는 고른 전략. 10개에서의 '바꿔 담기'도 의도한 수(5절 끝)
    roles: { freeGrab: 'strategy', cheapLoop: 'strategy', lowValueBuy: 'strategy', printedCost: 'strategy', swapTake: 'strategy', swapRepeat: 'mistake' },

    // 낼 개수와 모자란 수는 할인과 황금을 넣어 바르게 센다. 황금을 빠뜨리는 것은 굴림 실수 dropGold
    perception: { target: { bonus: true, gold: true }, held: { bonus: false } },
    // 막힌 색이 없다
    avoid: [],

    picks: {
      main: {
        stages: [
          // 1·2단계 줄과 예약 칸에 켜진 카드가 있으면 반드시 산다
          { from: ['t1', 't2', 'reserved'], keys: BUY_KEYS },
          // 그 셋에 없을 때 비로소 3단계 줄(실수 3 내장)
          { from: ['t3'], keys: BUY_KEYS },
        ],
      },
      // 종료 안내 뒤 마지막 차례: 세 줄과 예약 칸 모두에서 점수 큰 것(같으면 평소 순서)
      flush: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], keys: ['points'].concat(BUY_KEYS) }] },
    },

    targets: {
      // 겨눔 줄: 1·2단계 공개 카드와 예약 칸에서 모자란 색이 모두 공급처에 남아 있는 카드. 첫째가 겨눈 카드, 둘째·셋째가 남는 칸
      main: { stages: [{ from: ['t1', 't2', 'reserved'], filter: ['pileOk'], keys: AIM_KEYS }] },
      // 강제 예약에서 겨눈 카드가 없거나 예약 칸의 카드일 때: 1단계 줄에서 낼 개수가 가장 적은 것(같으면 왼쪽)
      cheapT1: { stages: [{ from: ['t1'], keys: ['payCount'] }] },
    },

    act: [
      { do: 'lastFlush', name: '막판 점수 줍기', when: { finalRound: true }, pick: 'flush' },
      { do: 'buy', name: '지불 최소 구매', gate: 'always', pick: 'main' },
      { do: 'reserveForced', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true }, target: 'main', fallback: 'none' },
      { do: 'reserveForced', name: '강제 예약(공급처 바닥, 1단계)', when: { supplyNoGems: true }, target: 'cheapT1', fallback: 'none' },
      { do: 'reserveForced', name: '강제 예약(바꿔 담은 다음)', when: { swappedLastTurn: true }, target: 'main', fallback: 'none' },
      { do: 'reserveForced', name: '강제 예약(바꿔 담은 다음, 1단계)', when: { swappedLastTurn: true }, target: 'cheapT1', fallback: 'none' },
      { do: 'take', name: '다음 장 줄 세우기' },
    ],

    take: [
      // 겨눈 카드가 한 색만 2개 이상 모자라면 같은 색 2개. 아니면 겨눈 카드의 모자란 색 → 다음 장 → 셋째 장 → 높은 더미.
      // 토큰 총수는 보지 않는다(실수 5)
      { name: '다음 장 줄 세우기', target: 'main', pair: 'needTwo', fill: ['next', 'pileHigh'], nextCount: 2 },
    ],

    // 겨눈 카드에 필요한 토큰(적힌 비용 − 보너스까지)은 지키고, 나머지에서 가장 많이 쥔 색부터. 황금은 마지막
    ret: { keepGold: true, protect: ['targetUpTo'], order: ['heldHigh'] },

    // 귀족 줄은 종료 안내 뒤 마지막 차례에만 본다. 그 밖의 차례에 우연히 누르는 일도 없다(실수 1, 7절: 확률이 아니라 시야)
    noble: { look: ['finalTurn'] },

    mistakes: [
      { id: 'nobleMiss', p: 1 },                                              // 실수 1 계기 밖에서는 늘
      { id: 'dropGold', p: 0.5 },                                             // 실수 2 자주(황금은 강제 예약으로만 들어옴)
      { id: 'scanStop', rows: ['t1'], stopAt: 1, p: 0.2, when: { litMin: 4 } }, // 실수 4 켜진 카드 4장 이상, 가끔
      { id: 'scanStop', rows: ['t1'], stopAt: 1, p: 0.05 },                   //        그 밖(장면 밖 한 단계 아래)
      { id: 'chipMiscount', p: 0.2, minColors: 3, when: { bonusMin: 5 } },    // 실수 6 보너스가 흩어진 중반, 가끔
      { id: 'chipMiscount', p: 0.05, minColors: 3 },                          //        그 밖
    ],

    // 바꿔 담기는 다음 차례 강제 예약으로 끊으므로 상한 2 는 안전망
    safety: { swapFrom: 10, swapStreakMax: 2, noBuyStreakMax: 12, longGameRounds: 60, pick: 'main', target: 'main' },
  });
})();
