// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 귀족형 (귀족 조건의 색만 모으는 사람)
 *
 * 근거: docs/ai/personas/beginner-noble.md. 형식과 항목의 뜻: docs/ai/framework.md(11-11 추가분 포함)와
 * docs/ai/framework-b2.md. 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes-b2.md.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  // 살 카드 고르기의 둘째(3절 '살 카드 고르기'): 귀족에게 모자란 수가 많은 색 → 적힌 비용(실수 3) → 낮은 단계 → 점수 → 왼쪽
  const BUY_KEYS = ['patronNeed', 'printedCost', 'tierLow', 'points'];
  // 목표 카드(3절 '목표 카드'): 1·2단계 줄에서 모자란 수가 많은 색 → 적힌 비용 → 낮은 단계 → 지난 목표 → 왼쪽
  const AIM_KEYS = ['patronNeed', 'printedCost', 'tierLow', 'lastTarget'];

  bots.register({
    id: 'beginner-noble',
    label: '초보 · 귀족형',
    desc: '귀족 하나를 정해 그 조건 색의 카드만 삽니다. 다른 색 카드는 공짜여도 사지 않습니다.',
    level: 'beginner',
    temper: 'noble',
    seatName: '귀족형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음). 3=상 2=중 1=하 0=없음
    pulls: {
      patronHold: 3, patronChain: 3, avoidOffPatron: 3, pickPatronNeed: 3, nobleOnPatron: 3, gateNow: 3,
      lastNobleFill: 3, swapTake: 3, patronAlert: 2, pickPrinted: 1, pickLowTier: 1,
      planHold: 0, pickLowColor: 0, gateFull: 0, aimNone: 0,
    },
    // 결과로만: 보너스가 2~3색에 몰리는 색 사다리 모양, 오해 중 조건 색 토큰이 쌓이는 모양
    shapes: ['colorLadder', 'tokenHoard'],
    // 기질 때문에 치르는 값: 바깥 색 할인이 없어 카드마다 토큰이 많이 듦, 같은 거리의 귀족 경주에서 짐
    prices: ['noOffColorDiscount', 'patronRaceTie'],
    roles: { swapTake: 'strategy', swapRepeat: 'mistake', printedCost: 'mistake', cheapLoop: 'strategy', lowValueBuy: 'strategy' },

    // 모실 귀족 기억을 켜고, 빼앗긴 뒤로는 경계(상대 보너스로 거리를 셈)
    patron: { alert: true },

    // 목표의 모자람은 할인과 황금을 넣어 센다. 자주 빠뜨리는 것은 굴림 dropBonus·dropGold
    perception: { target: { bonus: true, gold: true }, held: { bonus: false } },
    // 조건 밖 색 끊기: 모실 귀족에게 찬 색·바깥 색 카드는 사지도 겨누지도 않는다(공짜여도)
    avoid: [{ kind: 'offPatron' }],

    picks: {
      main: {
        stages: [
          // 첫째, 예약 칸의 모자란 색 카드(여럿이면 먼저 예약한 것)
          { from: ['reserved'], keys: ['reading'] },
          // 둘째, 세 공개 줄의 모자란 색 카드
          { from: ['t1', 't2', 't3'], keys: BUY_KEYS },
        ],
      },
      // 막힘 풀기(바꿔 집은 다음): 둘째까지 없으면 예약 칸과 세 줄의 모든 카드에서 적힌 비용 → 낮은 단계 → 왼쪽
      unblock: {
        stages: [
          { from: ['reserved'], keys: ['reading'] },
          { from: ['t1', 't2', 't3'], keys: BUY_KEYS },
          { from: ['t3', 't2', 't1', 'reserved'], accept: 'any', keys: ['printedCost', 'tierLow'] },
        ],
      },
      // 마지막 차례: 사면 어느 귀족이든 차는 카드(적힌 비용 → 왼쪽)
      finalNoble: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], accept: 'any', filter: ['completesNoble'], keys: ['printedCost'] }] },
      // 그다음 점수가 가장 높은 카드(같으면 둘째의 순서)
      flush: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], accept: 'any', keys: ['points'].concat(BUY_KEYS) }] },
      // 귀족 줄이 빈 판: 점수가 가장 높은 것(같으면 적힌 비용 → 왼쪽)
      pointsAny: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], accept: 'any', keys: ['points', 'printedCost'] }] },
    },

    targets: {
      main: {
        stages: [
          // 예약 칸에 모자란 색 카드가 있으면 그것(먼저 예약한 것)
          { from: ['reserved'], keys: ['reading'] },
          // 1·2단계 줄의 모자란 색 카드. 공급처는 보지 않는다(실수 9)
          { from: ['t1', 't2'], keys: AIM_KEYS },
          // 1·2단계에 없으면 3단계 줄(적힌 비용 → 지난 목표 → 왼쪽)
          { from: ['t3'], keys: ['printedCost', 'lastTarget'] },
        ],
      },
      // 강제 예약의 대비: 목표가 예약 칸이거나 없을 때 공개 줄의 모자란 색 카드(낮은 단계 → 왼쪽)
      forcedAlt: { stages: [{ from: ['t1', 't2', 't3'], keys: ['tierLow'] }] },
      // 귀족 줄이 빈 판: 점수 있는 공개 카드 가운데 적힌 비용이 가장 적은 것
      nobleNone: { stages: [{ from: ['t1', 't2', 't3'], filter: ['hasPoints'], accept: 'any', keys: ['printedCost'] }] },
    },

    act: [
      // 종료 안내 뒤 마지막 차례: 막판 귀족 채우기 → 점수 큰 카드 → (없으면) 평소
      { do: 'buy', name: '막판 귀족 채우기', when: { finalRound: true }, gate: 'always', pick: 'finalNoble' },
      { do: 'lastFlush', name: '막판 점수', when: { finalRound: true }, pick: 'flush' },
      // 귀족 줄이 모두 빔: 점수 큰 카드 눈앞 구매
      { do: 'buy', name: '귀족 없는 판', when: { noblesMax: 0 }, gate: 'always', pick: 'pointsAny' },
      // 막힘 풀기(직전 차례가 바꿔 집기)
      { do: 'buy', name: '막힘 풀기', when: { swappedLastTurn: true }, gate: 'always', pick: 'unblock' },
      // 거름망을 거친 눈앞 구매
      { do: 'buy', name: '귀족 색 구매', gate: 'always', pick: 'main' },
      // 강제 예약 둘: 막힘 풀기에도 살 것이 없음 / 공급처 바닥. 공개 줄의 목표 → 모자란 색 카드 → 1단계 왼쪽
      { do: 'reserveForced', name: '강제 예약(막힘 풀기)', when: { swappedLastTurn: true }, target: 'main', fallback: 'none' },
      { do: 'reserveForced', name: '강제 예약(막힘 풀기 대비)', when: { swappedLastTurn: true }, target: 'forcedAlt', fallback: 'leftT1' },
      { do: 'reserveForced', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true }, target: 'main', fallback: 'none' },
      { do: 'reserveForced', name: '강제 예약(바닥 대비)', when: { supplyNoGems: true }, target: 'forcedAlt', fallback: 'leftT1' },
      { do: 'take', name: '보석 집기' },
    ],

    take: [
      { name: '귀족 없는 판', when: { noblesMax: 0 }, target: 'nobleNone', pair: 'needTwo', fill: ['heldLow'] },
      // 오해 중: 남는 칸에 모실 귀족의 모자란 색 토큰 → 둘째 후보의 색 → 적게 가진 색
      { name: '오해 중 집기', when: { nobleMyth: true }, target: 'main', pair: 'needTwo', fill: ['patronNeed', 'next', 'heldLow'], nextCount: 1 },
      // 평소: 목표의 모자란 색 → 둘째 후보의 색 → 적게 가진 색. 토큰 총수는 보지 않는다(실수 6)
      { name: '목표 집기', target: 'main', pair: 'needTwo', fill: ['next', 'heldLow'], nextCount: 1 },
    ],

    // 오해 중이면 귀족 조건 색을 맨 끝까지. 목표에 필요 없는 색(지각 셈) 가운데 높이 쌓인 색부터. 황금은 남김
    ret: { keepGold: true, protect: ['patronMyth', 'targetCost'], order: ['heldHigh'] },

    // 차례마다 모실 귀족 하나만 확인. 종료 뒤 마지막 차례에는 줄 전체
    noble: { look: ['patron', 'finalTurn'] },

    mistakes: [
      { id: 'nobleTokenMyth', p: 0.5 },                         // 실수 1 판마다 오해를 갖고 시작하는 것이 자주
      { id: 'nobleMiss', p: 1 },                                // 실수 5 모실 귀족이 아닌 귀족은 보지 않음(내장, 우연히 누르지 않음)
      { id: 'dropBonus', p: 0.5, when: { bonusMin: 2 } },       // 실수 2 조건 색 보너스가 2~3장 쌓인 중반, 자주
      { id: 'dropBonus', p: 0.2 },                              //        그 밖
      { id: 'dropGold', p: 0.5, when: { afterReserve: true } }, // 실수 8 강제 예약 직후 자주
      { id: 'dropGold', p: 0.2 },                               //        그 밖
    ],

    // 바꿔 집기는 다음 차례의 막힘 풀기가 끊는다(2는 안전망)
    safety: { swapFrom: 10, swapStreakMax: 2, noBuyStreakMax: 12, longGameRounds: 60, pick: 'unblock', target: 'main' },
  });
})();
