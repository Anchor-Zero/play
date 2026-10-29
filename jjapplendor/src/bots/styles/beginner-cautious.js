// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 신중형 (쌓아 두는 사람)
 *
 * 근거: docs/ai/personas/beginner-cautious.md. 형식과 항목의 뜻: docs/ai/framework.md.
 * 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes.md.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  bots.register({
    id: 'beginner-cautious',
    label: '초보 · 신중형',
    desc: '토큰을 넉넉히 쌓아 둬야 마음이 놓입니다. 살 수 있어도 한 번 더 모읍니다.',
    level: 'beginner',
    temper: 'cautious',
    seatName: '신중형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음, 분석 도구의 검증용). 3=상 2=중 1=하 0=없음
    pulls: {
      gateFull: 3, aimNone: 3, pairToTen: 3, pickMinPay: 3, freeGrab: 3, lastFlush: 3,
      swapTake: 2, gateNow: 1, pickNobleColor: 1,
      reserveWish: 0, reserveOneShort: 0,
    },
    // 토큰을 고르게 쌓은 부산물로 보너스가 퍼지고, 1단계를 많이 사 엔진처럼 보인다(4절)
    shapes: ['colorSpread', 'engineLook'],
    // 막힌 손 교환은 의도한 수, 되풀이만 실수(7절 제안, 5절 실수 5). 공짜 카드는 전략(실수 10 은 결과)
    roles: { freeGrab: 'strategy', cheapLoop: 'strategy', lowValueBuy: 'strategy', swapTake: 'strategy', swapRepeat: 'mistake' },

    // 토큰 줄만 센다: 보너스도 황금도 구매력으로 더하지 않는다(실수 1·2·3 은 이 값에 내장)
    perception: { target: { bonus: false, gold: false }, held: { bonus: false } },
    // 지불 제안에 황금이 든 카드는 '못 사는 카드'(실수 8 은 이 값에 내장)
    avoid: [{ kind: 'goldPay' }],

    picks: {
      // 최소 지불보다 1개 더 내는 데까지만 후보 → 점수 큰 것 → 덜 내는 것 → 귀족 색 → 낮은 단계 → 아무거나
      main: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], window: 1, keys: ['points', 'payment', 'nobleColor', 'tierLow', 'random'] }] },
      // 공짜가 여럿이면 점수 큰 것 → 귀족 색 → 아무거나
      free: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], keys: ['points', 'nobleColor', 'random'] }] },
      // 마지막 차례: 황금까지 넣어 점수 큰 것 → 덜 내는 것
      flush: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], keys: ['points', 'payment', 'random'] }] },
    },

    targets: {
      // 막힌 손의 목표: 3단계를 뺀 공개 카드 중 토큰만으로 센 모자란 개수가 가장 적은 것 → 점수 → 낮은 단계 → 아무거나
      stuck: { stages: [{ from: ['t1', 't2'], keys: ['need', 'points', 'tierLow', 'random'] }] },
    },

    act: [
      { do: 'lastFlush', name: '마지막 털기', when: { finalRound: true }, pick: 'flush' },
      { do: 'freeGrab', name: '공짜 줍기', when: { tokensMax: 8 }, pick: 'free' },
      { do: 'buy', name: '넘칠 때 사기', gate: 'noRoom', pick: 'main' },
      { do: 'buy', name: '비상: 황금으로 사기', when: { swappedLastTurn: true, tokensMin: 9 }, gate: 'always', pick: 'main', lift: ['goldPay'] },
      { do: 'buy', name: '공급처 바닥: 황금으로 사기', when: { supplyNoGems: true }, gate: 'always', pick: 'main', lift: ['goldPay'] },
      { do: 'reserveForced', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true }, target: 'stuck', fallback: 'any' },
      { do: 'take', name: '보석 집기' },
    ],

    take: [
      // 보유 9~10, 살 것 없음: 목표에 모자란 색으로 바꿔 집는다. 한 색만 모자라면 같은 색 2개(반납 1개)
      { name: '막힌 손 교환', when: { tokensMin: 9 }, target: 'stuck', pair: 'oneColor', fill: ['heldLow', 'pileHigh'] },
      // 보유 8: 적게 가진 색 중 같은 색 2개가 되는 색으로 정확히 10. 안 되면 3색을 집고 1개 반납
      { name: '10 맞추기', when: { tokensMin: 8, tokensMax: 8 }, target: null, pair: 'toTen', fill: ['heldLow', 'pileHigh'] },
      // 보유 0~7: 가장 적게 가진 색부터 세 색(같으면 높이 쌓인 색)
      { name: '고르게 쌓기', target: null, pair: 'none', fill: ['heldLow', 'pileHigh'] },
    ],

    // 황금은 절대 안 돌려준다. 막힌 손이면 목표 비용에 든 색을 지키고, 방금 집은 색도 그대로 돌려주지 않는다
    ret: { keepGold: true, protect: ['targetCost', 'justTaken'], order: ['heldHigh'] },

    // 직전 자기 차례 이후 상대의 귀족 방문을 봤을 때, 그리고 마지막 차례에만 귀족 줄을 눌러 본다(실수 6)
    noble: { look: ['fanfareOthers', 'finalTurn'] },

    mistakes: [
      { id: 'nobleMiss', p: 0.9 },                          // 실수 6 계기가 없는 차례에 거의 매번
      { id: 'pileUnder4Blocked', p: 0.2, colorScope: 'any' }, // 실수 9 가끔
    ],

    safety: { swapFrom: 9, swapStreakMax: 3, noBuyStreakMax: 12, longGameRounds: 60, pick: 'main', target: 'stuck' },
  });
})();
