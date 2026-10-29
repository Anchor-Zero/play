// @ts-check
/*
 * 짭플렌더 — 규칙 처리 (Zap.rules)
 *
 * 판 상태(GameState)를 받아 가능한 수를 판정하고, 수를 적용해 다음 상태를 만든다.
 * 규칙의 내용은 research/01_rules_spec.md 와 dev/decisions.md 6절, 함수·단계·목록의 모양은
 * docs/contract.md 4절과 types.js 를 따른다.
 *
 *  - 모든 공개 함수는 입력을 바꾸지 않는다. applyMove 는 먼저 입력 상태를 읽기만 하며 수를 검사하고,
 *    받아들일 때만 상태를 깊이 복사해 그 사본을 고친다.
 *  - 상태에는 GameState 에 적힌 항목만 둔다(cloneState 가 그 항목만 옮긴다).
 *  - 섞기는 createGame 한 곳에서만 한다.
 *  - applyMove 로 들어오는 수는 네트워크에서 온 임의 데이터로 보고 모양부터 검사한다.
 *  - DOM·window 를 쓰지 않는다(Node 에서 그대로 돈다).
 *  - 판이 끝나는 길은 둘이다: 15점 종료(endReason 'points')와, 실제 행동 없이 자동 패스가 인원수만큼 이어진
 *    교착 종료(endReason 'deadlock', 2026-10-29 메인 결정). 교착이면 마지막 라운드 없이 그 자리에서 끝낸다.
 */
(function () {
  const D = Zap.data;
  /** @type {Color[]} */
  const COLORS = ['w', 'u', 'g', 'r', 'k'];
  /** @type {TokenColor[]} */
  const TOKEN_COLORS = ['w', 'u', 'g', 'r', 'k', 'gold'];
  /** @type {Tier[]} */
  const TIERS = [1, 2, 3];
  const MARKET_SLOTS = 4;
  const TOKEN_LIMIT = 10;
  const RESERVE_LIMIT = 3;
  const WIN_SCORE = 15;

  const hasOwn = Object.prototype.hasOwnProperty;

  /* ───────────── 작은 보조 함수 ───────────── */

  /** @returns {TokenCounts} */
  function zeroTokens() {
    return { w: 0, u: 0, g: 0, r: 0, k: 0, gold: 0 };
  }

  /** @param {TokenCounts} t @returns {TokenCounts} */
  function copyTokens(t) {
    return { w: t.w, u: t.u, g: t.g, r: t.r, k: t.k, gold: t.gold };
  }

  /** @param {TokenCounts} t @returns {number} */
  function tokenTotal(t) {
    return t.w + t.u + t.g + t.r + t.k + t.gold;
  }

  /** 0 이상의 정수인가 (문자열·소수·음수·NaN·Infinity 는 거부) */
  function isCount(x) {
    return typeof x === 'number' && Number.isInteger(x) && x >= 0;
  }

  /** 여섯 칸이 모두 0 이상의 정수인 객체인가 */
  function isTokenCounts(x) {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
    return isCount(x.w) && isCount(x.u) && isCount(x.g) && isCount(x.r) && isCount(x.k) && isCount(x.gold);
  }

  /** 다섯 칸이 모두 0 이상의 정수인 객체인가 */
  function isColorCounts(x) {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
    return isCount(x.w) && isCount(x.u) && isCount(x.g) && isCount(x.r) && isCount(x.k);
  }

  function isColor(x) {
    return x === 'w' || x === 'u' || x === 'g' || x === 'r' || x === 'k';
  }

  /** @returns {CardDef|null} */
  function cardOf(id) {
    return typeof id === 'string' && hasOwn.call(D.cardsById, id) ? D.cardsById[id] : null;
  }

  /** @returns {NobleDef|null} */
  function nobleOf(id) {
    return typeof id === 'string' && hasOwn.call(D.noblesById, id) ? D.noblesById[id] : null;
  }

  function isSeat(state, seat) {
    return typeof seat === 'number' && Number.isInteger(seat) && seat >= 0 && seat < state.players.length;
  }

  /** @param {PlayerState} p @returns {PlayerState} */
  function clonePlayer(p) {
    const reserved = new Array(p.reserved.length);
    for (let i = 0; i < p.reserved.length; i++) {
      reserved[i] = { id: p.reserved[i].id, fromDeck: p.reserved[i].fromDeck };
    }
    return { tokens: copyTokens(p.tokens), cards: p.cards.slice(), reserved, nobles: p.nobles.slice() };
  }

  /** 연속 자동 패스 수. 항목이 없거나 이상한 값이면 0 으로 본다. @param {GameState} s @returns {number} */
  function streakOf(s) {
    return isCount(s.autoPassStreak) ? s.autoPassStreak : 0;
  }

  /** @param {any} x @returns {boolean} */
  function isEndReason(x) {
    return x === 'points' || x === 'deadlock';
  }

  /** GameState 에 적힌 항목만 옮기는 깊은 복사. endReason 은 있을 때만 옮긴다(끝나기 전에는 항목 자체가 없다).
   * @param {GameState} s @returns {GameState} */
  function cloneState(s) {
    const players = new Array(s.players.length);
    for (let i = 0; i < s.players.length; i++) players[i] = clonePlayer(s.players[i]);
    /** @type {GameState} */
    const out = {
      numPlayers: s.numPlayers,
      firstPlayer: s.firstPlayer,
      current: s.current,
      phase: s.phase,
      supply: copyTokens(s.supply),
      decks: { 1: s.decks[1].slice(), 2: s.decks[2].slice(), 3: s.decks[3].slice() },
      market: { 1: s.market[1].slice(), 2: s.market[2].slice(), 3: s.market[3].slice() },
      nobles: s.nobles.slice(),
      players,
      nobleClaimedThisTurn: s.nobleClaimedThisTurn,
      autoPassed: s.autoPassed,
      finalRoundBy: s.finalRoundBy,
      turnsTaken: s.turnsTaken,
      winners: s.winners ? s.winners.slice() : null,
      autoPassStreak: streakOf(s),
    };
    if (isEndReason(s.endReason)) out.endReason = s.endReason;
    return out;
  }

  /* ───────────── 난수 ───────────── */

  /** 어떤 수든 32비트 부호 없는 정수 seed 로 바꾼다. 정수는 아래 32비트를 그대로 쓰고,
   * 정수가 아닌 수(예: 0~1 사이 소수)는 64비트 표현을 접어서 쓴다(모두 0 으로 뭉개지지 않게). */
  function toSeed(seed) {
    if (typeof seed !== 'number' || !Number.isFinite(seed)) return 0;
    if (Number.isInteger(seed)) return seed >>> 0;
    const f = new Float64Array(1);
    f[0] = seed;
    const u = new Uint32Array(f.buffer);
    return (u[0] ^ Math.imul(u[1], 0x9e3779b1)) >>> 0;
  }

  /** mulberry32. 같은 seed → 같은 수열, 값은 [0,1).
   * @param {number} seed @returns {() => number} */
  function rng(seed) {
    let a = toSeed(seed);
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 피셔–예이츠. 받은 배열 자체를 섞는다(createGame 안에서 새로 만든 배열에만 쓴다).
   * @param {string[]} arr @param {() => number} rand */
  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /* ───────────── 판 만들기 ───────────── */

  /** @param {{numPlayers:number, firstPlayer:number, seed:number}} opts @returns {GameState} */
  function createGame(opts) {
    if (opts === null || typeof opts !== 'object') throw new TypeError('createGame: opts 가 필요합니다');
    const n = opts.numPlayers;
    if (!(n === 2 || n === 3 || n === 4)) throw new RangeError('createGame: numPlayers 는 2~4 여야 합니다');
    const first = opts.firstPlayer;
    if (typeof first !== 'number' || !Number.isInteger(first) || first < 0 || first >= n) {
      throw new RangeError('createGame: firstPlayer 는 0 이상 numPlayers 미만의 정수여야 합니다');
    }
    const setup = D.SETUP[n];
    const rand = rng(opts.seed);

    // 섞는 순서는 고정: 1단계 덱 → 2단계 덱 → 3단계 덱 → 귀족
    /** @type {{1:string[], 2:string[], 3:string[]}} */
    const decks = { 1: [], 2: [], 3: [] };
    for (const c of D.cards) decks[c.tier].push(c.id);
    /** @type {{1:(string|null)[], 2:(string|null)[], 3:(string|null)[]}} */
    const market = { 1: [], 2: [], 3: [] };
    for (const tier of TIERS) {
      shuffle(decks[tier], rand);
      // 덱 배열 0번이 맨 위. 맨 위부터 4장을 공개 줄에 깐다.
      market[tier] = decks[tier].splice(0, MARKET_SLOTS);
    }
    const nobleIds = shuffle(D.nobles.map(function (x) { return x.id; }), rand).slice(0, setup.nobles);

    /** @type {PlayerState[]} */
    const players = [];
    for (let i = 0; i < n; i++) players.push({ tokens: zeroTokens(), cards: [], reserved: [], nobles: [] });

    return {
      numPlayers: n,
      firstPlayer: first,
      current: first,
      phase: 'action',
      supply: { w: setup.gems, u: setup.gems, g: setup.gems, r: setup.gems, k: setup.gems, gold: setup.gold },
      decks,
      market,
      nobles: nobleIds,
      players,
      nobleClaimedThisTurn: false,
      autoPassed: false,
      finalRoundBy: null,
      turnsTaken: 0,
      winners: null,
      autoPassStreak: 0,
    };
  }

  /* ───────────── 점수·보너스·귀족 ───────────── */

  /** @param {PlayerState} p @returns {ColorCounts} */
  function bonusesOfPlayer(p) {
    /** @type {ColorCounts} */
    const b = { w: 0, u: 0, g: 0, r: 0, k: 0 };
    for (let i = 0; i < p.cards.length; i++) {
      const c = cardOf(p.cards[i]);
      if (c) b[c.bonus]++;
    }
    return b;
  }

  /** @param {PlayerState} p @returns {number} */
  function scoreOfPlayer(p) {
    let s = 0;
    for (let i = 0; i < p.cards.length; i++) {
      const c = cardOf(p.cards[i]);
      if (c) s += c.points;
    }
    for (let i = 0; i < p.nobles.length; i++) {
      const nb = nobleOf(p.nobles[i]);
      if (nb) s += nb.points;
    }
    return s;
  }

  /** @param {GameState} state @param {number} seat @returns {number} */
  function scoreOf(state, seat) {
    return isSeat(state, seat) ? scoreOfPlayer(state.players[seat]) : 0;
  }

  /** @param {GameState} state @param {number} seat @returns {ColorCounts} */
  function bonusesOf(state, seat) {
    return isSeat(state, seat) ? bonusesOfPlayer(state.players[seat]) : { w: 0, u: 0, g: 0, r: 0, k: 0 };
  }

  /** 귀족 조건은 보너스(산 카드의 색)만 센다. 토큰은 세지 않는다.
   * @param {ColorCounts} bonuses @param {NobleDef} noble @returns {boolean} */
  function meetsNoble(bonuses, noble) {
    if (!bonuses || !noble || !noble.require) return false;
    const q = noble.require;
    return bonuses.w >= q.w && bonuses.u >= q.u && bonuses.g >= q.g && bonuses.r >= q.r && bonuses.k >= q.k;
  }

  /* ───────────── 지불 ───────────── */

  /** 보석 먼저, 모자라는 만큼 황금. 황금까지 모자라면 null.
   * @param {TokenCounts} tokens @param {ColorCounts} bonuses @param {CardDef} card @returns {TokenCounts|null} */
  function suggestPayment(tokens, bonuses, card) {
    if (!tokens || !bonuses || !card || !card.cost) return null;
    const pay = zeroTokens();
    let gold = 0;
    for (let i = 0; i < 5; i++) {
      const c = COLORS[i];
      const need = card.cost[c] - bonuses[c];
      if (need <= 0) continue; // 보너스가 비용을 넘어도 돌려받는 것은 없다
      const gem = tokens[c] < need ? tokens[c] : need;
      pay[c] = gem;
      gold += need - gem;
    }
    if (gold > tokens.gold) return null;
    pay.gold = gold;
    return pay;
  }

  /** 더 내거나 덜 내는 지불은 거부한다.
   * @param {TokenCounts} tokens @param {ColorCounts} bonuses @param {CardDef} card @param {TokenCounts} payment @returns {boolean} */
  function isValidPayment(tokens, bonuses, card, payment) {
    if (!isTokenCounts(tokens) || !isColorCounts(bonuses) || !isTokenCounts(payment)) return false;
    if (!card || !isColorCounts(card.cost)) return false;
    let goldNeeded = 0;
    for (let i = 0; i < 5; i++) {
      const c = COLORS[i];
      const need = card.cost[c] > bonuses[c] ? card.cost[c] - bonuses[c] : 0;
      const p = payment[c];
      if (p > need || p > tokens[c]) return false;
      goldNeeded += need - p;
    }
    return payment.gold === goldNeeded && payment.gold <= tokens.gold;
  }

  /* ───────────── 순위 ───────────── */

  /** 점수 높은 순 → 산 카드 적은 순 → 둘 다 같으면 같은 순위. 같은 순위 다음은 건너뛴다(1,1,3).
   * @param {GameState} state @returns {Standing[]} */
  function standings(state) {
    /** @type {Standing[]} */
    const rows = [];
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      rows.push({ seat: i, score: scoreOfPlayer(p), cardCount: p.cards.length, rank: 0, winner: false });
    }
    rows.sort(function (a, b) {
      return (b.score - a.score) || (a.cardCount - b.cardCount) || (a.seat - b.seat);
    });
    for (let i = 0; i < rows.length; i++) {
      const prev = i > 0 ? rows[i - 1] : null;
      rows[i].rank = prev && prev.score === rows[i].score && prev.cardCount === rows[i].cardCount ? prev.rank : i + 1;
      rows[i].winner = rows[i].rank === 1;
    }
    return rows;
  }

  /* ───────────── 가능한 수 ───────────── */

  /** 공급처에 1개 이상 남은 보석 색(COLORS 순서)
   * @param {TokenCounts} supply @returns {Color[]} */
  function availableColors(supply) {
    /** @type {Color[]} */
    const out = [];
    for (let i = 0; i < 5; i++) if (supply[COLORS[i]] > 0) out.push(COLORS[i]);
    return out;
  }

  /** 그 자리가 지금 할 수 있는 행동(take3·take2·reserve·reserveDeck·buy)이 하나라도 있는가. 자동 패스 판정용.
   * @param {GameState} state @param {number} seat @returns {boolean} */
  function hasAnyAction(state, seat) {
    const p = state.players[seat];
    const supply = state.supply;
    // 보석이 한 색이라도 남아 있으면 '서로 다른 색 가져오기'를 할 수 있다(같은 색 2개는 이 조건에 포함된다)
    for (let i = 0; i < 5; i++) if (supply[COLORS[i]] > 0) return true;
    const canReserve = p.reserved.length < RESERVE_LIMIT;
    if (canReserve) {
      for (const tier of TIERS) if (state.decks[tier].length > 0) return true;
    }
    const bonuses = bonusesOfPlayer(p);
    for (const tier of TIERS) {
      const row = state.market[tier];
      for (let i = 0; i < row.length; i++) {
        const c = cardOf(row[i]);
        if (!c) continue;
        if (canReserve) return true;
        if (suggestPayment(p.tokens, bonuses, c)) return true;
      }
    }
    for (let i = 0; i < p.reserved.length; i++) {
      const c = cardOf(p.reserved[i].id);
      if (c && suggestPayment(p.tokens, bonuses, c)) return true;
    }
    return false;
  }

  /** @param {GameState} state @param {number} seat @param {Move[]} out */
  function pushActionMoves(state, seat, out) {
    const p = state.players[seat];
    const supply = state.supply;

    // 서로 다른 색: 3색 이상 남았으면 3색 조합 전부, 3색 미만이면 남은 색 전부를 한 번에(2개 또는 1개)
    const avail = availableColors(supply);
    if (avail.length >= 3) {
      for (let a = 0; a < avail.length - 2; a++) {
        for (let b = a + 1; b < avail.length - 1; b++) {
          for (let c = b + 1; c < avail.length; c++) {
            out.push({ type: 'take3', colors: [avail[a], avail[b], avail[c]] });
          }
        }
      }
    } else if (avail.length > 0) {
      out.push({ type: 'take3', colors: avail.slice() });
    }

    // 같은 색 2개: 가져가기 전에 4개 이상
    for (let i = 0; i < 5; i++) {
      if (supply[COLORS[i]] >= 4) out.push({ type: 'take2', color: COLORS[i] });
    }

    // 예약: 3장 미만일 때만. 덱이 빈 단계의 덱 예약은 뺀다.
    if (p.reserved.length < RESERVE_LIMIT) {
      for (const tier of TIERS) {
        const row = state.market[tier];
        for (let i = 0; i < row.length; i++) {
          if (cardOf(row[i])) out.push({ type: 'reserve', cardId: row[i] });
        }
      }
      for (const tier of TIERS) {
        if (state.decks[tier].length > 0) out.push({ type: 'reserveDeck', tier });
      }
    }

    // 구매: 공개 카드와 자기 예약 카드. 카드마다 하나, 지불은 보석 먼저 쓰는 제안 조합.
    const bonuses = bonusesOfPlayer(p);
    for (const tier of TIERS) {
      const row = state.market[tier];
      for (let i = 0; i < row.length; i++) {
        const c = cardOf(row[i]);
        if (!c) continue;
        const pay = suggestPayment(p.tokens, bonuses, c);
        if (pay) out.push({ type: 'buy', cardId: c.id, payment: pay });
      }
    }
    for (let i = 0; i < p.reserved.length; i++) {
      const c = cardOf(p.reserved[i].id);
      if (!c) continue;
      const pay = suggestPayment(p.tokens, bonuses, c);
      if (pay) out.push({ type: 'buy', cardId: c.id, payment: pay });
    }
  }

  /** 넘는 만큼(excess)을 반납하는 서로 다른 조합 전부
   * @param {TokenCounts} tokens @param {number} excess @param {Move[]} out */
  function pushReturnMoves(tokens, excess, out) {
    const cur = [0, 0, 0, 0, 0];
    /** @param {number} i @param {number} left */
    function rec(i, left) {
      if (i === 5) {
        if (left <= tokens.gold) {
          out.push({ type: 'return', tokens: { w: cur[0], u: cur[1], g: cur[2], r: cur[3], k: cur[4], gold: left } });
        }
        return;
      }
      const have = tokens[COLORS[i]];
      const max = have < left ? have : left;
      for (let n = max; n >= 0; n--) {
        cur[i] = n;
        rec(i + 1, left - n);
      }
      cur[i] = 0;
    }
    rec(0, excess);
  }

  /** @param {GameState} state @param {number} seat @param {Move[]} out */
  function pushNobleMoves(state, seat, out) {
    if (state.nobleClaimedThisTurn) return;
    const bonuses = bonusesOfPlayer(state.players[seat]);
    for (let i = 0; i < state.nobles.length; i++) {
      const nb = nobleOf(state.nobles[i]);
      if (nb && meetsNoble(bonuses, nb)) out.push({ type: 'claimNoble', nobleId: nb.id });
    }
  }

  /** 'return' 단계에서 반납해야 하는 개수 */
  function excessOf(p) {
    const over = tokenTotal(p.tokens) - TOKEN_LIMIT;
    return over > 0 ? over : 0;
  }

  /** @param {GameState} state @param {number} seat @returns {Move[]} */
  function legalMoves(state, seat) {
    /** @type {Move[]} */
    const out = [];
    if (!state || state.phase === 'over' || !isSeat(state, seat) || seat !== state.current) return out;
    if (state.phase === 'action') {
      pushActionMoves(state, seat, out);
    } else if (state.phase === 'return') {
      const p = state.players[seat];
      pushReturnMoves(p.tokens, excessOf(p), out);
      pushNobleMoves(state, seat, out);
    } else if (state.phase === 'end') {
      pushNobleMoves(state, seat, out);
      out.push({ type: 'endTurn' });
    }
    return out;
  }

  /* ───────────── 수 적용 ───────────── */

  /** @param {RulesError} error @returns {ApplyResult} */
  function fail(error) {
    return { ok: false, error };
  }

  /** 수의 모양만 본다(판 상태와 무관). 알맞으면 정리된 사본을, 아니면 null.
   * 정리된 사본에는 형식에 적힌 항목만 담기므로, 들어온 객체의 군더더기가 상태·사건으로 새지 않는다.
   * @returns {Move|null} */
  function normalizeMove(move) {
    if (move === null || typeof move !== 'object' || Array.isArray(move)) return null;
    const m = /** @type {any} */ (move);
    switch (m.type) {
      case 'take3': {
        if (!Array.isArray(m.colors) || m.colors.length < 1 || m.colors.length > 3) return null;
        /** @type {Color[]} */
        const colors = [];
        for (let i = 0; i < m.colors.length; i++) {
          const c = m.colors[i];
          if (!isColor(c) || colors.indexOf(c) !== -1) return null; // 황금·모르는 색·중복 색
          colors.push(c);
        }
        return { type: 'take3', colors };
      }
      case 'take2':
        return isColor(m.color) ? { type: 'take2', color: m.color } : null;
      case 'reserve':
        return cardOf(m.cardId) ? { type: 'reserve', cardId: m.cardId } : null;
      case 'reserveDeck':
        return m.tier === 1 || m.tier === 2 || m.tier === 3 ? { type: 'reserveDeck', tier: m.tier } : null;
      case 'buy':
        return cardOf(m.cardId) && isTokenCounts(m.payment)
          ? { type: 'buy', cardId: m.cardId, payment: copyTokens(m.payment) }
          : null;
      case 'return':
        return isTokenCounts(m.tokens) ? { type: 'return', tokens: copyTokens(m.tokens) } : null;
      case 'claimNoble':
        return nobleOf(m.nobleId) ? { type: 'claimNoble', nobleId: m.nobleId } : null;
      case 'endTurn':
        return { type: 'endTurn' };
      default:
        return null;
    }
  }

  /** 그 종류의 수를 지금 단계에서 둘 수 있는가 */
  function phaseAllows(phase, type) {
    switch (type) {
      case 'take3':
      case 'take2':
      case 'reserve':
      case 'reserveDeck':
      case 'buy':
        return phase === 'action';
      case 'return':
        return phase === 'return';
      case 'claimNoble':
        return phase === 'return' || phase === 'end';
      case 'endTurn':
        return phase === 'end';
      default:
        return false;
    }
  }

  /** 행동 뒤 단계: 10개를 넘으면 반납, 아니면 차례 끝 대기.
   * 실제 행동(take3·take2·reserve·reserveDeck·buy)이 있었으므로 연속 자동 패스 수는 0 으로 돌아간다.
   * @param {GameState} s @param {number} seat */
  function afterAction(s, seat) {
    s.phase = tokenTotal(s.players[seat].tokens) > TOKEN_LIMIT ? 'return' : 'end';
    s.autoPassStreak = 0;
  }

  /** 판을 끝낸다: 'over' 단계, 종료 이유, 승자(순위 1위 전부). 교착이면 deadlock 사건, 이어서 gameOver 사건.
   * @param {GameState} s @param {'points'|'deadlock'} reason @param {GameEvent[]} events */
  function finishGame(s, reason, events) {
    s.phase = 'over';
    s.endReason = reason;
    /** @type {number[]} */
    const winners = [];
    const table = standings(s);
    for (let i = 0; i < table.length; i++) if (table[i].winner) winners.push(table[i].seat);
    winners.sort(function (a, b) { return a - b; });
    s.winners = winners;
    if (reason === 'deadlock') events.push({ type: 'deadlock' });
    events.push({ type: 'gameOver', winners: winners.slice() });
  }

  /** 공개 줄의 빈칸을 같은 단계 덱 맨 위 카드로 채운다. 덱이 비었으면 빈 채(null)로 둔다.
   * @param {GameState} s @param {Tier} tier @param {number} slot */
  function refill(s, tier, slot) {
    const deck = s.decks[tier];
    s.market[tier][slot] = deck.length > 0 ? deck.shift() : null;
  }

  /** @param {GameState} state @param {number} seat @param {Move} move @returns {ApplyResult} */
  function applyMove(state, seat, move) {
    // 1) 끝난 판
    if (state.phase === 'over') return fail('game_over');
    // 2) 차례
    if (!isSeat(state, seat) || seat !== state.current) return fail('not_your_turn');
    // 3) 수의 모양
    const m = normalizeMove(move);
    if (!m) return fail('bad_move');
    // 4) 단계
    if (!phaseAllows(state.phase, m.type)) return fail('wrong_phase');

    // 5) 규칙. 여기까지는 입력 상태를 읽기만 한다. 받아들일 때만 사본을 만들어 고친다.
    const p0 = state.players[seat];
    /** @type {GameEvent[]} */
    const events = [];

    switch (m.type) {
      case 'take3': {
        const availCount = availableColors(state.supply).length;
        const required = availCount < 3 ? availCount : 3;
        // 3색 이상 남았으면 반드시 3색, 3색 미만이면 남은 색 전부. 자발적으로 덜 가져갈 수 없다.
        if (required === 0 || m.colors.length !== required) return fail('illegal_move');
        for (let i = 0; i < m.colors.length; i++) {
          if (state.supply[m.colors[i]] < 1) return fail('illegal_move');
        }
        const s = cloneState(state);
        const got = zeroTokens();
        for (let i = 0; i < m.colors.length; i++) {
          const c = m.colors[i];
          s.supply[c]--;
          s.players[seat].tokens[c]++;
          got[c] = 1;
        }
        events.push({ type: 'take', seat, tokens: got });
        afterAction(s, seat);
        return { ok: true, state: s, events };
      }

      case 'take2': {
        if (state.supply[m.color] < 4) return fail('illegal_move');
        const s = cloneState(state);
        s.supply[m.color] -= 2;
        s.players[seat].tokens[m.color] += 2;
        const got = zeroTokens();
        got[m.color] = 2;
        events.push({ type: 'take', seat, tokens: got });
        afterAction(s, seat);
        return { ok: true, state: s, events };
      }

      case 'reserve': {
        const card = D.cardsById[m.cardId];
        const slot = state.market[card.tier].indexOf(card.id);
        if (slot === -1) return fail('illegal_move'); // 공개 줄에 없는 카드
        if (p0.reserved.length >= RESERVE_LIMIT) return fail('illegal_move');
        const s = cloneState(state);
        const p = s.players[seat];
        p.reserved.push({ id: card.id, fromDeck: false });
        refill(s, card.tier, slot);
        const gold = s.supply.gold > 0; // 황금이 없어도 예약은 된다. 황금만 못 받는다.
        if (gold) {
          s.supply.gold--;
          p.tokens.gold++;
        }
        events.push({ type: 'reserve', seat, tier: card.tier, cardId: card.id, fromDeck: false, gold });
        afterAction(s, seat);
        return { ok: true, state: s, events };
      }

      case 'reserveDeck': {
        if (state.decks[m.tier].length === 0) return fail('illegal_move'); // 빈 덱에서는 예약할 수 없다
        if (p0.reserved.length >= RESERVE_LIMIT) return fail('illegal_move');
        const s = cloneState(state);
        const p = s.players[seat];
        const id = s.decks[m.tier].shift();
        p.reserved.push({ id, fromDeck: true });
        const gold = s.supply.gold > 0;
        if (gold) {
          s.supply.gold--;
          p.tokens.gold++;
        }
        // 모두에게 똑같이 가는 사건이므로 카드 id 는 담지 않는다
        events.push({ type: 'reserve', seat, tier: m.tier, cardId: null, fromDeck: true, gold });
        afterAction(s, seat);
        return { ok: true, state: s, events };
      }

      case 'buy': {
        const card = D.cardsById[m.cardId];
        const slot = state.market[card.tier].indexOf(card.id);
        let reservedIdx = -1;
        if (slot === -1) {
          for (let i = 0; i < p0.reserved.length; i++) {
            if (p0.reserved[i].id === card.id) { reservedIdx = i; break; }
          }
          // 공개 줄에도 내 예약에도 없는 카드(덱 안, 남의 예약, 이미 팔린 카드)
          if (reservedIdx === -1) return fail('illegal_move');
        }
        if (!isValidPayment(p0.tokens, bonusesOfPlayer(p0), card, m.payment)) return fail('bad_payment');
        const s = cloneState(state);
        const p = s.players[seat];
        for (let i = 0; i < 6; i++) {
          const c = TOKEN_COLORS[i];
          p.tokens[c] -= m.payment[c];
          s.supply[c] += m.payment[c]; // 쓴 토큰은 황금까지 모두 공급처로
        }
        if (slot !== -1) refill(s, card.tier, slot);
        else p.reserved.splice(reservedIdx, 1);
        p.cards.push(card.id);
        events.push({ type: 'buy', seat, cardId: card.id, payment: copyTokens(m.payment), fromReserve: slot === -1 });
        afterAction(s, seat);
        return { ok: true, state: s, events };
      }

      case 'return': {
        if (tokenTotal(m.tokens) !== excessOf(p0)) return fail('illegal_move');
        for (let i = 0; i < 6; i++) {
          if (m.tokens[TOKEN_COLORS[i]] > p0.tokens[TOKEN_COLORS[i]]) return fail('illegal_move');
        }
        const s = cloneState(state);
        const p = s.players[seat];
        for (let i = 0; i < 6; i++) {
          const c = TOKEN_COLORS[i];
          p.tokens[c] -= m.tokens[c];
          s.supply[c] += m.tokens[c];
        }
        s.phase = 'end';
        events.push({ type: 'return', seat, tokens: copyTokens(m.tokens) });
        return { ok: true, state: s, events };
      }

      case 'claimNoble': {
        // 한 차례에 한 장까지
        if (state.nobleClaimedThisTurn) return fail('noble_already_claimed');
        const idx = state.nobles.indexOf(m.nobleId);
        if (idx === -1) {
          // 누가 이미 가져간 귀족이면 noble_already_claimed, 이 판에 나오지 않은 귀족이면 illegal_move
          for (let i = 0; i < state.players.length; i++) {
            if (state.players[i].nobles.indexOf(m.nobleId) !== -1) return fail('noble_already_claimed');
          }
          return fail('illegal_move');
        }
        if (!meetsNoble(bonusesOfPlayer(p0), D.noblesById[m.nobleId])) return fail('noble_not_met');
        const s = cloneState(state);
        s.nobles.splice(idx, 1); // 가져간 자리는 보충하지 않는다
        s.players[seat].nobles.push(m.nobleId);
        s.nobleClaimedThisTurn = true;
        events.push({ type: 'noble', seat, nobleId: m.nobleId });
        return { ok: true, state: s, events };
      }

      case 'endTurn': {
        const s = cloneState(state);
        const n = s.players.length;
        events.push({ type: 'endTurn', seat });
        s.turnsTaken++;
        // 종료 발동: 차례를 넘기는 시점에 15점 이상(카드+귀족)
        if (s.finalRoundBy === null && scoreOfPlayer(s.players[seat]) >= WIN_SCORE) {
          s.finalRoundBy = seat;
          events.push({ type: 'finalRound', seat });
        }
        s.nobleClaimedThisTurn = false;
        s.autoPassed = false;
        // 마지막 순서 = 선 플레이어 바로 앞 자리. 종료가 발동된 뒤 이 자리가 차례를 마치면 끝난다.
        const lastSeat = (s.firstPlayer + n - 1) % n;
        if (s.finalRoundBy !== null && seat === lastSeat) {
          finishGame(s, 'points', events);
          return { ok: true, state: s, events };
        }
        const next = (seat + 1) % n;
        s.current = next;
        if (hasAnyAction(s, next)) {
          // 행동할 수 있는 자리는 반드시 행동하므로 연속 자동 패스 수는 그 행동(afterAction)에서 0 이 된다.
          s.phase = 'action';
        } else {
          // 자동 패스: 둘 수 있는 행동이 없으면 곧바로 'end' 단계. 귀족 받기와 차례 넘기기는 본인이 한다.
          events.push({ type: 'autoPass', seat: next });
          s.autoPassStreak = streakOf(s) + 1;
          if (s.autoPassStreak >= n) {
            // 교착: 실제 행동 없이 모든 자리가 한 바퀴 자동 패스됐다. 자동 패스는 판을 바꾸지 않고 귀족 받기는
            // 행동 가능 여부를 바꾸지 않으므로 판은 더 변할 수 없다. 마지막 라운드 없이 그 자리에서 끝낸다.
            finishGame(s, 'deadlock', events);
          } else {
            s.autoPassed = true;
            s.phase = 'end';
          }
        }
        return { ok: true, state: s, events };
      }

      default:
        return fail('bad_move');
    }
  }

  /* ───────────── 화면 정보 ───────────── */

  /** @param {GameState} state @param {number|null} seat @returns {PlayerView} */
  function viewFor(state, seat) {
    const you = seat !== null && isSeat(state, seat) ? seat : null;
    /** @type {PlayerPublicView[]} */
    const players = [];
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      /** @type {ReservedView[]} */
      const reserved = [];
      for (let j = 0; j < p.reserved.length; j++) {
        const r = p.reserved[j];
        if (r.fromDeck && i !== you) {
          // 남이 덱에서 예약한 카드: 단계(뒷면)만. id 는 담지 않는다.
          const c = cardOf(r.id);
          reserved.push({ hidden: true, tier: c ? c.tier : 1 });
        } else {
          reserved.push({ id: r.id, fromDeck: !!r.fromDeck });
        }
      }
      players.push({
        tokens: copyTokens(p.tokens),
        tokenTotal: tokenTotal(p.tokens),
        bonuses: bonusesOfPlayer(p),
        score: scoreOfPlayer(p),
        cards: p.cards.slice(),
        reserved,
        nobles: p.nobles.slice(),
      });
    }
    /** @type {PlayerView} */
    const view = {
      you,
      numPlayers: state.numPlayers,
      firstPlayer: state.firstPlayer,
      current: state.current,
      phase: state.phase,
      supply: copyTokens(state.supply),
      deckCounts: { 1: state.decks[1].length, 2: state.decks[2].length, 3: state.decks[3].length },
      market: { 1: state.market[1].slice(), 2: state.market[2].slice(), 3: state.market[3].slice() },
      nobles: state.nobles.slice(),
      players,
      nobleClaimedThisTurn: state.nobleClaimedThisTurn,
      autoPassed: state.autoPassed,
      finalRoundBy: state.finalRoundBy,
      turnsTaken: state.turnsTaken,
      winners: state.winners ? state.winners.slice() : null,
      legal: you !== null ? legalMoves(state, you) : [],
    };
    // 판이 끝났을 때만 종료 이유를 싣는다(끝나기 전에는 항목 자체가 없다)
    if (isEndReason(state.endReason)) view.endReason = state.endReason;
    return view;
  }

  Zap.rules = {
    createGame,
    legalMoves,
    applyMove,
    viewFor,
    scoreOf,
    bonusesOf,
    suggestPayment,
    isValidPayment,
    meetsNoble,
    standings,
    rng,
  };
})();
