// @ts-check
/*
 * 짭플렌더 — 컴퓨터 상대 스타일: 초보 · 한 방형 (뒷면을 뒤집는 사람, 인간상 제목은 '도박형')
 *
 * 근거: docs/ai/personas/beginner-gambler.md. 형식과 항목의 뜻: docs/ai/framework.md(11-11 추가분 포함)와
 * docs/ai/framework-b2.md. 짐작으로 정한 값과 담지 못한 것: docs/ai/translation-notes-b2.md.
 * 이 파일은 데이터만 담는다. Zap.bots.register 를 한 번 부른다(engine.js 가 먼저 불려 있어야 함).
 */
(function () {
  const bots = /** @type {any} */ (Zap).bots;
  if (!bots || typeof bots.register !== 'function') throw new Error('Zap.bots 가 없습니다: bots/engine.js 를 스타일 파일보다 먼저 불러오십시오');

  bots.register({
    id: 'beginner-gambler',
    label: '초보 · 한 방형',
    desc: '덱 맨 위 카드를 뒤집어 예약하는 것을 즐깁니다. 예약해 둔 카드가 켜지면 무엇보다 먼저 삽니다.',
    level: 'beginner',
    temper: 'gambler',
    seatName: '한 방형',

    // 인간상 4절의 끌림(실행부는 쓰지 않음). 3=상 2=중 1=하 0=없음
    pulls: {
      deckDraw: 3, pickReservedFirst: 3, aimHand: 3, pairTopAny: 3, gateNow: 2, exitBuy: 1,
      pickMinPay: 0, pickLowColor: 0, gateFull: 0, lastFlush: 0, aimBig: 0,
    },
    // 결과로만: 손이 오래 찬 모양, 운 좋은 판의 고효율 직행 모양, 막힘 출구로 생기는 1단계 몇 장
    shapes: ['tokenHoard', 'directRush', 'cheapCollect'],
    // 기질 때문에 치르는 값(5절 끝): 꽝으로 막힌 예약 칸, 잠긴 황금, 판 위 작은 점수 포기, 황금을 일찍 말림
    prices: ['deadHand', 'lockedGold', 'passSmallPoints', 'drainGold'],
    roles: { swapTake: 'mistake', swapRepeat: 'mistake', reserveFlood: 'strategy' },

    // 모자람은 토큰·황금·보너스를 넣어 센다(황금은 빼먹지 않음). 보너스 빼먹기는 굴림
    perception: { target: { bonus: true, gold: true }, held: { bonus: false } },
    // 황금은 내 패 몫: 판 위 작은 카드에는 황금 든 제안을 받지 않는다(내 패·3점 이상은 accept:'any'로 받아들임)
    avoid: [{ kind: 'goldPay' }],

    picks: {
      // 내 패 당첨: 점수 큰 것 → 먼저 뽑은 것(예약 칸 왼쪽)
      hand: { stages: [{ from: ['reserved'], accept: 'any', keys: ['points'] }] },
      // 판 위 3점 이상 켜진 카드(황금을 써도): 점수 → 인쇄된 비용 → 읽는 순서
      big: { stages: [{ from: ['t3', 't2', 't1'], accept: 'any', pointsMin: 3, keys: ['points', 'printedCost'] }] },
      // 막힘 출구: 판 위 켜진 카드, 점수 → 인쇄된 비용 → 읽는 순서(황금 든 제안은 기피가 막음)
      exit: { stages: [{ from: ['t3', 't2', 't1'], keys: ['points', 'printedCost'] }] },
      // 안전장치의 끊기와 공급처 바닥: 황금 상관없이 같은 순서
      exitAny: { stages: [{ from: ['t3', 't2', 't1', 'reserved'], accept: 'any', keys: ['points', 'printedCost'] }] },
    },

    targets: {
      // 내 패 목표: 모자란 개수 → 점수 → 먼저 뽑은 것. 품절 색이 있어도 빼지 않는다(실수 6).
      // 세 덱이 다 비어 내 패가 비었을 때만: 판 위 3점 이상 중 가장 덜 모자란 것, 그것도 없으면 가장 덜 모자란 것
      hand: {
        stages: [
          { from: ['reserved'], keys: ['need', 'points'] },
          { from: ['t3', 't2', 't1'], pointsMin: 3, keys: ['need'] },
          { from: ['t3', 't2', 't1'], keys: ['need'] },
        ],
      },
      // 남는 칸의 둘째·셋째 내 패(예약 칸 안에서만)
      handOnly: { stages: [{ from: ['reserved'], keys: ['need', 'points'] }] },
    },

    act: [
      // 첫째, 내 패에 불이 켜지면 산다(판 위의 더 큰 카드보다 먼저: 실수 8은 이 순서 그 자체)
      { do: 'buy', name: '내 패 당첨', gate: 'always', pick: 'hand' },
      // 둘째, 판 위 3점 이상 켜진 카드
      { do: 'buy', name: '큰 숫자 구매', gate: 'always', pick: 'big' },
      // 셋째, 예약 칸에 빈칸이 있으면 뽑기(3단계 덱, 비면 2·1단계). 토큰 10개여도, 마지막 차례여도(실수 7)
      { do: 'reserveDeck', name: '뽑기', deck: 'high' },
      // 넷째, 막힘(토큰 10): 황금 안 드는 켜진 카드 → 직전에도 바꿔 집었으면 황금 드는 카드도
      { do: 'buy', name: '막힘 출구', when: { tokensMin: 10 }, gate: 'always', pick: 'exit' },
      { do: 'buy', name: '막힘 출구(두 번째)', when: { tokensMin: 10, swappedLastTurn: true }, gate: 'always', pick: 'exit', lift: ['goldPay'] },
      // 공급처 바닥: 황금 상관없이 켜진 카드
      { do: 'buy', name: '바닥 구매', when: { supplyNoGems: true }, gate: 'always', pick: 'exitAny' },
      // 내 패 붓기(막힘이면 바꿔 집기: 실수 2)
      { do: 'take', name: '내 패 붓기' },
    ],

    take: [
      // 가장 많이 모자란 색(같으면 왼쪽 색)이 2개 이상이고 더미 4 이상이면 몰아서 2개(다른 색이 모자라도).
      // 아니면 목표 색 → 둘째·셋째 내 패의 색 → 높은 더미
      { name: '내 패 붓기', target: 'hand', pair: 'topTwoAny', fill: ['next', 'pileHigh'], nextTarget: 'handOnly', nextCount: 2 },
    ],

    // 황금은 절대 안 돌려줌. 내 패에 안 묶인 색 많은 것부터 → 목표 아닌 내 패의 색 → 목표 색
    ret: { keepGold: true, protect: ['targetCost', 'handCost'], order: ['heldHigh'] },

    // 팡파르를 들은 직후 한 차례만 귀족 줄
    noble: { look: ['fanfareAny'] },

    mistakes: [
      { id: 'nobleMiss', p: 0.9 },                                   // 실수 1 팡파르 예외 밖 거의 매번
      { id: 'dropBonus', p: 0.2, when: { bonusMin: 4 } },            // 실수 4 보너스가 3장을 넘은 중반 이후 가끔
      { id: 'dropBonus', p: 0.05 },                                  //        그 밖 드물게
      { id: 'pileUnder4Blocked', p: 0.2, colorScope: 'wantedPair' }, // 실수 5 가끔
    ],

    // 예약은 반쯤의 구매(S2 셈을 끊음). 켜진 카드가 없는 막힘의 바꿔 집기는 셋째에 끊는다
    safety: { swapFrom: 10, swapStreakMax: 2, noBuyStreakMax: 12, longGameRounds: 60, pick: 'exitAny', target: 'handOnly', noBuyResets: ['buy', 'reserve'] },
  });
})();
