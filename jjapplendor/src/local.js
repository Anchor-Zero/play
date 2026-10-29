// @ts-check
/*
 * 짭플렌더 — 한 화면에서 두기 (Zap.local)
 *
 * 연결(PeerJS) 없이 페이지 안에서 방 하나(Zap.room.createRoom)를 만들고, 자리마다 기기 안 연결과 같은 형태의
 * ClientConnection 을 붙인다. 화면은 온라인 대전과 똑같이 이 연결로만 수를 보내고 화면 정보를 받는다.
 * 메시지는 net.js 의 기기 안 연결과 같은 성질이다: 비동기로(마이크로태스크) 차례대로, JSON 복사본으로 오간다.
 * 저장소·타이머·DOM 을 쓰지 않는다.
 */
(function () {
  'use strict';

  /**
   * 한 화면 모드의 손잡이.
   * @typedef {Object} LocalHandle
   * @property {ClientConnection[]} clients   자리 번호 순서의 연결 (clients[i] 가 i번 자리)
   * @property {(cmd:AdminCommand) => {ok:true}|{ok:false, error:RoomError}} command   서버 권한의 명령 (시작·새 판)
   * @property {() => RoomSnapshot} snapshot
   * @property {(ev:'change'|'events', fn:(data:any) => void) => void} on   'change' → RoomSnapshot, 'events' → GameEvent[]
   * @property {() => void} close
   */

  /** @param {any} v */
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /**
   * @param {{names:string[], seed?:number}} opts  자리 순서대로의 이름 (2~4명)
   * @returns {LocalHandle}  이름이 받아들여지지 않으면 Error(오류 코드)를 던진다
   */
  function open(opts) {
    const names = opts.names.slice();
    /** @type {Record<string, Array<(data:any) => void>>} */
    const listeners = { change: [], events: [] };
    let closed = false;

    /** 모든 메시지가 지나는 우편함: 보낸 순서대로, 지금 실행 중인 코드가 끝난 뒤에 전달한다 */
    /** @type {Array<() => void>} */
    const mailbox = [];
    let draining = false;
    /** @param {() => void} fn */
    function post(fn) {
      mailbox.push(fn);
      if (draining) return;
      draining = true;
      Promise.resolve().then(function () {
        try {
          while (mailbox.length) {
            const job = /** @type {() => void} */ (mailbox.shift());
            try { job(); } catch (e) { if (globalThis.console) globalThis.console.error(e); }
          }
        } finally {
          draining = false;
        }
      });
    }

    /** @param {string} ev @param {any} data */
    function emit(ev, data) {
      for (const fn of (listeners[ev] || []).slice()) {
        try { fn(data); } catch (e) { if (globalThis.console) globalThis.console.error(e); }
      }
    }

    /** @type {Record<string, (msg:ServerMsg) => void>} */
    const deliverTo = {};
    const ids = names.map(function (_n, i) { return 'seat' + i; });

    /** @type {RoomOptions} */
    const roomOpts = {
      roomCode: 'LOCAL',
      send: function (connId, msg) {
        if (closed) return;
        const copy = clone(msg);
        post(function () {
          if (closed) return;
          if (connId === ids[0] && copy.type === 'events') emit('events', clone(copy.events));
          const fn = deliverTo[connId];
          if (fn) fn(copy);
        });
      },
      kick: function () { /* 한 화면 모드에는 넘겨받을 연결이 없다 */ },
      onChange: function (snap) {
        if (closed) return;
        const copy = clone(snap);
        post(function () { if (!closed) emit('change', copy); });
      },
    };
    if (typeof opts.seed === 'number') roomOpts.seed = opts.seed;
    const room = Zap.room.createRoom(roomOpts);

    /**
     * @param {string} connId
     * @returns {ClientConnection}
     */
    function makeClient(connId) {
      /** @type {Record<string, Array<(data:any) => void>>} */
      const ls = { room: [], state: [], events: [], error: [], status: [] };
      /** @type {ConnStatus} */
      let status = 'open';
      /** @type {RoomInfo|null} */
      let info = null;
      /** @type {PlayerView|null} */
      let view = null;
      /** @param {string} ev @param {any} data */
      const fire = function (ev, data) {
        for (const fn of (ls[ev] || []).slice()) {
          try { fn(data); } catch (e) { if (globalThis.console) globalThis.console.error(e); }
        }
      };
      deliverTo[connId] = function (msg) {
        if (status === 'closed') return;
        if (msg.type === 'room') {
          info = msg.room;
          if (info.status === 'lobby') view = null;
          fire('room', info);
        } else if (msg.type === 'state') {
          view = msg.view;
          fire('state', view);
        } else if (msg.type === 'events') {
          fire('events', msg.events);
        } else if (msg.type === 'error') {
          /** @type {{code:string, detail?:string}} */
          const err = { code: String(msg.code) };
          if (typeof msg.detail === 'string') err.detail = msg.detail;
          fire('error', err);
        }
      };
      /** @param {ClientMsg} msg */
      const request = function (msg) {
        if (closed || status === 'closed') {
          Promise.resolve().then(function () { fire('error', { code: 'bad_state', detail: 'not_connected' }); });
          return;
        }
        const copy = clone(msg);
        post(function () { if (!closed) room.receive(connId, copy); });
      };
      return {
        join: function (name) { request({ type: 'join', name: String(name), key: connId }); },
        claim: function (name) { request({ type: 'claim', name: String(name), key: connId }); },
        move: function (move) { request({ type: 'move', move: move }); },
        admin: function (cmd) { request({ type: 'admin', cmd: cmd }); },
        on: function (ev, fn) { if (ls[ev] && typeof fn === 'function') ls[ev].push(fn); },
        status: function () { return status; },
        room: function () { return info; },
        view: function () { return view; },
        close: function () {
          if (status === 'closed') return;
          status = 'closed';
          fire('status', 'closed');
        },
      };
    }

    const clients = ids.map(makeClient);

    // 자리 순서대로 들어온다. 방에 바로 반영되도록 여기서는 곧바로 넣고(답은 우편함으로 온다), 이후의 요청은 모두 우편함을 거친다.
    for (let i = 0; i < ids.length; i++) {
      room.connect(ids[i]);
      room.receive(ids[i], { type: 'hello' });
      room.receive(ids[i], { type: 'join', name: names[i], key: ids[i] });
    }
    const seated = room.snapshot().room.participants;
    if (seated.length !== names.length) {
      closed = true;
      throw new Error(names.length < 2 ? 'not_enough_players' : 'bad_name');
    }

    return {
      clients: clients,
      command: function (cmd) { return room.serverCommand(clone(cmd)); },
      snapshot: function () { return room.snapshot(); },
      on: function (ev, fn) { if (listeners[ev] && typeof fn === 'function') listeners[ev].push(fn); },
      close: function () {
        if (closed) return;
        for (const c of clients) c.close();
        closed = true;
        for (const id of ids) { try { room.disconnect(id); } catch (e) { /* 무시 */ } }
      },
    };
  }

  /** @type {any} */ (Zap).local = { open: open };
})();
