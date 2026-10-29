// @ts-check
/*
 * 짭플렌더 — 연결 (net.js)
 *
 * 방을 연 기기의 브라우저가 서버다. 기기 사이는 PeerJS(WebRTC 데이터 채널)로 직접 잇고,
 * 중개 서비스는 처음 서로를 찾을 때만 쓴다. 이 파일은 그 연결을 room.js 의 connect / receive / disconnect 에 이어 주고,
 * 참가자 쪽에서는 끊기면 스스로 다시 붙어 기억해 둔 자리로 돌아오게 한다.
 *
 * 끊김 판단의 원칙: 타이머가 아니라 "메시지가 도착했다"는 사건을 믿는다.
 *  - 크롬은 안 보이는 탭의 타이머를 늦춘다(1초, 조건에 따라 1분 간격). 그래서 양쪽 모두 ping 을 받으면 그 자리에서(메시지 처리 중에)
 *    pong 을 돌려준다. 타이머가 느려진 탭도 상대가 물으면 바로 답하므로 살아 있는 탭이 끊긴 것으로 처리되지 않는다.
 *  - 자기 타이머가 오래 멈췄다 돌아온 것(탭이 잠들었던 것)이 보이면 그 동안의 침묵은 상대 탓으로 세지 않는다.
 *  - 데이터 연결의 close 사건은 즉시 처리한다.
 */
(function () {
  'use strict';

  /** @type {any} */
  const G = globalThis;

  const ID_PREFIX = 'jjapplendor-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0, O, 1, I 제외
  const CODE_LEN = 5;
  const HOST_CODE_KEY = 'zap.host.roomCode';
  const LAST_NAME_KEY = 'zap.lastName';
  const SEAT_KEY = 'zap.seat.';
  const PING = '_ping';
  const PONG = '_pong';
  const TAKEN_OVER = 'taken_over'; // room.js 가 자리를 넘겨준 옛 연결에 보내는 error 의 detail
  /** 서버 화면 몫의 연결 id. room 에는 자리 없는 연결(관전)로 보이며, 여기로 오는 events 를 HostHandle 의 'events' 로 내보낸다. */
  const SCREEN_CONN = '~screen';

  /** 시간 기준값(ms). 시험에서만 `Zap.net._timing` 으로 줄여 쓴다. */
  const T = {
    pingMs: 5000,           // 참가자 → 서버 ping 간격
    clientSilenceMs: 20000, // 참가자: ping 을 보냈는데 이만큼 서버 소식이 없으면 다시 연결
    probeMs: 6000,          // 참가자: 화면이 다시 보일 때 보낸 확인 ping 에 이만큼 답이 없으면 다시 연결
    hostSilenceMs: 45000,   // 서버: 이만큼 소식이 없는 연결은 닫고 끊김 처리
    hostNudgeMs: 15000,     // 서버: 이만큼 조용한 연결에는 서버가 먼저 ping (타이머가 느려진 참가자 탭을 깨워 답하게 함)
    sweepMs: 5000,          // 서버: 침묵 검사 간격
    timerGapMs: 15000,      // 타이머 간격이 이보다 벌어졌으면 '이 탭이 잠들어 있었다'로 보고 판단을 한 번 미룸
    dialTimeoutMs: 15000,   // 연결 시도 한 번의 제한 시간
    retryMs: 3000,          // 다시 시도 간격 (처음 몇 분)
    retrySlowMs: 15000,     // 오래 실패가 이어질 때의 다시 시도 간격 (중개 서비스에 부담을 주지 않게)
    retryFastCount: 60,     // 이 횟수까지는 retryMs 로 시도 (60회 × 3초 = 최소 3분)
    kickGraceMs: 300,       // 자리를 넘겨준 옛 연결을 닫기 전, 안내 메시지가 나갈 시간
    openWaitMs: 30000,      // 서버: 들어온 연결이 이만큼 열리지 않으면 버림
    hostRecoverGapMs: 10000, // 서버: 중개 서버와 끊겼을 때 '즉시' 재연결을 다시 쓰기까지의 최소 간격
    lobbyGraceMs: 180000,   // 서버: 대기실에서 끊긴 참가자를 목록에 남겨 두는 시간 (room.js 로 넘김)
    idTakenMs: 10000,       // 서버: 같은 방 코드가 이미 열려 있다는 답(unavailable-id)이 이만큼 이어지면 'id_taken' 으로 알림
    closeGraceMs: 1000,     // 스스로 닫을 때, 마지막 메시지(leave·closing)가 나갈 틈을 준 뒤 연결을 정리하기까지
    pathRetryMs: 1500,      // 연결 경로 판정: 통계가 아직 비어 있으면 이만큼 뒤 다시
    pathRetries: 3          // 연결 경로 판정: 다시 시도하는 최대 횟수 (그래도 모르면 'unknown')
  };

  /* ───────── 작은 도구 ───────── */

  function now() { return Date.now(); }

  /** @param {any} v */
  function isObj(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

  /** @param {any} v */
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /** @param {number} n @param {string} chars */
  function randomString(n, chars) {
    const buf = new Uint32Array(n);
    try {
      G.crypto.getRandomValues(buf);
    } catch (e) {
      for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 0x100000000);
    }
    let out = '';
    for (let i = 0; i < n; i++) out += chars[buf[i] % chars.length];
    return out;
  }

  function randomKey() { return randomString(20, 'abcdefghijklmnopqrstuvwxyz0123456789'); }

  /** 방 코드 정리: 대문자로, 글자·숫자만. @param {any} raw @returns {string} */
  function normCode(raw) {
    return typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  }

  /** 비교용 이름 (room.js 와 같은 방식) @param {any} raw @returns {string} */
  function normName(raw) {
    return typeof raw === 'string' ? raw.trim().normalize('NFC').toLowerCase() : '';
  }

  /** 저장소 접근은 막혀 있을 수 있다(사생활 보호 모드, 파일로 연 페이지의 설정 등). 실패해도 기억만 못 할 뿐 동작은 한다.
   * @param {'localStorage'|'sessionStorage'} kind @param {string} key @returns {string|null} */
  function storeGet(kind, key) {
    try { return G[kind].getItem(key); } catch (e) { return null; }
  }
  /** @param {'localStorage'|'sessionStorage'} kind @param {string} key @param {string} value */
  function storeSet(kind, key, value) {
    try { G[kind].setItem(key, value); } catch (e) { /* 무시 */ }
  }
  /** @param {'localStorage'|'sessionStorage'} kind @param {string} key */
  function storeDel(kind, key) {
    try { G[kind].removeItem(key); } catch (e) { /* 무시 */ }
  }

  /** 기억해 둔 자리 읽기 @param {'localStorage'|'sessionStorage'} kind @param {string} code @returns {{name:string, key:string}|null} */
  function readSeat(kind, code) {
    const raw = storeGet(kind, SEAT_KEY + code);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      if (isObj(v) && typeof v.name === 'string' && v.name) return { name: v.name, key: typeof v.key === 'string' ? v.key : '' };
    } catch (e) { /* 깨진 기록은 없는 것으로 */ }
    return null;
  }

  /** 이 기기를 가리키는 호스트 이름(127.x.x.x, localhost, ::1) */
  const LOOPBACK_HOST = /^(?:127(?:\.\d{1,3}){3}|localhost|\[?::1\]?)$/i;

  /**
   * 개발·시험 전용 ICE 설정: 중개 서버가 이 기기(?broker=127.0.0.1·localhost·[::1])로 지정된 경우에만 주소의
   * turn=호스트:포트 (&turnuser=&turnpass=) 를 읽어, 그 TURN 서버만 쓰고 중계만 허용하는 설정을 만든다(중계 경로 시험용).
   * TURN 호스트도 이 기기(127.x.x.x·localhost)만 받는다. 실제 서비스(broker 없음 = PeerJS 무료 중개)나 다른 호스트의
   * 중개 서버에서는 주소에 무엇이 있어도 null 이고, 그러면 PeerJS 기본 ICE 설정이 그대로 쓰인다.
   * @param {string} search @param {BrokerConfig} broker @returns {any|null}
   */
  function devTurnConfig(search, broker) {
    if (!broker || typeof broker.host !== 'string' || !LOOPBACK_HOST.test(broker.host)) return null;
    let q = null;
    try { q = new URLSearchParams(typeof search === 'string' ? search : ''); } catch (e) { return null; }
    const turn = q.get('turn');
    if (!turn) return null;
    const m = /^(127(?:\.\d{1,3}){3}|localhost)(?::(\d{1,5}))?$/i.exec(turn.trim());
    if (!m) return null;
    const port = m[2] === undefined ? 3478 : Number(m[2]);
    if (!(port >= 1 && port <= 65535)) return null;
    return {
      iceServers: [{ urls: 'turn:' + m[1] + ':' + port + '?transport=udp', username: q.get('turnuser') || '', credential: q.get('turnpass') || '' }],
      iceTransportPolicy: 'relay',
    };
  }

  /** 지금 페이지 주소의 ?… 부분 (없으면 '') */
  function pageSearch() {
    try { return String(G.location.search || ''); } catch (e) { return ''; }
  }

  /** @param {BrokerConfig} broker @param {string} [search] 시험용(생략하면 지금 페이지 주소) */
  function peerOptions(broker, search) {
    /** @type {any} */
    const o = { debug: 0 };
    if (broker) {
      o.host = broker.host;
      o.port = broker.port;
      o.path = broker.path;
      o.secure = broker.secure;
    }
    // ICE 설정은 넘기지 않는다(PeerJS 기본값: 구글 STUN + PeerJS 공용 TURN). 예외는 로컬 중개 서버일 때의 개발용 TURN 뿐.
    const dev = devTurnConfig(typeof search === 'string' ? search : pageSearch(), broker);
    if (dev) o.config = dev;
    return o;
  }

  function getPeerClass() {
    const Peer = /** @type {any} */ (globalThis).Peer;
    if (typeof Peer !== 'function') throw new Error('PeerJS 를 찾을 수 없습니다 (vendor/peerjs.min.js 를 먼저 불러와야 합니다).');
    return Peer;
  }

  /** 데이터 연결의 error 중 연결이 죽은 것이 아닌 종류 @param {any} err */
  function isHarmlessConnError(err) {
    const t = err && err.type;
    if (t === 'message-too-big' && G.console) G.console.error('[zap.net] 메시지가 너무 커서 보내지 못했습니다', err);
    return t === 'not-open-yet' || t === 'message-too-big';
  }

  /** 화면이 다시 보이거나 네트워크가 돌아올 때 onWake, 페이지를 떠날 때 onLeave, 떠나기 직전(beforeunload) onBeforeLeave.
   * 돌려주는 함수로 해제.
   * @param {() => void} onWake @param {() => void} onLeave @param {(e:any) => void} [onBeforeLeave] @returns {() => void} */
  function watchPage(onWake, onLeave, onBeforeLeave) {
    const doc = G.document;
    const win = G.window;
    if (!doc || !win || !win.addEventListener) return function () {};
    const vis = function () { if (doc.visibilityState === 'visible') onWake(); };
    const before = function (/** @type {any} */ e) { if (onBeforeLeave) onBeforeLeave(e); };
    doc.addEventListener('visibilitychange', vis);
    win.addEventListener('pageshow', onWake);
    win.addEventListener('online', onWake);
    win.addEventListener('pagehide', onLeave);
    if (onBeforeLeave) win.addEventListener('beforeunload', before);
    return function () {
      doc.removeEventListener('visibilitychange', vis);
      win.removeEventListener('pageshow', onWake);
      win.removeEventListener('online', onWake);
      win.removeEventListener('pagehide', onLeave);
      if (onBeforeLeave) win.removeEventListener('beforeunload', before);
    };
  }

  /* ───────── 연결 경로: 직접인가, 중계(TURN)를 거치는가 ─────────
   *
   * peerOptions 가 ICE 설정을 넘기지 않으므로 PeerJS 기본값(구글 STUN + PeerJS 공용 TURN eu-0/us-0)이 그대로 쓰인다.
   * 그래서 기기 사이를 직접 잇지 못하는 망에서도 해외 중계 서버를 거쳐 붙을 수 있는데, 연결 상태만으로는 그 차이가 보이지 않는다.
   * 연결마다 RTCPeerConnection.getStats() 의 '선택된 후보 쌍'으로 판정해 화면에 넘긴다(통신 정보라 방 정보·판 상태에는 넣지 않는다).
   * 주기적으로 묻지 않는다(모바일 배터리): 데이터 연결이 열린 직후 한 번(통계가 아직 비어 있으면 조금 뒤 몇 번 더),
   * ICE 가 끊겼다(disconnected·checking) 다시 이어질 때, 브라우저가 선택된 후보 쌍이 바뀌었다고 알릴 때(지원하는 브라우저만)뿐이다.
   */

  const DIRECT_TYPES = ['host', 'srflx', 'prflx'];

  /** 후보 종류 이름. 초기 Firefox 의 옛 이름은 표준 이름으로. @param {any} t @returns {string} */
  function candType(t) {
    if (t === 'serverreflexive') return 'srflx';
    if (t === 'peerreflexive') return 'prflx';
    if (t === 'relayed') return 'relay';
    return typeof t === 'string' ? t : '';
  }

  /** getStats() 결과(RTCStatsReport, 항목 배열, id → 항목 객체)를 항목 배열로 @param {any} stats @returns {any[]} */
  function statsList(stats) {
    /** @type {any[]} */
    let out = [];
    if (Array.isArray(stats)) out = stats;
    else if (stats && typeof stats.forEach === 'function') stats.forEach(function (/** @type {any} */ v) { out.push(v); });
    else if (isObj(stats)) out = Object.keys(stats).map(function (k) { return stats[k]; });
    return out.filter(isObj);
  }

  /** 중계 후보의 중계 서버 주소. url(크롬이 우리 쪽 relay 후보에 적는 'turn:호스트:포트?transport=udp')이 있으면 그 호스트:포트,
   * 없으면 address(옛 이름 ip):port. relatedAddress 는 쓰지 않는다(중계 뒤에 있는 우리 쪽 주소다). @param {any} c @returns {string} */
  function relayAddr(c) {
    if (!isObj(c)) return '';
    if (typeof c.url === 'string') {
      const m = /^turns?:([^?]+)/i.exec(c.url.trim());
      if (m) return m[1];
    }
    const a = typeof c.address === 'string' && c.address ? c.address : typeof c.ip === 'string' ? c.ip : '';
    if (!a) return '';
    if (!(typeof c.port === 'number' && c.port > 0)) return a;
    return (a.indexOf(':') >= 0 && a[0] !== '[' ? '[' + a + ']' : a) + ':' + c.port;
  }

  /**
   * getStats() 결과로 연결 경로를 판정한다. 순수 함수(브라우저 없이 합성한 항목 배열로 시험한다).
   * 선택된 후보 쌍: transport 항목의 selectedCandidatePairId → 없으면 selected:true 인 candidate-pair(Firefox)
   * → 없으면 state 'succeeded' 이고 nominated 인 candidate-pair(여럿이면 주고받은 바이트가 가장 많은 것).
   * 그 쌍의 이쪽·저쪽 후보 중 하나라도 'relay' 면 relay, 둘 다 host/srflx/prflx 면 direct, 쌍이나 후보를 못 찾으면 unknown.
   * @param {any} stats  RTCStatsReport 또는 그 항목들의 배열
   * @returns {ConnPath}
   */
  function classifyStats(stats) {
    const list = statsList(stats);
    /** @type {Record<string, any>} */
    const byId = {};
    for (const s of list) if (typeof s.id === 'string') byId[s.id] = s;
    /** @param {any} s */
    const isPair = function (s) { return isObj(s) && s.type === 'candidate-pair'; };
    /** @type {any} */
    let pair = null;
    for (const s of list) {
      if (s.type === 'transport' && typeof s.selectedCandidatePairId === 'string' && isPair(byId[s.selectedCandidatePairId])) {
        pair = byId[s.selectedCandidatePairId];
        break;
      }
    }
    if (!pair) pair = list.find(function (s) { return isPair(s) && s.selected === true; }) || null;
    if (!pair) {
      let most = -1;
      for (const s of list) {
        if (!isPair(s) || s.state !== 'succeeded' || s.nominated !== true) continue;
        const bytes = (Number(s.bytesSent) || 0) + (Number(s.bytesReceived) || 0);
        if (bytes > most) { most = bytes; pair = s; }
      }
    }
    /** @type {ConnPath} */
    const out = { kind: 'unknown' };
    if (!pair) return out;
    const lc = byId[pair.localCandidateId];
    const rc = byId[pair.remoteCandidateId];
    const lt = lc ? candType(lc.candidateType) : '';
    const rt = rc ? candType(rc.candidateType) : '';
    if (lt) out.local = lt;
    if (rt) out.remote = rt;
    if (lt === 'relay' || rt === 'relay') {
      out.kind = 'relay';
      const addr = (lt === 'relay' ? relayAddr(lc) : '') || (rt === 'relay' ? relayAddr(rc) : '');
      if (addr) out.relay = addr;
    } else if (DIRECT_TYPES.indexOf(lt) >= 0 && DIRECT_TYPES.indexOf(rt) >= 0) {
      out.kind = 'direct';
    }
    return out;
  }

  /** 같은 경로인지 비교하는 열쇠 @param {ConnPath|null} p @returns {string} */
  function pathKey(p) { return p ? [p.kind, p.local || '', p.remote || '', p.relay || ''].join('|') : ''; }

  /** PC 에서 확인용 콘솔 한 줄: [zap.net] path: direct|relay|unknown (누구; local=… remote=…; via 중계 서버)
   * @param {ConnPath} p @param {string} [who] */
  function logPath(p, who) {
    if (!G.console || typeof G.console.log !== 'function') return;
    const bits = [];
    if (who) bits.push(who);
    if (p.local || p.remote) bits.push('local=' + (p.local || '?') + ' remote=' + (p.remote || '?'));
    if (p.relay) bits.push('via ' + p.relay);
    G.console.log('[zap.net] path: ' + p.kind + (bits.length ? ' (' + bits.join('; ') + ')' : ''));
  }

  /** 데이터 연결 하나의 지금 경로 (판정 못 하면 unknown) @param {any} dc @returns {Promise<ConnPath>} */
  function readPath(dc) {
    /** @type {any} */
    let got = null;
    try {
      const pc = dc && dc.peerConnection;
      if (pc && typeof pc.getStats === 'function') got = pc.getStats();
    } catch (e) { got = null; }
    if (!got) return Promise.resolve({ kind: 'unknown' });
    return Promise.resolve(got).then(
      function (report) { try { return classifyStats(report); } catch (e) { return { kind: 'unknown' }; } },
      function () { return { kind: 'unknown' }; }
    );
  }

  /**
   * 열린 데이터 연결 하나의 경로를 지켜본다. 판정할 때마다 report(path) 를 부른다(같은 값이어도 부른다 — 거르는 것은 받는 쪽).
   * 판정 시점: 지금 한 번(unknown 이면 pathRetryMs 뒤 최대 pathRetries 번 더), ICE 가 끊겼다 다시 이어질 때,
   * 선택된 후보 쌍이 바뀌었다는 사건(RTCIceTransport 'selectedcandidatepairchange', 지원하는 브라우저만). 주기적 확인은 없다.
   * @param {any} dc  PeerJS DataConnection
   * @param {(p:ConnPath) => void} report
   * @returns {() => void} 그만 지켜보기
   */
  function watchPath(dc, report) {
    let stopped = false;
    let run = 0;          // 판정 회차. 새 회차가 시작되면 앞 회차의 늦은 결과와 재시도는 버린다
    /** @type {any} */ let timer = null;
    let iceDown = false;  // ICE 가 끊긴 적이 있다 → 다시 이어지면 새로 판정 (처음 이어지는 것은 열리기 전에 이미 지나갔다)
    /** @type {any} */ let ice = null;

    function probe() {
      if (stopped) return;
      const my = ++run;
      if (timer) { clearTimeout(timer); timer = null; }
      let tries = 0;
      const attempt = function () {
        timer = null;
        if (stopped || my !== run) return;
        tries += 1;
        readPath(dc).then(function (p) {
          if (stopped || my !== run) return;
          if (p.kind === 'unknown' && tries <= T.pathRetries) { timer = setTimeout(attempt, T.pathRetryMs); return; }
          report(p);
        });
      };
      attempt();
    }
    /** PeerJS 가 데이터 연결에 내는 'iceStateChanged' (RTCPeerConnection.iceConnectionState) @param {any} state */
    function onIce(state) {
      if (state === 'disconnected' || state === 'checking') iceDown = true;
      else if ((state === 'connected' || state === 'completed') && iceDown) { iceDown = false; probe(); }
    }
    function onPair() { probe(); }

    try { dc.on('iceStateChanged', onIce); } catch (e) { /* 무시 */ }
    try {
      const pc = dc.peerConnection;
      const t = pc && pc.sctp && pc.sctp.transport && pc.sctp.transport.iceTransport;
      if (t && typeof t.addEventListener === 'function') { t.addEventListener('selectedcandidatepairchange', onPair); ice = t; }
    } catch (e) { ice = null; }
    probe();
    return function () {
      if (stopped) return;
      stopped = true;
      run += 1;
      if (timer) { clearTimeout(timer); timer = null; }
      try { dc.off('iceStateChanged', onIce); } catch (e) { /* 무시 */ }
      if (ice) { try { ice.removeEventListener('selectedcandidatepairchange', onPair); } catch (e) { /* 무시 */ } ice = null; }
    };
  }

  /* ───────── 공개: 주소·방 코드 ───────── */

  /** location.search 의 broker=호스트:포트 를 읽는다. 없거나 모양이 틀리면 null(= PeerJS 무료 중개 서비스).
   * @param {string} search @returns {BrokerConfig} */
  function parseBroker(search) {
    let value = null;
    try {
      value = new URLSearchParams(typeof search === 'string' ? search : '').get('broker');
    } catch (e) {
      value = null;
    }
    if (!value) return null;
    const m = /^([A-Za-z0-9.\-_]+|\[[0-9A-Fa-f:]+\])(?::(\d{1,5}))?$/.exec(value.trim());
    if (!m) return null;
    const port = m[2] === undefined ? 9000 : Number(m[2]);
    if (!(port >= 1 && port <= 65535)) return null;
    return { host: m[1], port, path: '/', secure: false };
  }

  function newRoomCode() { return randomString(CODE_LEN, CODE_CHARS); }

  /** @param {string} roomCode */
  function peerIdFor(roomCode) { return ID_PREFIX + normCode(roomCode); }

  /** @param {string} code @param {BrokerConfig} broker */
  function makeJoinUrl(code, broker) {
    let base = '';
    try { base = String(G.location.href).split(/[?#]/)[0]; } catch (e) { base = ''; }
    let url = base + '?room=' + encodeURIComponent(code);
    if (broker) url += '&broker=' + broker.host + ':' + broker.port;
    return url;
  }

  /* ───────── 참가자 쪽 공통 부분 (원격·기기 안 연결이 함께 씀) ─────────
   *
   * 전송 방식만 빼고 같다: 받은 메시지 보관·전달, 자리 기억, 자동으로 자리 되찾기.
   */

  /**
   * @param {string} code                       방 코드
   * @param {(msg:any) => boolean} sendRaw      서버로 보내기 (보냈으면 true)
   * @param {() => void} onClose                close() 가 불렸을 때 전송 쪽 정리
   * @param {() => void} [onServerGone]         서버가 닫힌다고 알려 왔을 때(closing) 전송 쪽 처리
   * @param {() => void} [onTakenOver]          이 연결의 자리가 다른 탭·기기로 넘어갔을 때(곧 서버가 이 연결을 닫는다) 전송 쪽 처리
   */
  function createClientCore(code, sendRaw, onClose, onServerGone, onTakenOver) {
    /** 'closing' → {reason} (서버가 닫힐 때), 'path' → ConnPath|null (이 연결의 경로가 정해지거나 바뀌거나 연결을 잃었을 때)
     * @type {Record<string, Array<(data:any) => void>>} */
    const listeners = { room: [], state: [], events: [], error: [], status: [], closing: [], path: [] };
    /** @type {ConnStatus} */
    let status = 'connecting';
    /** 지금 데이터 연결의 경로. 열린 연결이 없거나 아직 판정 전이면 null (기기 안 연결은 늘 null) @type {ConnPath|null} */
    let path = null;
    /** @type {RoomInfo|null} */
    let room = null;
    /** @type {PlayerView|null} */
    let view = null;
    // 서버가 닫힌다고 알려 온 뒤 아직 다시 연결되지 않음. 그동안의 연결 상태는 모두 'server_gone' 으로 보인다.
    let serverGone = false;

    // 이 탭이 기억하는 자리. sessionStorage 는 탭마다 따로라서 '이 탭이 앉았던 자리'의 증거가 된다.
    let rec = readSeat('sessionStorage', code);
    let tabKey = rec && rec.key ? rec.key : randomKey();

    // 연결 하나 동안만 유효한 값 (opened 에서 초기화)
    let autoTried = false;    // 이 연결에서 자동으로 자리 잡기를 이미 판단했는가
    let pendingAuto = false;  // 자동 시도를 보내고 답을 기다리는 중인가
    let retryOk = false;      // 이 탭의 자리가 '접속 중'이라 실패했는가 → 그 자리가 비면 다시 시도
    let manual = false;       // 사람이 직접 join/claim 을 눌렀는가 → 이후 자동 시도 안 함
    /** @type {RoomInfo|null} */
    let heldRoom = null;      // 자동 시도 결과를 기다리는 동안 화면에 내보내지 않고 쥐고 있는 방 정보
    /** @type {PlayerView|null} */
    let heldView = null;

    /** @param {string} ev @param {any} data */
    function emit(ev, data) {
      const list = listeners[ev];
      if (!list) return;
      for (const fn of list.slice()) {
        try { fn(data); } catch (e) { if (G.console) G.console.error(e); }
      }
    }

    /** @param {ConnStatus} s */
    function setStatus(s) {
      if (serverGone && s !== 'open' && s !== 'closed') s = 'server_gone';
      if (status === 'closed' || status === s) return;
      status = s;
      emit('status', s);
    }

    /** 경로가 바뀌었으면 기억하고 'path' 사건을 낸다. 바뀌었으면 true. 닫힌 뒤에는 조용히 지운다.
     * @param {ConnPath|null} p @returns {boolean} */
    function setPath(p) {
      if (status === 'closed') { path = null; return false; }
      if (pathKey(p) === pathKey(path)) return false;
      path = p ? clone(p) : null;
      emit('path', path ? clone(path) : null);
      return true;
    }

    /** @param {string} name */
    function remember(name) {
      if (rec && rec.name === name && rec.key === tabKey) return;
      rec = { name, key: tabKey };
      const json = JSON.stringify(rec);
      storeSet('sessionStorage', SEAT_KEY + code, json);
      storeSet('localStorage', SEAT_KEY + code, json);
      storeSet('localStorage', LAST_NAME_KEY, name);
    }

    /** @param {RoomInfo} info */
    function applyRoom(info) {
      room = info;
      if (info.status === 'lobby') view = null; // 대기실에는 판이 없다 (서버가 새로 열린 경우의 옛 화면 정보 제거)
      emit('room', info);
    }

    function flushHeld() {
      const r = heldRoom;
      const v = heldView;
      heldRoom = null;
      heldView = null;
      if (r) applyRoom(r);
      if (v) { view = v; emit('state', v); }
    }

    /** @param {any} msg @returns {boolean} */
    function sendAuto(msg) {
      if (!sendRaw(msg)) return false;
      pendingAuto = true;
      return true;
    }

    /**
     * 자리가 없는 상태로 방 정보를 받았을 때, 기억으로 자리를 되찾을 수 있으면 시도한다. 시도를 보냈으면 true.
     *  - sessionStorage(이 탭의 기록, key 포함): 그 이름이 목록에 있으면 claim(name, key) — 접속 중으로 보이는 자리도 넘겨받음.
     *    목록에 없고 대기실이면 join(name).
     *  - localStorage(같은 기기 다른 탭의 기록)만 있으면: 그 이름이 끊긴 자리일 때만 key 없이 claim. 남의 자리를 빼앗지 않는다.
     * 연결 하나에 한 번만 판단한다. 예외는 하나: 이 탭의 자리가 '아직 접속 중'으로 보여 실패했을 때, 그 자리가 비면 한 번 더 잡는다.
     * @param {RoomInfo} info @returns {boolean}
     */
    function autoSeat(info) {
      if (manual) return false;
      /** @param {string} name */
      const find = function (name) {
        const n = normName(name);
        for (const p of info.participants) if (isObj(p) && normName(p.name) === n) return p;
        return null;
      };
      if (!autoTried) {
        autoTried = true;
        if (rec) {
          if (find(rec.name)) return sendAuto({ type: 'claim', name: rec.name, key: tabKey });
          if (info.status === 'lobby') return sendAuto({ type: 'join', name: rec.name, key: tabKey });
          return false;
        }
        const other = readSeat('localStorage', code);
        if (other) {
          const p = find(other.name);
          if (p && p.connected === false) return sendAuto({ type: 'claim', name: other.name });
        }
        return false;
      }
      if (retryOk && rec) {
        const p = find(rec.name);
        if (p && p.connected === false) return sendAuto({ type: 'claim', name: rec.name, key: tabKey });
      }
      return false;
    }

    /** @param {any} info */
    function onRoom(info) {
      if (!isObj(info) || !Array.isArray(info.participants)) return;
      if (typeof info.you === 'string') {
        pendingAuto = false;
        retryOk = false;
        heldRoom = null;
        heldView = null;
        remember(info.you);
        applyRoom(info);
        return;
      }
      // 자동 시도의 결과가 올 때까지는 '자리 없음' 상태를 화면에 내보내지 않는다(재접속 때마다 자리 고르기 화면이 번쩍이지 않게).
      if (pendingAuto || autoSeat(info)) {
        heldRoom = info;
        return;
      }
      applyRoom(info);
    }

    /** @param {any} msg */
    function onError(msg) {
      /** @type {{code:string, detail?:string}} */
      const err = { code: String(msg.code) };
      if (typeof msg.detail === 'string') err.detail = msg.detail;
      if (err.code === 'seat_taken' && err.detail === TAKEN_OVER) {
        // 같은 key 를 가진 다른 탭(탭 복제 등)이 이 자리를 넘겨받았다. 되찾으려 들면 두 탭이 서로 쫓아내기를 반복하므로
        // 이 탭의 기록과 key 를 버리고, 이후에는 사람이 고르게 둔다.
        rec = null;
        tabKey = randomKey();
        retryOk = false;
        pendingAuto = false;
        storeDel('sessionStorage', SEAT_KEY + code);
        flushHeld();
        // 서버(room)는 이 연결을 이미 잊어 새 방 정보를 보내 주지 않는다. 자리를 잃은 것을 안 지금 room() 에서 내 이름을 뺀다
        // (서버가 이 연결을 닫고 다시 연결되면 서버의 방 정보·관전 화면 정보로 바뀐다).
        if (room && room.you !== null) applyRoom(Object.assign({}, room, { you: null }));
        if (onTakenOver) { try { onTakenOver(); } catch (e) { /* 무시 */ } }
        emit('error', err);
        return;
      }
      if (pendingAuto) {
        // 자동 시도가 거부됨: 사람이 누른 것이 아니므로 오류로 알리지 않고, 쥐고 있던 '자리 없음' 상태를 내보낸다.
        pendingAuto = false;
        retryOk = !!rec && err.code === 'seat_taken';
        flushHeld();
        return;
      }
      emit('error', err);
    }

    /** 서버에서 온 메시지 하나 @param {any} msg */
    function handle(msg) {
      if (status === 'closed' || !isObj(msg)) return;
      if (msg.type === 'room') onRoom(msg.room);
      else if (msg.type === 'state') {
        if (!isObj(msg.view)) return;
        if (pendingAuto) { heldView = msg.view; return; }
        view = msg.view;
        emit('state', view);
      } else if (msg.type === 'events') {
        if (Array.isArray(msg.events)) emit('events', msg.events);
      } else if (msg.type === 'error') onError(msg);
      else if (msg.type === 'closing') onClosing(msg);
    }

    /** 서버가 닫힌다(서버 닫기·탭 새로 고침·탭 닫기). 진행 중이던 판은 이어지지 않는다. 계속 다시 연결을 시도하다가
     * 서버가 다시 열리면 대기실로 돌아온다. @param {any} msg */
    function onClosing(msg) {
      pendingAuto = false;
      heldRoom = null;
      heldView = null;
      serverGone = true;
      setStatus('server_gone');
      emit('closing', { reason: msg.reason === 'closed' ? 'closed' : 'reload' });
      if (onServerGone) { try { onServerGone(); } catch (e) { /* 무시 */ } }
    }

    /** 연결이 열렸다: 연결 단위 값을 초기화하고 hello 를 보낸다 */
    function opened() {
      if (status === 'closed') return;
      serverGone = false;
      autoTried = false;
      pendingAuto = false;
      retryOk = false;
      manual = false;
      heldRoom = null;
      heldView = null;
      setStatus('open');
      sendRaw({ type: 'hello' });
    }

    /** 연결을 잃었다 (상태 표시는 부르는 쪽이 정한다) */
    function lost() {
      pendingAuto = false;
      heldRoom = null;
      heldView = null;
    }

    /** 사람이 요청한 메시지 보내기. 연결이 없으면 화면이 알 수 있게 error 사건을 낸다. @param {any} msg */
    function request(msg) {
      if (status === 'open' && sendRaw(msg)) return;
      Promise.resolve().then(function () { emit('error', { code: 'bad_state', detail: 'not_connected' }); });
    }

    function manualSeat() {
      manual = true;
      if (pendingAuto) {
        pendingAuto = false;
        flushHeld();
      }
    }

    /** @type {ClientConnection} */
    const api = {
      join(name) {
        manualSeat();
        request({ type: 'join', name: String(name), key: tabKey });
      },
      claim(name) {
        manualSeat();
        // 사람이 고른 자리는 이 탭의 key 를 함께 보낸다. 끊긴 자리면 서버가 이 key 를 새로 기억하므로,
        // 이후 이 탭이 끊겼다 돌아올 때 key 로 바로 넘겨받을 수 있다. (접속 중인 남의 자리는 key 가 달라 거부된다.)
        request({ type: 'claim', name: String(name), key: tabKey });
      },
      move(move) { request({ type: 'move', move }); },
      admin(cmd) { request({ type: 'admin', cmd }); },
      on(ev, fn) {
        if (listeners[ev] && typeof fn === 'function') listeners[ev].push(fn);
      },
      status() { return status; },
      room() { return room; },
      view() { return view; },
      path() { return path ? clone(path) : null; },
      close() {
        if (status === 'closed') return;
        // 스스로 나간다: 닫기 전에 알린다. 대기실이면 서버가 바로 목록에서 뺀다(끊김의 3분 유예와 구분).
        if (status === 'open') sendRaw({ type: 'leave' });
        setStatus('closed');
        status = 'closed';
        path = null;
        try { onClose(); } catch (e) { /* 무시 */ }
      },
    };

    return { api, handle, opened, lost, setStatus, setPath, emit, isClosed: function () { return status === 'closed'; } };
  }

  /* ───────── 참가자: 원격 연결 ───────── */

  /**
   * @param {{broker:BrokerConfig, roomCode:string}} opts
   * @returns {ClientConnection}
   */
  function connect(opts) {
    const Peer = getPeerClass();
    const broker = opts.broker || null;
    const code = normCode(opts.roomCode);
    const hostId = ID_PREFIX + code;

    /** @type {any} */ let peer = null;
    let peerMadeAt = 0;
    let timeoutsOnPeer = 0; // 이 Peer 로 건 연결 시도가 답 없이 끝난 횟수
    let attempts = 0;       // 마지막으로 연결된 뒤 이어진 시도 횟수 (오래 실패하면 간격을 늘린다)
    /** @type {any} */ let dc = null;
    let gen = 0;            // 연결 세대. 옛 연결의 늦은 사건을 걸러 낸다
    let everOpen = false;
    /** @type {any} */ let retryTimer = null;
    /** @type {any} */ let dialTimer = null;
    /** @type {any} */ let pingTimer = null;
    /** @type {any} */ let probeTimer = null;
    /** @type {number|null} */ let awaitingSince = null; // 답을 못 받은 가장 이른 ping 의 시각
    let lastTick = 0;
    /** @type {() => void} */ let unwatch = function () {};
    /** 지금 데이터 연결의 경로 지켜보기 그만두기 @type {() => void} */ let stopPath = function () {};

    // 자리가 넘어가 서버가 이 연결을 닫을 참이다: 닫히면 기다리지 않고 바로 다시 연결해 관전 상태로 돌아온다
    let reconnectNow = false;

    const core = createClientCore(code, sendRaw, shutdown, function () {
      // 서버가 닫힌다고 했다: 지금 연결은 버리고 다시 찾기 시작한다(상태는 core 가 'server_gone' 으로 유지).
      lost();
    }, function () { reconnectNow = true; });

    /** @param {any} msg @returns {boolean} */
    function sendRaw(msg) {
      if (!dc || !dc.open) return false;
      try { dc.send(msg); return true; } catch (e) { return false; }
    }

    function clearConnTimers() {
      if (dialTimer) { clearTimeout(dialTimer); dialTimer = null; }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
      awaitingSince = null;
    }

    function stopWatchingPath() {
      const stop = stopPath;
      stopPath = function () {};
      stop();
    }

    function dropDc() {
      clearConnTimers();
      stopWatchingPath();
      const old = dc;
      dc = null;
      gen += 1; // 아래 close() 가 내는 사건과 이후의 늦은 사건을 모두 무시하게 한다
      if (old) { try { old.close(); } catch (e) { /* 무시 */ } }
      core.setPath(null); // 경로는 열린 연결의 것이다. 다시 이어지면 새로 판정한다
    }

    function dropPeer() {
      const old = peer;
      peer = null;
      if (old) { try { old.destroy(); } catch (e) { /* 무시 */ } }
    }

    /** @param {number} delay */
    function scheduleRetry(delay) {
      if (core.isClosed()) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(function () { retryTimer = null; dial(); }, delay);
    }

    function retryDelay() { return attempts < T.retryFastCount ? T.retryMs : T.retrySlowMs; }

    /** 지금 연결을 버리고 다시 시도하게 한다. @param {ConnStatus} [status] @param {boolean} [rightNow] */
    function lost(status, rightNow) {
      dropDc();
      if (core.isClosed()) return;
      if (reconnectNow) { reconnectNow = false; rightNow = true; }
      core.lost();
      core.setStatus(status || (everOpen ? 'reconnecting' : 'connecting'));
      if (rightNow) { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } dial(); }
      else scheduleRetry(retryDelay());
    }

    function newPeer() {
      dropPeer();
      /** @type {any} */
      let p;
      try {
        // id 를 직접 만들어 넘기면 중개 서버에 id 를 물어보는 왕복이 하나 줄어든다.
        p = new Peer(ID_PREFIX + 'p-' + randomKey(), peerOptions(broker));
      } catch (e) {
        scheduleRetry(retryDelay());
        return;
      }
      peer = p;
      peerMadeAt = now();
      timeoutsOnPeer = 0;
      p.on('open', function () {
        if (peer !== p || core.isClosed()) return;
        dial();
      });
      p.on('error', function (/** @type {any} */ err) {
        if (peer !== p || core.isClosed()) return;
        const type = err && err.type;
        if (type === 'peer-unavailable') {
          // 그 방 코드의 서버가 중개 서비스에 없다. 서버 탭이 새로 고쳐지는 중일 수 있으므로 알리고 계속 시도한다.
          if (!dc || !dc.open) lost('not_found');
          return;
        }
        if (type === 'browser-incompatible') {
          core.emit('error', { code: 'bad_state', detail: 'webrtc_unsupported' });
          core.api.close();
          return;
        }
        // 그 밖(중개 서버와의 연결 문제 등): 쓰고 있는 데이터 연결이 있으면 그대로 두고, 없으면 조금 뒤 다시 시도한다.
        if (!dc || !dc.open) scheduleRetry(retryDelay());
      });
      p.on('disconnected', function () {
        if (peer !== p || core.isClosed()) return;
        if (!dc || !dc.open) scheduleRetry(retryDelay());
      });
      // 중개 서버 응답이 아예 없을 때를 위한 감시
      scheduleRetry(T.dialTimeoutMs);
    }

    function startPing() {
      if (pingTimer) clearInterval(pingTimer);
      awaitingSince = null;
      lastTick = now();
      pingTimer = setInterval(function () {
        const t = now();
        const gap = t - lastTick;
        lastTick = t;
        if (!dc || !dc.open) return;
        // 이 탭의 타이머가 한동안 멈춰 있었다면(안 보이는 탭·잠든 기기) 그 사이의 침묵은 서버 탓이 아니다. 새로 센다.
        if (gap > T.timerGapMs) awaitingSince = null;
        if (awaitingSince !== null && t - awaitingSince >= T.clientSilenceMs) { lost(); return; }
        if (awaitingSince === null) awaitingSince = t;
        sendRaw({ type: PING, t });
      }, T.pingMs);
    }

    function dial() {
      if (core.isClosed() || dc) return;
      if (!peer || peer.destroyed || peer.disconnected || (!peer.open && now() - peerMadeAt >= T.dialTimeoutMs)) {
        newPeer();
        return;
      }
      if (!peer.open) {
        // 중개 서버에 붙는 중. 'open' 사건이 dial 을 다시 부른다. 응답이 아예 없을 때를 위한 감시는 남겨 둔다.
        if (!retryTimer) scheduleRetry(T.dialTimeoutMs);
        return;
      }
      const myGen = ++gen;
      /** @type {any} */
      let c = null;
      try {
        c = peer.connect(hostId, { reliable: true, serialization: 'json' });
      } catch (e) {
        c = null;
      }
      if (!c) { scheduleRetry(retryDelay()); return; }
      dc = c;
      attempts += 1;
      dialTimer = setTimeout(function () {
        dialTimer = null;
        if (gen !== myGen || dc !== c || c.open) return;
        // 답이 전혀 없다. 중개 서버와의 연결이 소리 없이 죽었을 수 있으므로(모바일에서 망이 바뀐 경우 등)
        // 두 번 연달아 이러면 Peer 부터 새로 만든다.
        timeoutsOnPeer += 1;
        if (timeoutsOnPeer >= 2) dropPeer();
        lost();
      }, T.dialTimeoutMs);
      c.on('open', function () {
        if (gen !== myGen || core.isClosed()) return;
        if (dialTimer) { clearTimeout(dialTimer); dialTimer = null; }
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        everOpen = true;
        timeoutsOnPeer = 0;
        attempts = 0;
        startPing();
        core.opened();
        // 이 연결이 직접인지 중계인지 (판정은 비동기, 'status:open' 뒤에 'path' 가 온다)
        stopWatchingPath();
        stopPath = watchPath(c, function (p) {
          if (gen !== myGen || core.isClosed()) return;
          if (core.setPath(p)) logPath(p);
        });
      });
      c.on('data', function (/** @type {any} */ data) {
        if (gen !== myGen || core.isClosed()) return;
        // 어떤 메시지든 서버가 살아 있다는 증거다.
        awaitingSince = null;
        if (probeTimer) { clearTimeout(probeTimer); probeTimer = null; }
        if (isObj(data)) {
          if (data.type === PONG) return;
          if (data.type === PING) { sendRaw({ type: PONG, t: data.t }); return; }
        }
        core.handle(data);
      });
      c.on('close', function () {
        if (gen !== myGen || core.isClosed()) return;
        lost();
      });
      c.on('error', function (/** @type {any} */ err) {
        if (gen !== myGen || core.isClosed() || isHarmlessConnError(err)) return;
        lost();
      });
    }

    /** 화면이 다시 보이거나 네트워크가 돌아왔다: 기다리지 않고 바로 확인한다 (모바일에서 앱을 오갈 때 빨리 돌아오게) */
    function wake() {
      if (core.isClosed()) return;
      attempts = 0; // 사람이 돌아왔다: 다시 촘촘히 시도한다
      if (!dc) {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        dial();
        return;
      }
      if (!dc.open) return; // 연결 시도 중
      let channelState = 'open';
      let iceState = '';
      try {
        if (dc.dataChannel) channelState = dc.dataChannel.readyState;
        if (dc.peerConnection) iceState = dc.peerConnection.iceConnectionState;
      } catch (e) { /* 무시 */ }
      if (channelState !== 'open' || iceState === 'failed' || iceState === 'closed') { lost(undefined, true); return; }
      const myGen = gen;
      sendRaw({ type: PING, t: now() });
      if (!probeTimer) {
        probeTimer = setTimeout(function () {
          probeTimer = null;
          if (gen === myGen && dc && !core.isClosed()) lost(undefined, true);
        }, T.probeMs);
      }
    }

    /** 페이지를 떠난다: 서버가 끊김을 바로 알도록 연결을 스스로 닫는다. (되돌아오면 wake 가 다시 잇는다) */
    function leave() {
      if (core.isClosed()) return;
      dropDc();
      dropPeer();
      core.lost();
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      core.setStatus(everOpen ? 'reconnecting' : 'connecting');
    }

    function shutdown() {
      unwatch();
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      clearConnTimers();
      stopWatchingPath();
      const c = dc;
      const p = peer;
      dc = null;
      peer = null;
      gen += 1;
      // 방금 보낸 leave 가 확실히 도착하도록 바로 끊지 않는다. '닫기' 표시를 이어 보내 서버가 받은 뒤 닫게 하고, 조금 뒤 정리한다.
      if (c) { try { c.close({ flush: true }); } catch (e) { /* 무시 */ } }
      setTimeout(function () {
        if (c) { try { c.close(); } catch (e) { /* 무시 */ } }
        if (p) { try { p.destroy(); } catch (e) { /* 무시 */ } }
      }, T.closeGraceMs);
    }

    unwatch = watchPage(wake, leave);
    dial();
    return core.api;
  }

  /* ───────── 서버 ───────── */

  /**
   * @param {{broker:BrokerConfig, hostPlays:boolean, roomCode?:string, freshCode?:boolean, seed?:number}} opts
   * @returns {HostHandle}
   */
  function openHost(opts) {
    const Peer = getPeerClass();
    const broker = opts.broker || null;

    // 방 코드: 인자 → 이 탭이 쓰던 코드(sessionStorage) → 이 기기가 마지막에 쓴 코드(localStorage) → 새로 만들기.
    // 쓴 코드는 둘 다에 기억해, 서버 탭을 다시 열어도 같은 코드·링크가 유지되게 한다. 탭별 기억을 먼저 보는 것은,
    // 같은 기기에서 서버 탭 둘이 서로 다른 코드를 쓰게 된 뒤(freshCode) 각 탭을 새로 고쳐도 서로의 코드와 부딪치지 않게 하려는 것.
    // freshCode 면 기억한 코드를 버리고 새 코드로 연다(같은 코드가 다른 탭·기기에서 이미 열려 있을 때).
    const codeOk = /^[A-Z0-9]{4,10}$/;
    let code = normCode(opts.roomCode);
    if (!codeOk.test(code) && !opts.freshCode) code = normCode(storeGet('sessionStorage', HOST_CODE_KEY));
    if (!codeOk.test(code) && !opts.freshCode) code = normCode(storeGet('localStorage', HOST_CODE_KEY));
    if (!codeOk.test(code)) code = newRoomCode();
    storeSet('sessionStorage', HOST_CODE_KEY, code);
    storeSet('localStorage', HOST_CODE_KEY, code);
    const hostId = ID_PREFIX + code;

    /** 'path' → Record<이름, ConnPath> (사람별 연결 경로가 바뀔 때마다 전체) @type {Record<string, Array<(data:any) => void>>} */
    const listeners = { change: [], status: [], events: [], path: [] };
    /** @type {ConnStatus} */
    let status = 'connecting';
    let closed = false;
    let lastPathsKey = ''; // 마지막으로 'path' 로 내보낸 사람별 경로 (같으면 다시 내지 않음)
    /** @type {any} */ let peer = null;
    let attemptAt = 0;
    let everOpen = false;
    let openedSinceRecover = false;
    let lastImmediate = 0;
    let hostAttempts = 0; // 마지막으로 등록된 뒤 이어진 재시도 횟수
    /** 같은 id 가 이미 쓰이고 있다는 답(unavailable-id)이 처음 온 시각. 등록되거나 다른 문제가 끼면 지운다. @type {number|null} */
    let idTakenSince = null;
    let closingSent = false; // 참가자들에게 closing 을 보냈다. 이후 방 정보 등은 보내지 않는다
    /** @type {any} */ let recoverTimer = null;
    /** @type {any} */ let sweepTimer = null;
    let lastSweep = now();
    let seq = 0;
    /** 연결 id → 원격 연결. name: room 이 이 연결에 알린 자리 이름(방 정보의 you), path: 이 연결의 경로(판정 전이면 null)
     * @typedef {{dc:any, lastSeen:number, opened:boolean, dead:boolean, kicked:boolean, openTimer:any,
     *   name:string|null, path:ConnPath|null, stopPath:(() => void)|null, logged:string}} HostConn */
    /** @type {Map<string, HostConn>} */
    const conns = new Map();
    /** 기기 안 연결 (hostPlays 일 때) @type {{core: ReturnType<typeof createClientCore>, alive:boolean}|null} */
    let local = null;
    /** @type {() => void} */ let unwatch = function () {};

    /** @param {string} ev @param {any} data */
    function emit(ev, data) {
      const list = listeners[ev];
      if (!list) return;
      for (const fn of list.slice()) {
        try { fn(data); } catch (e) { if (G.console) G.console.error(e); }
      }
    }

    /** @param {ConnStatus} s */
    function setStatus(s) {
      if (status === 'closed' || status === s) return;
      status = s;
      emit('status', s);
    }

    /* 기기 안 연결용 전달 줄. 원격 연결처럼 '보낸 뒤 나중에' 도착하게 하되, 안 보이는 탭에서 느려지는 타이머 대신
     * 마이크로태스크를 쓴다. 양방향이 한 줄을 써서 순서가 보존된다. */
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
            try { job(); } catch (e) { if (G.console) G.console.error(e); }
          }
        } finally {
          draining = false;
        }
      });
    }

    /** @param {string} connId @param {boolean} closeIt */
    function drop(connId, closeIt) {
      const e = conns.get(connId);
      if (!e || e.dead) return;
      e.dead = true;
      conns.delete(connId);
      if (e.openTimer) { clearTimeout(e.openTimer); e.openTimer = null; }
      if (e.stopPath) { e.stopPath(); e.stopPath = null; }
      if (closeIt) { try { e.dc.close(); } catch (err) { /* 무시 */ } }
      if (e.opened && !e.kicked) room.disconnect(connId);
      pathsChanged();
    }

    /* ── 사람별 연결 경로 (통신 정보: 방 정보·판 상태에는 넣지 않고 paths()/'path' 로만 내보낸다) ── */

    /** 접속 중이고 판정이 끝난 원격 참가자 이름 → 경로. 같은 이름의 연결이 둘이면(넘겨받는 중) 나중 연결.
     * @returns {Record<string, ConnPath>} */
    function currentPaths() {
      /** @type {Record<string, ConnPath>} */
      const out = {};
      for (const e of conns.values()) {
        if (e.dead || e.kicked || !e.name || !e.path) continue;
        out[e.name] = clone(e.path);
      }
      return out;
    }

    /** 사람별 경로가 달라졌으면 'path' 로 전체를 내보낸다 */
    function pathsChanged() {
      const now = currentPaths();
      const key = Object.keys(now).sort().map(function (n) { return n + '=' + pathKey(now[n]); }).join(';');
      if (key === lastPathsKey) return;
      lastPathsKey = key;
      emit('path', now);
    }

    /** 연결의 이름이나 경로가 바뀌었다: 콘솔에 한 줄(이름과 경로가 모두 있을 때, 달라졌을 때만) + 'path' @param {HostConn} e */
    function connPathNoted(e) {
      if (e.name && e.path) {
        const k = e.name + '|' + pathKey(e.path);
        if (k !== e.logged) { e.logged = k; logPath(e.path, e.name); }
      }
      pathsChanged();
    }

    /** room 이 연결마다 보내는 방 정보의 you 로 그 연결이 차지한 이름을 안다 @param {string} connId @param {any} info */
    function noteName(connId, info) {
      const e = conns.get(connId);
      if (!e || e.dead || !isObj(info)) return;
      const you = typeof info.you === 'string' ? info.you : null;
      if (you === e.name) return;
      e.name = you;
      connPathNoted(e);
    }

    const room = Zap.room.createRoom({
      roomCode: code,
      seed: opts.seed,
      lobbyGraceMs: T.lobbyGraceMs,
      send(connId, msg) {
        if (msg.type === 'room') noteName(connId, msg.room);
        // 서버가 닫힌다고 알린 뒤에는 아무것도 보내지 않는다. 닫히면서 연결 순서대로 끊김이 처리될 때
        // '앞사람 끊김' 방 정보가 남은 참가자에게 가지 않게.
        if (closingSent && connId !== 'local') return;
        if (connId === SCREEN_CONN) {
          // 서버 화면: 참가자에게 가는 것과 같은 사건만 전한다(방·판 상태는 'change' 의 snapshot 으로 이미 간다).
          if (msg.type === 'events') emit('events', clone(msg.events));
          return;
        }
        if (connId === 'local') {
          const l = local;
          if (!l || !l.alive) return;
          const copy = clone(msg); // 참조를 공유하지 않게 복사
          post(function () { if (l.alive) l.core.handle(copy); });
          return;
        }
        const e = conns.get(connId);
        if (!e || e.dead || !e.dc.open) return;
        try { e.dc.send(msg); } catch (err) { /* 보내기 실패는 침묵 검사가 정리한다 */ }
      },
      kick(connId) {
        if (connId === SCREEN_CONN) return;
        if (connId === 'local') {
          // 기기 안 연결은 닫을 통로가 없다. 자리 없는 새 연결로 다시 잇는다.
          const l = local;
          if (!l || !l.alive) return;
          post(function () {
            if (!l.alive) return;
            room.connect('local');
            l.core.opened();
          });
          return;
        }
        const e = conns.get(connId);
        if (!e || e.dead) return;
        // room 은 이 연결을 이미 잊었다. 이후 이 연결에서 오는 것은 넘기지 않고, 안내 메시지가 나갈 틈을 준 뒤 닫는다.
        e.kicked = true;
        pathsChanged();
        try { e.dc.close({ flush: true }); } catch (err) { /* 무시 */ }
        setTimeout(function () { drop(connId, true); }, T.kickGraceMs);
      },
      onChange(snap) { emit('change', snap); },
    });

    /** 들어온 데이터 연결 하나 @param {any} dc */
    function accept(dc) {
      seq += 1;
      const connId = 'c' + seq + '-' + randomString(6, 'abcdefghijklmnopqrstuvwxyz0123456789');
      /** @type {HostConn} */
      const e = { dc, lastSeen: now(), opened: false, dead: false, kicked: false, openTimer: null, name: null, path: null, stopPath: null, logged: '' };
      conns.set(connId, e);
      const onOpen = function () {
        if (e.dead || e.opened) return;
        e.opened = true;
        e.lastSeen = now();
        if (e.openTimer) { clearTimeout(e.openTimer); e.openTimer = null; }
        room.connect(connId);
        if (e.dead) return;
        // 이 참가자와의 연결이 직접인지 중계인지 (이름은 join·claim 뒤 방 정보의 you 로 붙는다)
        e.stopPath = watchPath(dc, function (p) {
          if (e.dead) return;
          e.path = p;
          connPathNoted(e);
        });
      };
      dc.on('open', onOpen);
      dc.on('data', function (/** @type {any} */ data) {
        if (e.dead) return;
        e.lastSeen = now();
        if (e.kicked) return;
        if (!e.opened) onOpen();
        if (isObj(data)) {
          if (data.type === PING) { try { dc.send({ type: PONG, t: data.t }); } catch (err) { /* 무시 */ } return; }
          if (data.type === PONG) return;
        }
        room.receive(connId, data);
      });
      dc.on('close', function () { drop(connId, false); });
      dc.on('error', function (/** @type {any} */ err) {
        if (isHarmlessConnError(err)) return;
        drop(connId, true);
      });
      e.openTimer = setTimeout(function () {
        e.openTimer = null;
        if (!e.opened) drop(connId, true);
      }, T.openWaitMs);
      if (dc.open) onOpen();
    }

    function sweep() {
      const t = now();
      const gap = t - lastSweep;
      lastSweep = t;
      if (gap > T.timerGapMs) {
        // 서버 탭이 잠들어 있었다(모바일 서버가 다른 앱에 가려졌던 경우 등). 밀린 메시지가 곧 도착할 수 있으므로
        // 이번에는 판단하지 않고 모든 연결에 새로 시간을 준다.
        for (const e of conns.values()) e.lastSeen = t;
        return;
      }
      for (const [connId, e] of Array.from(conns.entries())) {
        if (!e.opened || e.kicked) continue;
        const silent = t - e.lastSeen;
        if (silent > T.hostSilenceMs) drop(connId, true);
        else if (silent > T.hostNudgeMs) {
          try { e.dc.send({ type: PING, t }); } catch (err) { /* 무시 */ }
        }
      }
    }

    /* ── 중개 서버와의 연결 ── */

    /** @param {number} delay */
    function scheduleRecover(delay) {
      if (closed) return;
      if (recoverTimer) clearTimeout(recoverTimer);
      recoverTimer = setTimeout(function () { recoverTimer = null; recover(); }, delay);
    }

    function startPeer() {
      if (closed) return;
      /** @type {any} */
      let p;
      attemptAt = now();
      try {
        p = new Peer(hostId, peerOptions(broker));
      } catch (e) {
        scheduleRecover(T.retryMs);
        return;
      }
      peer = p;
      p.on('open', function () {
        if (peer !== p || closed) return;
        everOpen = true;
        openedSinceRecover = true;
        hostAttempts = 0;
        idTakenSince = null;
        if (recoverTimer) { clearTimeout(recoverTimer); recoverTimer = null; }
        setStatus('open');
      });
      p.on('connection', function (/** @type {any} */ dc) {
        if (peer !== p || closed) { try { dc.close(); } catch (e) { /* 무시 */ } return; }
        accept(dc);
      });
      // PeerJS 는 error → disconnected → (경우에 따라) close 를 한 호출 안에서 잇달아 낸다. 그 호출이 끝나 상태가 확정된 뒤에 본다.
      const later = function () {
        if (peer !== p || closed) return;
        Promise.resolve().then(function () { if (peer === p) trouble(); });
      };
      p.on('error', function (/** @type {any} */ err) {
        if (peer !== p || closed) return;
        const type = err && err.type;
        if (type === 'unavailable-id') { if (idTakenSince === null) idTakenSince = now(); }
        else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') idTakenSince = null;
        later();
      });
      p.on('disconnected', later);
      p.on('close', later);
      scheduleRecover(T.dialTimeoutMs * 2); // 중개 서버 응답이 아예 없을 때를 위한 감시
    }

    /** 중개 서버와의 연결에 문제가 생겼다(또는 생긴 것 같다) */
    function trouble() {
      if (closed) return;
      const p = peer;
      if (p && !p.destroyed && !p.disconnected && p.open) return; // 멀쩡함 (연결 하나의 협상 오류 같은 것)
      // 같은 방 코드가 다른 탭·기기에서 열려 있다는 답이 한동안 이어지면 그 이유를 알린다(다시 시도는 계속한다:
      // 앞의 탭이 닫히면 이 탭이 넘겨받는다).
      const takenLong = idTakenSince !== null && now() - idTakenSince >= T.idTakenMs;
      setStatus(takenLong ? 'id_taken' : everOpen ? 'reconnecting' : 'connecting');
      // 열려 있다가 중개 서버와만 끊긴 경우는 기다리지 않고 바로 다시 붙는다(안 보이는 탭에서는 타이머가 느리므로).
      // 기존 데이터 연결은 그대로 쓴다. 다만 붙자마자 또 끊기는 상황에서 몰아치지 않도록 간격을 둔다.
      if (p && !p.destroyed && p.disconnected && openedSinceRecover && now() - lastImmediate > T.hostRecoverGapMs) {
        lastImmediate = now();
        recover();
        return;
      }
      scheduleRecover(hostRetryDelay());
    }

    function hostRetryDelay() { return hostAttempts < T.retryFastCount ? T.retryMs : T.retrySlowMs; }

    function recover() {
      if (closed) return;
      const p = peer;
      if (p && !p.destroyed && !p.disconnected && p.open) { setStatus('open'); return; }
      openedSinceRecover = false;
      hostAttempts += 1;
      if (!p || p.destroyed) {
        // 같은 id 가 아직 중개 서비스에 남아 있으면('unavailable-id') PeerJS 가 Peer 를 버린다. 새로 만들어 다시 시도한다.
        // close() 가 불릴 때까지 계속한다.
        startPeer();
        return;
      }
      if (p.disconnected) {
        attemptAt = now();
        try {
          p.reconnect(); // 같은 id 로 다시 등록. 기존 데이터 연결은 유지된다
        } catch (e) {
          peer = null;
          try { p.destroy(); } catch (err) { /* 무시 */ }
          startPeer();
          return;
        }
      } else if (now() - attemptAt > T.dialTimeoutMs * 2) {
        // 붙는 중인 채로 너무 오래 걸린다. 한 번도 열린 적 없는 Peer 면 버리고 새로, 아니면 끊고 다시 붙인다.
        if (!everOpen) {
          peer = null;
          try { p.destroy(); } catch (err) { /* 무시 */ }
          startPeer();
          return;
        }
        try { p.disconnect(); } catch (err) { /* 무시 */ }
      }
      scheduleRecover(hostRetryDelay());
    }

    function wake() {
      if (closed) return;
      if (leftPage) {
        // 떠났던 페이지가 되돌아왔다(뒤로 가기 캐시): 다시 받아 준다.
        leftPage = false;
        closingSent = false;
      }
      hostAttempts = 0; // 사람이 돌아왔다: 다시 촘촘히 시도한다
      const p = peer;
      if (!p || p.destroyed || p.disconnected) {
        if (recoverTimer) { clearTimeout(recoverTimer); recoverTimer = null; }
        recover();
      }
    }

    /** 모든 원격 연결에 '서버가 닫힌다'를 보낸다. 이후 room 이 보내려는 것은 막는다. @param {'closed'|'reload'} reason */
    function sendClosing(reason) {
      if (closingSent) return;
      closingSent = true;
      for (const e of conns.values()) {
        if (e.dead || !e.opened || e.kicked) continue;
        try { e.dc.send({ type: 'closing', reason }); } catch (err) { /* 무시 */ }
      }
    }

    /** 모든 원격 연결을 정리한다: '닫기' 표시를 이어 보내 참가자 쪽이 앞의 메시지를 받은 뒤 닫게 한다.
     * room 에는 끊김으로 알리지만, closing 뒤라 방 정보는 나가지 않는다. @returns {any[]} 정리한 데이터 연결들 */
    function closeAllConns() {
      const dcs = [];
      for (const [connId, e] of Array.from(conns.entries())) {
        dcs.push(e.dc);
        try { e.dc.close({ flush: true }); } catch (err) { /* 무시 */ }
        drop(connId, false);
      }
      return dcs;
    }

    /** 떠나기 직전(beforeunload): 막는 사람(나가기 확인 창)이 없으면 미리 closing 을 보낸다. 페이지가 남으면 되돌린다. @param {any} e */
    function beforeLeave(e) {
      if (closed || closingSent || (e && e.defaultPrevented)) return;
      sendClosing('reload');
      // 다른 처리기가 떠나기를 막아 페이지가 남은 경우: 참가자들은 closing 을 받고 다시 연결해 오므로 다시 받아 준다.
      setTimeout(function () { if (!closed && !leftPage) closingSent = false; }, 3000);
    }

    let leftPage = false;
    /** 페이지를 떠난다(새로 고침·탭 닫기): closing 을 보내고 연결을 정리하며, 중개 서비스에서 id 를 바로 내놓는다.
     * 새로 고침인지 닫기인지는 알 수 없어 reason 은 'reload'. */
    function leave() {
      if (closed) return;
      leftPage = true;
      sendClosing('reload');
      if (recoverTimer) { clearTimeout(recoverTimer); recoverTimer = null; }
      closeAllConns();
      // 데이터 연결은 브라우저가 페이지를 내리며 정리한다(여기서 Peer 를 없애면 방금 보낸 closing 이 버려질 수 있다).
      // 중개 서버와의 연결만 끊어 같은 id 를 다시 쓸 수 있게 한다.
      const p = peer;
      if (p) { try { p.disconnect(); } catch (e) { /* 무시 */ } }
      setStatus(everOpen ? 'reconnecting' : 'connecting');
      // 되돌아오면(뒤로 가기 캐시) pageshow → wake 가 다시 등록하고, 참가자들은 다시 연결해 온다.
    }

    /* ── 기기 안 연결 ── */

    room.connect(SCREEN_CONN);

    /** @type {ClientConnection|null} */
    let localClient = null;
    if (opts.hostPlays) {
      /** @type {{core: ReturnType<typeof createClientCore>, alive:boolean}} */
      const l = {
        alive: true,
        core: createClientCore(
          code,
          function (msg) {
            if (!l.alive) return false;
            const copy = clone(msg);
            // 닫힌 뒤에도 그 전에 보낸 것(leave 등)은 순서대로 도착해야 하므로, 전달할 때 alive 를 다시 보지 않는다.
            post(function () { room.receive('local', copy); });
            return true;
          },
          function () {
            if (!l.alive) return;
            l.alive = false;
            post(function () { room.disconnect('local'); });
          }
        ),
      };
      local = l;
      localClient = l.core.api;
      room.connect('local');
      // 기기 안 연결은 곧바로 열린 상태다. 화면이 openHost 직후에 join 을 불러도 hello 뒤에 차례대로 전달된다.
      l.core.opened();
    }

    sweepTimer = setInterval(sweep, T.sweepMs);
    unwatch = watchPage(wake, leave, beforeLeave);
    startPeer();

    return {
      roomCode: code,
      joinUrl: makeJoinUrl(code, broker),
      command(cmd) { return room.serverCommand(cmd); },
      snapshot() { return room.snapshot(); },
      localClient,
      on(ev, fn) {
        if (listeners[ev] && typeof fn === 'function') listeners[ev].push(fn);
      },
      status() { return status; },
      paths() { return currentPaths(); },
      close() {
        if (closed) return;
        // 서버 닫기: 참가자들에게 먼저 알리고(closing), 그 뒤의 방 정보 변화는 보내지 않는다.
        sendClosing('closed');
        closed = true;
        unwatch();
        if (recoverTimer) { clearTimeout(recoverTimer); recoverTimer = null; }
        if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
        if (localClient) localClient.close();
        const dcs = closeAllConns();
        const p = peer;
        peer = null;
        if (p) {
          // 중개 서버에서는 바로 빠져 같은 코드로 곧바로 다시 열 수 있게 하고, 데이터 연결은 closing 이 나갈 틈을 준 뒤 정리한다.
          try { p.disconnect(); } catch (e) { /* 무시 */ }
        }
        setTimeout(function () {
          for (const d of dcs) { try { d.close(); } catch (e) { /* 무시 */ } }
          if (p) { try { p.destroy(); } catch (e) { /* 무시 */ } }
        }, T.closeGraceMs);
        status = 'closed';
        emit('status', 'closed');
      },
    };
  }

  Zap.net = { parseBroker, openHost, connect, newRoomCode, peerIdFor, classifyStats };
  /** 시험 전용: 시간 기준값을 줄여 쓰기 위한 통로. 화면 코드는 쓰지 않는다. */
  /** @type {any} */ (Zap.net)._timing = T;
  /** 시험 전용: 개발용 TURN 설정이 실제 서비스에서 켜지지 않는지 확인하는 통로 */
  /** @type {any} */ (Zap.net)._devTurn = devTurnConfig;
  /** @type {any} */ (Zap.net)._peerOptions = peerOptions;
})();
