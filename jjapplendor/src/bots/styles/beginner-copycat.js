// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 따라 하기형 (앞선 사람 뒤를 따라 하는 사람, 인간상 제목은 '모방형')
 *
 * 근거: docs/ai/personas/beginner-copycat.md. 형식과 항목의 뜻: docs/ai/framework.md(11-11 추가분 포함)와
 * docs/ai/framework-b2.md. 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes-b2.md.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  bots.register({
    id: 'beginner-copycat',
    label: '초보 · 따라 하기형',
    desc: '점수가 가장 높은 상대가 방금 한 수를 따라 합니다. 그 사람이 보석을 집으면 켜진 카드가 있어도 같이 집습니다.',
    level: 'beginner',
    temper: 'copycat',
    seatName: '따라 하기형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음). 3=상 2=중 1=하 0=없음
    pulls: {
      guidePick: 3, copyAct: 3, copyBuy: 3, copyAim: 3, copyTake: 3, fillGuideTake: 3, copyReserve: 1, nobleHabit: 3,
      gateNow: 0, pickMinPay: 0, pickLowColor: 0, planHold: 0, gateFull: 0, aimNone: 0,
    },
    // 결과로만(길잡이에 따라): 싼 카드 모으기, 토큰 쌓기, 색 몰림
    shapes: ['cheapCollect', 'tokenHoard', 'colorLadder'],
    // 기질 때문에 치르는 값(5절 끝): 같은 길 뒤에 서기, 켜진 카드 지나치기, 쓸모없는 색 쥐기, 닿지 않는 목표, 늦은 출발
    prices: ['followBehind', 'passLitCards', 'uselessColors', 'farTarget', 'lateStart'],
    roles: { swapTake: 'mistake', swapRepeat: 'mistake', printedCost: 'strategy', cheapLoop: 'strategy', reserveFlood: 'mistake' },

    // 길잡이(점수, 모두 0점이면 산 카드 장수)와 상대의 지난 행동 기억을 켠다
    guide: { rank: 'score' },

    perception: { target: { bonus: true, gold: true }, held: { bonus: false } },
    avoid: [],

    picks: {
      // 따라 사기: 닮음 순서(같은 색·같은 단계 → 같은 색 → 같은 단계 → 나머지) → 점수 → 인쇄된 비용 → 읽는 순서(예약 칸은 맨 끝)
      copy: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], keys: ['likeGuide', 'points', 'printedCost'] }] },
      // 본 수가 없을 때: 점수 → 인쇄된 비용 → 읽는 순서
      plain: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], keys: ['points', 'printedCost'] }] },
    },

    targets: {
      // 따라 살 카드: 모자란 색 더미가 빈 카드는 빼고, 닮음 순서 → 모자란 개수 → 점수 → 읽는 순서
      copy: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], filter: ['pileOk'], keys: ['likeGuide', 'need', 'points'] }] },
      // 따라 예약할 공개 카드: 닮음 순서 → 점수 → 읽는 순서(모자란 개수는 보지 않음)
      copyRes: { stages: [{ from: ['t3', 't2', 't1'], keys: ['likeGuide', 'points'] }] },
      // 본 수가 없을 때: 모자란 개수가 가장 작은 1단계 카드
      plain: { stages: [{ from: ['t1'], keys: ['need'] }] },
    },

    act: [
      // 공급처에 색 보석이 없음: 닮음 순서의 첫 공개 카드를 예약
      { do: 'reserveForced', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true }, target: 'copyRes', fallback: 'none' },
      // 본 수가 없음: 가장 평범한 것
      { do: 'buy', name: '평범하게 사기', when: { guideDid: 'none' }, gate: 'always', pick: 'plain' },
      // 본 수가 공개 카드 예약 / 덱 예약(칸이 남으면, 불이 있어도)
      { do: 'reserveWish', name: '따라 예약', when: { guideDid: 'reserve', reservedMax: 2 }, target: 'copyRes' },
      { do: 'reserveDeck', name: '따라 덱 예약', when: { guideDid: 'reserveDeck', reservedMax: 2 }, deck: 'guide', target: 'copyRes' },
      // 본 수가 보석 집기: 집으면 10개를 넘고 불이 있으면 사고, 아니면(넘쳐도) 같은 색을 집는다(실수 4)
      { do: 'buy', name: '넘치니 사기', when: { guideDid: 'take', guideTakeOverflow: true }, gate: 'always', pick: 'copy' },
      { do: 'copyTake', name: '따라 집기', when: { guideDid: 'take' }, fill: ['pileHigh'] },
      // 본 수가 구매(또는 예약인데 칸이 참): 닮음 순서로 산다
      { do: 'buy', name: '따라 사기', gate: 'always', pick: 'copy' },
      { do: 'take', name: '따라 살 카드로 집기' },
    ],

    take: [
      { name: '평범하게 집기', when: { guideDid: 'none' }, target: 'plain', pair: 'needTwo', fill: ['pileHigh'] },
      // 남는 칸은 길잡이가 마지막으로 집은 색 → 가장 높은 더미
      { name: '따라 살 카드로 집기', target: 'copy', pair: 'needTwo', fill: ['guideTake', 'pileHigh'] },
    ],

    // 따라 집은 색을 맨 끝까지, 그다음 따라 살 카드의 모자란 색. 나머지는 많이 가진 색 → 왼쪽(실수 5)
    ret: { keepGold: true, protect: ['justTaken', 'targetMissing'], order: ['heldHigh'] },

    // 길잡이가 귀족을 받는 것을 본 뒤로 매 차례 귀족 줄을 왼쪽부터
    noble: { look: ['habit'] },

    mistakes: [
      { id: 'nobleMiss', p: 0.9 },                                    // 실수 1 습관 전, 거의 매번
      { id: 'nobleForget', p: 0.05, when: { returnedThisTurn: true } }, // 실수 2 습관 뒤 반납한 차례, 드물게
      { id: 'dropBonus', p: 0.5, when: { bonusMin: 6 } },             // 실수 3 길잡이 색 보너스가 쌓인 중반 이후 자주
      { id: 'dropBonus', p: 0.2 },                                    //        그 밖
      { id: 'seenMixup', p: 0.2 },                                    // 실수 6 사이에 같은 갈래의 수가 끼었을 때 가끔
      { id: 'guideMisread', p: 0.2 },                                 // 실수 7 점수가 1~2점 차로 붙었을 때 가끔
      { id: 'pileUnder4Blocked', p: 0.2, colorScope: 'wantedPair' },  // 실수 8 같은 색 2개가 막힌 색을 뺌, 가끔
      { id: 'rowSkip', rows: ['reserved'], p: 0.2, when: { reservedMin: 2 } }, // 실수 9 예약을 두세 번 한 뒤 가끔
    ],

    // 넘치는 손의 따라 집기가 이어질 수 있다(실수 4): 9개부터 바꿔 집기로 세고 넷째 연속 차례에 끊는다
    safety: { swapFrom: 9, swapStreakMax: 3, noBuyStreakMax: 12, longGameRounds: 60, pick: 'copy', target: 'copyRes' },
  });
})();
