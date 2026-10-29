// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 충동형 (불을 따라 사는 사람)
 *
 * 근거: docs/ai/personas/beginner-impulsive.md. 형식과 항목의 뜻: docs/ai/framework.md.
 * 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes.md.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  bots.register({
    id: 'beginner-impulsive',
    label: '초보 · 충동형',
    desc: '살 수 있는 카드가 보이면 바로 삽니다. 보석만 모으는 차례는 지루해합니다.',
    level: 'beginner',
    temper: 'impulsive',
    seatName: '충동형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음, 분석 도구의 검증용). 3=상 2=중 1=하 0=없음
    pulls: {
      gateNow: 3, aimNearest: 3, pickPoints: 2, reserveOneShort: 1,
      gateFull: 0, aimNone: 0, aimLowColor: 0, pickNobleColor: 0, pickWatched: 0, nobleOnMilestone: 0,
    },
    // 동기 없이 결과로만 생기는 모양(4절: 싼 카드 모으기, 색 넓게 펴기)
    shapes: ['cheapCollect', 'colorSpread'],
    // 겸용 항목의 역할(framework 3.3)
    roles: { cheapLoop: 'strategy', lowValueBuy: 'strategy', printedCost: 'strategy', swapTake: 'mistake', swapRepeat: 'mistake' },

    // '모자란 개수'는 토큰·보너스·황금을 다 넣어 센다(3절 머리). 보너스 빼먹기는 굴림 실수 dropBonus
    perception: { target: { bonus: true, gold: true }, held: { bonus: false } },
    avoid: [],

    picks: {
      // 불이 켜진 카드 중 점수 큰 것 → 인쇄된 비용 작은 것 → 읽는 순서(3단계 줄부터, 예약 칸은 맨 끝)
      main: {
        stages: [
          { from: ['t3', 't2', 't1', 'reserved'], keys: ['points', 'printedCost', 'reading'] },
          // 예약 칸의 불을 늦게 본 차례(rowSkip)에 판 위에 켜진 카드가 없으면 예약 카드를 산다
          { from: ['reserved'], keys: ['reading'] },
        ],
      },
    },

    targets: {
      // 다음 차례 켜기: 한 번에 켜질 카드(점수 큰 것, 읽는 순서) → 없으면 모자란 개수가 가장 작은 카드.
      // 1·2단계 줄만 본다(3단계 줄은 풍경). 모자란 색 더미가 빈 카드는 뺀다.
      main: { stages: [{ from: ['t1', 't2'], filter: ['pileOk'], keys: ['reach', 'points', 'reading'] }] },
      // 한 개 모자란 카드 예약의 후보(모자란 개수 정확히 1 은 규칙이 거른다)
      oneShort: { stages: [{ from: ['t1', 't2'], keys: ['points', 'reading'] }] },
      // 공급처 보석이 바닥났을 때: 모자란 개수가 가장 작은 공개 카드
      forced: { stages: [{ from: ['t1', 't2'], keys: ['need', 'points', 'reading'] }] },
    },

    act: [
      { do: 'buy', name: '눈앞 구매', gate: 'always', pick: 'main' },
      { do: 'reserveOneShort', name: '한 개 모자란 카드 예약', when: { tokensMin: 10, supplyGold: true }, target: 'oneShort' },
      { do: 'reserveForced', name: '강제 예약(공급처 바닥)', when: { supplyNoGems: true }, target: 'forced', fallback: 'any' },
      { do: 'take', name: '보석 집기' },
    ],

    take: [
      // 목표가 한 색만 2개 이상 모자라면 같은 색 2개, 아니면 모자란 색부터 세 칸 + 남는 칸은 가장 높은 더미(실수 2)
      // 토큰 10개에서도 그대로 집는다(실수 4: 바꿔 집기)
      { name: '다음 차례 켜기', target: 'main', pair: 'needTwo', fill: ['pileHigh'] },
    ],

    // 황금은 지키고, 이번 차례에 노린 카드의 모자란 색도 지키고, 가장 많이 가진 색부터(실수 3은 이 범위의 결과)
    ret: { keepGold: true, protect: ['targetMissing'], order: ['heldHigh'] },

    // 귀족은 직전 한 바퀴 안에 팡파르(나 포함)를 들은 차례에만 본다(실수 1)
    noble: { look: ['fanfareAny'] },

    mistakes: [
      { id: 'nobleMiss', p: 0.9 },                                              // 실수 1 거의 매번
      { id: 'dropBonus', p: 0.5, when: { bonusMin: 5 }, tiers: [2] },          // 실수 5 중반 이후 2단계 카드, 자주
      { id: 'firstGlance', p: 0.2, when: { litMin: 4 } },                       // 실수 6 켜진 카드 4장 이상, 가끔
      { id: 'firstGlance', p: 0.05, when: { litMin: 2 } },                      //        그 밖(장면 밖 한 단계 아래)
      { id: 'rowSkip', rows: ['reserved'], p: 0.5, when: { afterReserve: true } }, // 실수 7 예약한 다음 차례, 자주
      { id: 'rowSkip', rows: ['reserved'], p: 0.2 },                            //        그 밖
      { id: 'pileUnder4Blocked', p: 0.2, colorScope: 'wantedPair' },            // 실수 9 가끔
    ],

    safety: { swapFrom: 10, swapStreakMax: 2, noBuyStreakMax: 12, longGameRounds: 60, pick: 'main', target: 'forced' },
  });
})();
