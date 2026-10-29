// @ts-check
/*
 * 짭플렌더 — 방 운영 (room.js)
 *
 * 방 하나가 판 하나를 연다. 연결 방식(PeerJS·기기 안 연결)은 모른다. 연결 id 와 메시지 전달은 net.js 가 맡고,
 * 여기는 "누가 어느 자리인가, 누가 방장인가, 판을 언제 시작하는가, 수를 받아 규칙 처리에 넘기고 결과를 누구에게 보내는가"만 다룬다.
 * DOM·저장소를 쓰지 않으므로 Node 에서 그대로 돈다. 타이머는 대기실에서 끊긴 참가자를 얼마 뒤 목록에서 빼는 데만 쓴다.
 *
 * 들어오는 메시지는 네트워크에서 온 임의 데이터로 취급한다. 모양이 틀리면 bad_message 로 답하고 상태는 바꾸지 않는다.
 */
(function () {
  'use strict';

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 4;
  const NAME_MAX = 12;
  const KEY_MAX = 128;
  const LOBBY_GRACE_MS = 180000;
  /** 자리를 key 로 넘겨받을 때 옛 연결에 보내는 error 의 detail. net.js 가 이 값을 보고 자리 되찾기를 멈춘다. */
  const TAKEN_OVER = 'taken_over';

  /**
   * @typedef {Object} Member   방 안의 참가자 한 명 (내부용)
   * @property {string} name     화면에 보이는 이름 (앞뒤 공백 제거, NFC)
   * @property {string} norm     비교용 이름 (소문자)
   * @property {string} key      그 자리를 잡은 탭이 만든 문자열 ('' 이면 넘겨받기 불가)
   * @property {string|null} connId  지금 이 자리에 붙어 있는 연결 (끊겼으면 null)
   * @property {number|null} seat    판이 시작되면 자리 번호
   * @property {any} graceTimer      대기실에서 끊긴 뒤 목록에서 빼기까지 기다리는 타이머 (없으면 null)
   */

  /** @param {any} v */
  function isObj(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  /** 비교용 이름: 앞뒤 공백 제거 → NFC → 소문자. 문자열이 아니면 null.
   * @param {any} raw @returns {string|null} */
  function normOf(raw) {
    if (typeof raw !== 'string') return null;
    return raw.trim().normalize('NFC').toLowerCase();
  }

  /** 새 이름 검사. 통과하면 화면용 이름을 돌려주고, 아니면 null.
   * @param {any} raw @returns {string|null} */
  function cleanName(raw) {
    if (typeof raw !== 'string') return null;
    const name = raw.trim().normalize('NFC');
    const len = Array.from(name).length;
    if (len < 1 || len > NAME_MAX) return null;
    // 제어 문자·줄바꿈·방향 제어 문자는 화면을 깨뜨릴 수 있어 받지 않는다.
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(name)) return null;
    // 'random' 은 선 플레이어 방식(FirstChoice)에서 '무작위'를 뜻하는 예약어라 이름으로 쓸 수 없다.
    if (name.toLowerCase() === 'random') return null;
    return name;
  }

  /**
   * @param {RoomOptions} opts
   * @returns {Room}
   */
  function createRoom(opts) {
    const roomCode = String(opts.roomCode);
    const hasSeed = typeof opts.seed === 'number' && isFinite(opts.seed);
    const seedBase = hasSeed ? Math.floor(/** @type {number} */ (opts.seed)) : 0;
    const graceMs = typeof opts.lobbyGraceMs === 'number' && opts.lobbyGraceMs >= 0 ? opts.lobbyGraceMs : LOBBY_GRACE_MS;

    /** @type {RoomStatus} */
    let status = 'lobby';
    /** 들어온 순서 @type {Member[]} */
    let members = [];
    /** 방장의 비교용 이름 @type {string|null} */
    let leaderNorm = null;
    /** 연결 id → 그 연결이 차지한 참가자(없으면 null) @type {Map<string, {member: Member|null}>} */
    const conns = new Map();
    /** @type {GameState|null} */
    let game = null;
    let gamesStarted = 0;

    /* ───────── 보내기 ───────── */

    /** @param {string} connId @param {ServerMsg} msg */
    function send(connId, msg) {
      try {
        opts.send(connId, msg);
      } catch (e) {
        // 한 연결로 보내다 실패해도 나머지 연결과 방 상태에는 영향을 주지 않는다.
      }
    }

    /** @param {string} connId @param {RoomError|RulesError} code @param {string} [detail] */
    function fail(connId, code, detail) {
      /** @type {ServerMsg} */
      const msg = detail === undefined ? { type: 'error', code } : { type: 'error', code, detail };
      send(connId, msg);
    }

    /** @param {string} norm @returns {Member|null} */
    function findMember(norm) {
      for (const m of members) if (m.norm === norm) return m;
      return null;
    }

    /** @param {string|null} connId @returns {RoomInfo} */
    function infoFor(connId) {
      const conn = connId === null ? null : conns.get(connId);
      const leader = leaderNorm === null ? null : findMember(leaderNorm);
      return {
        roomCode,
        status,
        participants: members.map((m) => ({
          name: m.name,
          connected: m.connId !== null,
          seat: m.seat,
          leader: m.norm === leaderNorm,
        })),
        you: conn && conn.member ? conn.member.name : null,
        leader: leader ? leader.name : null,
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
      };
    }

    function broadcastRoom() {
      for (const connId of Array.from(conns.keys())) send(connId, { type: 'room', room: infoFor(connId) });
    }

    /** @param {string} connId */
    function sendState(connId) {
      if (!game) return;
      const conn = conns.get(connId);
      if (!conn) return;
      const seat = conn.member ? conn.member.seat : null;
      send(connId, { type: 'state', view: Zap.rules.viewFor(game, seat) });
    }

    function broadcastState() {
      for (const connId of Array.from(conns.keys())) sendState(connId);
    }

    /** @returns {RoomSnapshot} */
    function snapshot() {
      return { room: infoFor(null), view: game ? Zap.rules.viewFor(game, null) : null };
    }

    function changed() {
      if (!opts.onChange) return;
      try {
        opts.onChange(snapshot());
      } catch (e) {
        // 서버 화면 갱신이 실패해도 방 운영은 계속한다.
      }
    }

    /* ───────── 대기실에서 끊긴 참가자의 유예 ─────────
     * 대기실에서 끊긴 사람은 바로 빼지 않고 connected:false 로 남긴다(모바일에서 앱만 오가도 순서와 자리를 잃지 않게).
     * 판 시작 뒤와 같은 규칙으로 claim 해 돌아올 수 있고, 유예 시간 동안 돌아오지 않으면 그때 목록에서 뺀다. */

    /** @param {Member} member */
    function clearGrace(member) {
      if (member.graceTimer !== null) {
        clearTimeout(member.graceTimer);
        member.graceTimer = null;
      }
    }

    /** 유예가 끝났다: 아직 대기실이고 여전히 끊겨 있으면 목록에서 뺀다 @param {Member} member */
    function expireGrace(member) {
      member.graceTimer = null;
      if (status !== 'lobby' || member.connId !== null || members.indexOf(member) < 0) return;
      members = members.filter((m) => m !== member);
      fixLeader();
      broadcastRoom();
      changed();
    }

    /** @param {Member} member */
    function startGrace(member) {
      clearGrace(member);
      const t = setTimeout(function () { expireGrace(member); }, graceMs);
      // Node 에서는 이 타이머 때문에 프로세스(시험)가 끝나지 않고 기다리는 일이 없게 한다.
      if (t && typeof (/** @type {any} */ (t)).unref === 'function') /** @type {any} */ (t).unref();
      member.graceTimer = t;
    }

    /* ───────── 방장 ───────── */

    /**
     * 방장 규칙을 다시 적용한다. 지금 방장이 접속 중이면 그대로 둔다(돌아온 원래 방장에게 되돌리지 않음).
     * 방장이 없거나 끊겼으면 접속 중인 사람 중 먼저 들어온 사람에게 넘긴다.
     * 접속 중인 사람이 아무도 없으면 그대로 두되, 목록에서 빠진 방장은 지운다.
     */
    function fixLeader() {
      const cur = leaderNorm === null ? null : findMember(leaderNorm);
      if (cur && cur.connId !== null) return;
      const next = members.find((m) => m.connId !== null);
      if (next) leaderNorm = next.norm;
      else if (!cur) leaderNorm = null;
    }

    /* ───────── 명령 (방장·서버 공통) ───────── */

    /** 명령의 모양 검사 @param {any} cmd @returns {boolean} */
    function validCommand(cmd) {
      if (!isObj(cmd)) return false;
      if (cmd.action === 'start' || cmd.action === 'newGame') return typeof cmd.first === 'string' && cmd.first.length > 0;
      if (cmd.action === 'transfer') return typeof cmd.to === 'string';
      if (cmd.action === 'remove') return typeof cmd.name === 'string';
      return false;
    }

    /** 참가자를 목록에서 뺀다 (대기실에서만 부른다) @param {Member} member */
    function dropMember(member) {
      clearGrace(member);
      members = members.filter((m) => m !== member);
      fixLeader();
      broadcastRoom();
      changed();
    }

    /** 선 플레이어 자리 정하기. 지정한 이름이 없으면 null.
     * @param {string} first @param {number} seed @returns {number|null} */
    function pickFirst(first, seed) {
      const n = members.length;
      if (first === 'random') {
        // seed 가 주어진 방(시험용)은 선 플레이어도 재현되게 하고, 아니면 그때그때 무작위.
        const r = hasSeed ? Zap.rules.rng((seed + 0x5bd1e995) >>> 0)() : Math.random();
        return Math.min(n - 1, Math.max(0, Math.floor(r * n)));
      }
      const m = findMember(/** @type {string} */ (normOf(first)));
      return m && m.seat !== null ? m.seat : null;
    }

    /** @param {FirstChoice} first @returns {{ok:true}|{ok:false, error:RoomError}} */
    function beginGame(first) {
      const seed = hasSeed ? seedBase + gamesStarted : Math.floor(Math.random() * 0x7fffffff);
      const firstPlayer = pickFirst(first, seed);
      if (firstPlayer === null) return { ok: false, error: 'no_such_seat' };
      /** @type {GameState} */
      let created;
      try {
        created = Zap.rules.createGame({ numPlayers: members.length, firstPlayer, seed });
      } catch (e) {
        return { ok: false, error: 'bad_state' }; // 규칙 처리 쪽 결함. 방 상태는 그대로 둔다
      }
      game = created;
      gamesStarted += 1;
      status = game.phase === 'over' ? 'over' : 'playing';
      broadcastRoom();
      broadcastState();
      changed();
      return { ok: true };
    }

    /** @param {AdminCommand} cmd @returns {{ok:true}|{ok:false, error:RoomError}} */
    function runCommand(cmd) {
      if (cmd.action === 'start') {
        if (status !== 'lobby') return { ok: false, error: 'bad_state' };
        if (members.length < MIN_PLAYERS || members.length > MAX_PLAYERS) return { ok: false, error: 'not_enough_players' };
        // 자리 번호는 들어온 순서(끊긴 사람도 자리를 받고, 판은 그 사람을 기다린다).
        // 지정한 선 플레이어가 없는 이름이면 자리를 되돌리고 거부한다.
        members.forEach((m, i) => { m.seat = i; });
        const res = beginGame(cmd.first);
        if (!res.ok) members.forEach((m) => { m.seat = null; });
        else members.forEach(clearGrace); // 판이 시작되면 끊긴 자리도 유지된다
        return res;
      }
      if (cmd.action === 'newGame') {
        if (status !== 'over') return { ok: false, error: 'bad_state' };
        return beginGame(cmd.first);
      }
      if (cmd.action === 'remove') {
        // 대기실에서 연결이 끊긴 참가자를 유예를 기다리지 않고 뺀다. 접속 중인 사람이나 판이 시작된 뒤의 자리는 뺄 수 없다.
        const gone = findMember(/** @type {string} */ (normOf(cmd.name)));
        if (!gone) return { ok: false, error: 'no_such_seat' };
        if (status !== 'lobby' || gone.connId !== null) return { ok: false, error: 'bad_state' };
        dropMember(gone);
        return { ok: true };
      }
      // transfer
      const target = findMember(/** @type {string} */ (normOf(cmd.to)));
      if (!target) return { ok: false, error: 'no_such_seat' };
      if (target.connId === null) return { ok: false, error: 'bad_state' }; // 끊긴 사람에게는 넘길 수 없다
      if (leaderNorm !== target.norm) {
        leaderNorm = target.norm;
        broadcastRoom();
        changed();
      }
      return { ok: true };
    }

    /* ───────── 참가자 메시지 ───────── */

    /** @param {string} connId */
    function onHello(connId) {
      send(connId, { type: 'room', room: infoFor(connId) });
      sendState(connId);
    }

    /** @param {string} connId @param {{member: Member|null}} conn @param {any} msg */
    function onJoin(connId, conn, msg) {
      if (typeof msg.name !== 'string') return fail(connId, 'bad_message');
      if (msg.key !== undefined && (typeof msg.key !== 'string' || msg.key.length > KEY_MAX)) return fail(connId, 'bad_message');
      if (conn.member) return fail(connId, 'already_joined');
      if (status !== 'lobby') return fail(connId, 'game_in_progress');
      const name = cleanName(msg.name);
      if (name === null) return fail(connId, 'bad_name');
      const norm = name.toLowerCase();
      if (findMember(norm)) return fail(connId, 'name_taken');
      if (members.length >= MAX_PLAYERS) return fail(connId, 'room_full');
      /** @type {Member} */
      const member = { name, norm, key: msg.key || '', connId, seat: null, graceTimer: null };
      members.push(member);
      conn.member = member;
      fixLeader();
      broadcastRoom();
      changed();
    }

    /** @param {string} connId @param {{member: Member|null}} conn @param {any} msg */
    function onClaim(connId, conn, msg) {
      if (typeof msg.name !== 'string') return fail(connId, 'bad_message');
      if (msg.key !== undefined && (typeof msg.key !== 'string' || msg.key.length > KEY_MAX)) return fail(connId, 'bad_message');
      if (conn.member) return fail(connId, 'already_joined');
      const member = findMember(/** @type {string} */ (normOf(msg.name)));
      if (!member) return fail(connId, 'no_such_seat');
      const key = msg.key || '';
      if (member.connId !== null) {
        // 접속 중으로 보이는 자리는 같은 key 를 가진 탭만 넘겨받는다(끊겼다 돌아왔는데 서버가 아직 모르는 경우).
        if (key === '' || member.key === '' || key !== member.key) return fail(connId, 'seat_taken');
        const oldId = member.connId;
        conns.delete(oldId); // 이후 그 연결 id 의 receive·disconnect 는 모르는 연결이므로 무시된다
        fail(oldId, 'seat_taken', TAKEN_OVER);
        if (opts.kick) {
          try { opts.kick(oldId); } catch (e) { /* 닫기 실패는 무시 */ }
        }
      }
      clearGrace(member);
      member.connId = connId;
      // 끊긴 자리를 key 와 함께 잡으면 그 key 를 이 자리의 새 key 로 삼는다(기기를 바꿔 들어온 탭도 이후 넘겨받기를 쓸 수 있게).
      if (key !== '') member.key = key;
      conn.member = member;
      fixLeader();
      broadcastRoom();
      sendState(connId);
      changed();
    }

    /** @param {string} connId @param {{member: Member|null}} conn @param {any} msg */
    function onMove(connId, conn, msg) {
      if (!isObj(msg.move)) return fail(connId, 'bad_message');
      if (!conn.member) return fail(connId, 'not_joined');
      if (!game || conn.member.seat === null) return fail(connId, 'bad_state');
      /** @type {any} */
      let res;
      try {
        res = Zap.rules.applyMove(game, conn.member.seat, msg.move);
      } catch (e) {
        return fail(connId, 'bad_move', String(e && /** @type {any} */ (e).message || e));
      }
      if (!res || res.ok !== true) return fail(connId, res && typeof res.error === 'string' ? res.error : 'bad_move');
      game = res.state;
      const finished = game.phase === 'over' && status !== 'over';
      if (finished) status = 'over';
      const events = res.events || [];
      for (const id of Array.from(conns.keys())) send(id, { type: 'events', events });
      broadcastState();
      if (finished) broadcastRoom();
      changed();
    }

    /** @param {string} connId @param {{member: Member|null}} conn @param {any} msg */
    function onAdmin(connId, conn, msg) {
      if (!validCommand(msg.cmd)) return fail(connId, 'bad_message');
      if (!conn.member) return fail(connId, 'not_joined');
      if (conn.member.norm !== leaderNorm) return fail(connId, 'not_leader');
      const res = runCommand(msg.cmd);
      if (res.ok === false) fail(connId, res.error);
    }

    /**
     * 참가자가 스스로 나간다(연결을 닫기 직전에 보냄). 대기실이면 유예 없이 바로 목록에서 뺀다(방장이면 이양).
     * 판이 시작된 뒤에는 끊김과 같게 자리를 남긴다(판이 그 사람을 기다림). 이 연결은 자리 없는 연결로 남는다.
     * @param {{member: Member|null}} conn
     */
    function onLeave(conn) {
      const member = conn.member;
      if (!member) return; // 자리 없이 나가는 연결: 바뀌는 것이 없다
      conn.member = null;
      member.connId = null;
      if (status === 'lobby') {
        dropMember(member);
        return;
      }
      fixLeader();
      broadcastRoom();
      changed();
    }

    /* ───────── 공개 함수 ───────── */

    /** @param {string} connId */
    function connect(connId) {
      if (typeof connId !== 'string' || conns.has(connId)) return;
      conns.set(connId, { member: null });
    }

    /** @param {string} connId */
    function disconnect(connId) {
      const conn = conns.get(connId);
      if (!conn) return; // 모르는 연결, 또는 key 넘겨받기로 이미 정리한 옛 연결
      conns.delete(connId);
      const member = conn.member;
      if (!member) return;
      member.connId = null;
      // 판이 시작된 뒤에는 자리를 계속 남긴다. 대기실에서는 유예 시간 동안만 남기고, 돌아오지 않으면 뺀다.
      if (status === 'lobby') {
        if (graceMs > 0) startGrace(member);
        else members = members.filter((m) => m !== member);
      }
      fixLeader();
      broadcastRoom();
      changed();
    }

    /** @param {string} connId @param {ClientMsg} msg */
    function receive(connId, msg) {
      const conn = conns.get(connId);
      if (!conn) return;
      /** @type {any} */
      const m = msg;
      try {
        if (!isObj(m) || typeof m.type !== 'string') return fail(connId, 'bad_message');
        switch (m.type) {
          case 'hello': return onHello(connId);
          case 'join': return onJoin(connId, conn, m);
          case 'claim': return onClaim(connId, conn, m);
          case 'move': return onMove(connId, conn, m);
          case 'admin': return onAdmin(connId, conn, m);
          case 'leave': return onLeave(conn);
          default: return fail(connId, 'bad_message');
        }
      } catch (e) {
        // 여기까지 오는 것은 코드 결함이다. 서버가 멈추지 않게 막고, 원인을 detail 에 남긴다.
        fail(connId, 'bad_message', 'internal: ' + String(e && /** @type {any} */ (e).message || e));
      }
    }

    /** @param {AdminCommand} cmd @returns {{ok:true}|{ok:false, error:RoomError}} */
    function serverCommand(cmd) {
      if (!validCommand(cmd)) return { ok: false, error: 'bad_message' };
      return runCommand(cmd);
    }

    return { connect, disconnect, receive, serverCommand, snapshot };
  }

  Zap.room = { createRoom };
})();
