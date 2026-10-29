// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 수집형 (색을 고루 채우는 사람)
 *
 * 근거: docs/ai/personas/beginner-collector.md. 형식과 항목의 뜻: docs/ai/framework.md.
 * 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes.md.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  // 살 카드 고르기의 둘째 순서(3절 '살 카드 고르기'): 보너스가 가장 적은 색 → 주목 귀족 색 → 낮은 단계
  // → 적힌 비용 적은 것(실수 2: 실제 지불이 아님) → 지난 목표 → 점수 있는 것 → 왼쪽
  const BUY_KEYS = ['bonusLow', 'watchedNoble', 'tierLow', 'printedCost', 'lastTarget', 'hasPoints', 'reading'];
  // 목표 고르기(3절 '목표 카드'): 보너스가 가장 적은 색 → 주목 귀족 색 → 1단계 → 적힌 비용 → 지난 목표 → 왼쪽
  const TARGET_KEYS = ['bonusLow', 'watchedNoble', 'tierLow', 'printedCost', 'lastTarget', 'reading'];

  bots.register({
    id: 'beginner-collector',
    label: '초보 · 수집형',
    desc: '보너스 다섯 색을 고루 채우고 싶어 합니다. 한 색만 높이 쌓이면 손이 가지 않습니다.',
    level: 'beginner',
    temper: 'collector',
    seatName: '수집형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음, 분석 도구의 검증용). 3=상 2=중 1=하 0=없음
    pulls: {
      pickLowColor: 3, aimLowColor: 3, avoidLead: 3, pickLowTier: 3, gateNow: 3, lastFlush: 3,
      reserveWish: 2, pickWatched: 1, nobleOnMilestone: 1, nobleWatch: 1,
      gateFull: 0, aimNone: 0, aimNearest: 0,
    },
    // 밖에서 보면 엔진형처럼 보이지만 귀족의 겹치는 색을 노려 모으지는 않는다(4절)
    shapes: ['engineLook'],
    roles: { freeGrab: 'strategy', cheapLoop: 'strategy', lowValueBuy: 'strategy', printedCost: 'mistake', swapTake: 'mistake', swapRepeat: 'mistake' },

    // 모자란 수는 할인과 황금을 넣어 센다(3절 '토큰 고르기'). 자주 빠뜨리는 것은 굴림 실수 dropBonus·dropGold
    perception: { target: { bonus: true, gold: true }, held: { bonus: false } },
    // 막힌 색: 가장 낮은 칸보다 두 장 이상 많은 색. 공짜면 산다
    avoid: [{ kind: 'colorLead', lead: 2, exemptFree: true }],

    picks: {
      main: {
        stages: [
          // 첫째, 예약 칸의 카드(막힌 색이 되었어도)
          { from: ['reserved'], accept: 'any', keys: ['reading'] },
          // 둘째, 1·2단계 줄의 허용 색. 3단계 줄은 rowSkip 실수(거의 매번)로 여기서 빠진다
          { from: ['t1', 't2', 't3'], keys: BUY_KEYS },
          // 셋째, 1·2단계 줄의 막힌 색 중 공짜(낮은 단계, 왼쪽)
          { from: ['t1', 't2'], accept: 'exempt', keys: ['tierLow', 'reading'] },
          // 넷째, 그래도 없을 때 비로소 3단계 줄의 허용 색
          { from: ['t3'], keys: BUY_KEYS },
        ],
      },
      // 종료 안내 뒤 마지막 차례: 세 줄과 예약 칸을 모두 보고 점수 큰 것(같으면 둘째의 순서)
      flush: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], accept: 'any', keys: ['points'].concat(BUY_KEYS) }] },
    },

    targets: {
      main: {
        stages: [
          // 예약 칸에 카드가 있으면 그것이 목표
          { from: ['reserved'], accept: 'any', keys: ['reading'] },
          // 허용 색의 1단계 카드, 빈 색은 1단계에 없으면 2단계 카드까지
          { from: ['t1', 't2'], filter: ['climbForEmpty'], keys: TARGET_KEYS },
          // 그래도 없으면 2단계 줄의 허용 색. 3단계는 목표로 삼지 않는다. 공급처는 보지 않는다(실수 8)
          { from: ['t2'], keys: TARGET_KEYS },
        ],
      },
    },

    act: [
      { do: 'lastFlush', name: '막판 점수 줍기', when: { finalRound: true }, pick: 'flush' },
      { do: 'buy', name: '바꿔 집은 다음: 제한 해제', when: { swappedLastTurn: true }, gate: 'always', pick: 'main', lift: ['colorLead'] },
      { do: 'buy', name: '거름망 눈앞 구매', gate: 'always', pick: 'main' },
      { do: 'reserveForced', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true }, target: 'main', fallback: 'leftT1' },
      { do: 'reserveForced', name: '강제 예약(바꿔 집은 다음)', when: { swappedLastTurn: true }, target: 'main', fallback: 'leftT1' },
      { do: 'reserveWish', name: '찜 예약', when: { snatched: true, reservedMax: 0 }, target: 'main' },
      { do: 'take', name: '보석 집기' },
    ],

    take: [
      // 한 색만 2개 이상 모자라면 같은 색 2개, 아니면 모자란 색부터 + 남는 칸은 토큰이 가장 적은 색(같으면 앞선 색).
      // 토큰 총수는 보지 않는다(실수 6), 10개에서도 집는다(실수 9: 바꿔 집기)
      { name: '낮은 칸 채우기', target: 'main', pair: 'needTwo', fill: ['heldLow'] },
    ],

    // 가장 높이 쌓인 색 → 보너스가 많은 색 → 앞선 색. 황금은 남긴다. 목표에 필요한지는 보지 않는다(실수 7)
    ret: { keepGold: true, protect: [], order: ['heldHigh', 'bonusHigh'] },

    // 이정표(다섯 칸이 같아짐·마지막 빈칸)에서 줄 전체를 보고 두 장 이하로 모자란 귀족 하나를 주목한다.
    // 주목한 귀족은 카드를 산 차례마다 확인. 종료 안내 뒤 마지막 차례에 줄 전체(실수 4·5)
    noble: { look: ['milestone', 'watched', 'finalTurn'], watchWithin: 2 },

    mistakes: [
      { id: 'nobleMiss', p: 0.9 },                              // 실수 4 이정표 사이에 찬 귀족, 거의 매번
      { id: 'dropBonus', p: 0.5, when: { bonusMax: 10 } },      // 실수 1 보너스 색마다 1~2장인 중반, 자주
      { id: 'dropBonus', p: 0.2 },                              //        후반은 덜하다
      { id: 'dropGold', p: 0.5, when: { afterReserve: true } }, // 실수 10 예약 직후, 자주
      { id: 'dropGold', p: 0.2 },                               //        그 밖
      { id: 'rowSkip', rows: ['t3'], p: 0.9 },                  // 실수 3 3단계 줄을 훑지 않음, 거의 매번
    ],

    safety: { swapFrom: 10, swapStreakMax: 2, noBuyStreakMax: 12, longGameRounds: 60, pick: 'main', target: 'main' },
  });
})();
