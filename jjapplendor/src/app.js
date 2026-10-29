// @ts-check
/*
 * 짭플렌더 화면 — 흐름 (시작 화면 → 서버 열기 / 참가 / 한 화면 → 대기실 → 판 → 결과 → 새 판)
 *
 * 화면 상태 S 하나를 두고, 무엇이든 바뀌면 render() 가 판 밖 화면을 새로 계산해 달라진 곳만 고쳐 그린다(Zap.ui.dom.patch).
 * 판(과 결과)은 버전 2 판 화면 Zap.v2.board 가 그린다. 판 자리(data-own="board")는 patch 가 건드리지 않고,
 * render() 끝에서 Zap.v2.board.render(자리, 화면 정보, 선택) 를 부른다.
 * 판을 바꾸는 일은 하지 않는다: 수는 client.move, 운영 명령은 host.command(서버)·local.command(한 화면) 또는 client.admin(방장)으로만 보낸다.
 * 통합 시험용으로 window.__zap = { mode, host, client, local? } 를 내놓는다.
 */
(function () {
  /** @type {(spec:string, attrs?:any, ...kids:any[]) => HTMLElement} */
  const h = Zap.ui.dom.h;
  const panels = Zap.ui.panels;
  const text = Zap.ui.text;
  const V2 = /** @type {any} */ (Zap).v2;
  const SKINS = /** @type {Record<string, any>} */ (/** @type {any} */ (Zap).skins || {});
  const NAME_KEY = 'zap.lastName';
  const SKIN_KEY = 'zap.skin';
  const MUSIC_KEY = 'zap.music';
  const HOSTPLAYS_KEY = 'zap.hostPlays';
  const MAX_EVENTS = 60;
  const SKIN_ORDER = ['engraving', 'intarsia'];

  /** @param {string} key @returns {string|null} */
  function load(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  /** @param {string} key @param {string} value */
  function store(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 저장소를 못 쓰는 환경이면 기억하지 않는다 */ }
  }
  /** @returns {string} */
  function loadLastName() { return (load(NAME_KEY) || '').slice(0, 12); }
  /** @param {string} name */
  function saveLastName(name) { store(NAME_KEY, name); }

  /** 쓸 수 있는 스킨(그림 함수가 다 있는 것)의 id 목록 @returns {string[]} */
  function skinIds() {
    const ids = SKIN_ORDER.filter((id) => SKINS[id] && typeof SKINS[id].card === 'function');
    for (const id of Object.keys(SKINS)) if (ids.indexOf(id) < 0 && id[0] !== '_' && SKINS[id] && typeof SKINS[id].card === 'function' && id !== 'wire') ids.push(id);
    return ids;
  }
  /** @returns {{on:boolean, volume:number}} */
  function loadMusic() {
    try {
      const m = JSON.parse(load(MUSIC_KEY) || 'null');
      if (m && typeof m.on === 'boolean' && typeof m.volume === 'number') return { on: m.on, volume: Math.max(0, Math.min(1, m.volume)) };
    } catch (e) { /* 기본값 */ }
    return { on: false, volume: 0.5 };
  }

  const params = new URLSearchParams(window.location.search);
  /** 한 화면 모드만 되는 곳(claude.ai Artifact 등)인지: 빌드가 앞쪽 스크립트로 Zap.ui.LOCAL_ONLY = true 를 넣는다 */
  const LOCAL_ONLY = Zap.ui.LOCAL_ONLY === true;
  const localApi = /** @type {any} */ (Zap).local;

  const S = {
    /** @type {'home'|'hostSetup'|'joinSetup'|'localSetup'|'session'} */
    screen: 'home',
    /** @type {'host'|'client'|'local'|null} */
    mode: null,
    /** 한 화면에서 두기: Zap.local.open 이 준 손잡이 (LocalHandle) @type {any} */
    local: null,
    /** 한 화면: 지금 화면에 보이는 자리 */
    localSeat: 0,
    localN: 2,
    localNames: ['플레이어 1', '플레이어 2', '플레이어 3', '플레이어 4'],
    /** 'random' 또는 'seat:<번호>' */
    localFirst: 'random',
    localCurtain: false,
    /** 한 화면: 차례가 바뀌어 가림막이 내려와 있는지 */
    curtain: false,
    /** @type {HostHandle|null} */
    host: null,
    /** @type {ClientConnection|null} */
    client: null,
    hostPlays: load(HOSTPLAYS_KEY) !== '0',
    name: loadLastName(),
    code: LOCAL_ONLY ? '' : (params.get('room') || '').toUpperCase().trim(),
    formError: '',
    /** @type {ConnStatus} */
    connStatus: 'connecting',
    /** @type {ConnStatus} */
    hostStatus: 'connecting',
    /** @type {RoomInfo|null} */
    room: null,
    /** @type {PlayerView|null} */
    view: null,
    /** 아직 판 화면에 넘기지 않은 사건(다음 화면 정보와 함께 움직임으로 보여 준다) @type {GameEvent[]} */
    events: [],
    /** 다음에 판을 그릴 때 움직임 없이 새로 시작할지(새 판, 한 화면의 자리 바뀜) */
    boardReset: false,
    /** @type {'host'|'leave'|'link'|'settings'|'newgame'|null} */
    overlay: null,
    first: 'random',
    copied: false,
    /** 서버가 플레이어를 겸할 때: 내 참가 요청의 답을 기다리는 중 */
    joining: false,
    /** 판이 진행 중인 방에 자리 없이 들어온 사람이 자리 고르기를 접고 구경하는 중 */
    watching: false,
    /** 이 화면의 자리가 다른 탭·기기로 넘어갔을 때 그 자리 이름(설명 한 줄용) */
    takenOver: '',
    /** 서버가 닫힐 때 알린 이유('closed'|'reload', 알 수 없으면 '') */
    closingReason: '',
    /** 한 화면: 다음에 판을 그릴 때 차례 시작(빛남·알림 소리)을 알릴지 */
    announce: false,
    skin: (() => { const saved = load(SKIN_KEY); const ids = skinIds(); return saved && ids.indexOf(saved) >= 0 ? saved : (ids[0] || ''); })(),
    music: loadMusic(),
    /** @type {string} */
    toast: '',
  };
  /** @type {any} */
  let toastTimer = null;
  /** @type {any} */
  let pendingTimer = null;
  /** 이 화면이 마지막으로 앉아 있던 자리 이름(자리가 다른 탭으로 넘어갔을 때 설명용) */
  let lastSeat = '';
  /** 세션을 구분하는 번호: 나간 뒤 늦게 도착한 옛 연결의 소식을 버리기 위한 것 */
  let sessionNo = 0;

  /** @type {any} */ (window).__zap = { mode: null, host: null, client: null };

  /** @returns {BrokerConfig} */
  function broker() {
    try { return Zap.net.parseBroker(window.location.search); } catch (e) { return null; }
  }

  /** @returns {any} 지금 고른 스킨 */
  function skin() {
    return SKINS[S.skin] || SKINS[skinIds()[0]];
  }

  /* ───────────── 알림 ───────────── */

  /** 판 밖 화면의 알림 @param {string} msg */
  function toast(msg) {
    S.toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { S.toast = ''; toastTimer = null; render(); }, 4200);
    render();
  }

  /** 판이 보이면 판 가장자리에, 아니면 판 밖 알림으로. 판의 '답 기다리는 중' 잠금도 푼다 @param {string} msg */
  function notify(msg) {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    const host = boardHost();
    if (host && S.view && V2 && V2.board) {
      if (typeof V2.board.notify === 'function') { V2.board.notify(host, msg); return; }
      // 셸에 notify 가 없을 때: 같은 화면 정보로 다시 그려 잠금을 풀고, 알림은 판 밖에 띄운다
      lastBoard.sig = '';
      lastBoard.view = null;
      paintBoard(true);
    }
    toast(msg);
  }

  /* ───────────── 세션 ───────────── */

  /** @param {string} name @returns {string} 문제가 있으면 안내 문구 */
  function nameProblem(name) {
    const n = name.trim();
    const len = Array.from(n).length;
    if (len < 1 || len > 12 || n.toLowerCase() === 'random') return text.errorText('bad_name');
    return '';
  }

  function resetSession() {
    sessionNo++;
    S.mode = null; S.host = null; S.client = null; S.local = null; S.localSeat = 0; S.curtain = false;
    S.room = null; S.view = null; S.events = []; S.boardReset = false; S.watching = false; S.takenOver = ''; S.closingReason = ''; S.announce = false; lastSeat = '';
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    S.overlay = null; S.first = 'random'; S.copied = false; S.joining = false;
    S.connStatus = 'connecting'; S.hostStatus = 'connecting'; S.formError = '';
    /** @type {any} */ (window).__zap = { mode: null, host: null, client: null };
  }

  /** @param {GameEvent[]} evs */
  function addEvents(evs) {
    for (const ev of evs) S.events.push(ev);
    if (S.events.length > MAX_EVENTS) S.events = S.events.slice(-MAX_EVENTS);
  }

  /** @param {ClientConnection} client */
  function attachClient(client) {
    const my = sessionNo;
    const alive = () => my === sessionNo && S.client === client;
    client.on('status', () => {
      if (!alive()) return;
      S.connStatus = client.status();
      if (S.connStatus !== 'open' && pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (S.connStatus !== 'server_gone') S.closingReason = '';
      render();
    });
    // 서버가 닫힌다고 알려 올 때의 이유('closed' 서버 닫기 → '닫혔습니다' | 'reload' 새로 고침·탭 닫기 → '다시 열리는 중').
    // 그 뒤 상태는 다시 연결될 때까지 'server_gone'.
    client.on('closing', (data) => {
      if (!alive()) return;
      S.closingReason = data && data.reason === 'reload' ? 'reload' : 'closed';
      render();
    });
    client.on('room', (data) => {
      if (!alive()) return;
      // 서버가 닫힌다고 알린 뒤의 방 정보 변화(다른 사람들이 끊김으로 바뀌는 것)는 보이지 않는다
      if (client.status() === 'server_gone') return;
      onRoom(/** @type {RoomInfo} */ (client.room() || data));
      render();
    });
    client.on('state', (data) => {
      if (!alive()) return;
      onView(/** @type {PlayerView} */ (client.view() || data));
      render();
    });
    // 연결 경로(직접/중계)가 정해지거나 바뀌면 위 막대의 표시를 고친다(한 화면 모드의 연결에는 경로가 없다)
    if (typeof client.path === 'function') client.on('path', () => { if (alive()) render(); });
    client.on('events', (data) => {
      if (!alive()) return;
      addEvents(Array.isArray(data) ? data : (data && Array.isArray(data.events) ? data.events : []));
    });
    client.on('error', (data) => {
      if (!alive()) return;
      const code = typeof data === 'string' ? data : (data && data.code) || 'bad_message';
      const detail = data && data.detail;
      S.joining = false;
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      const msg = text.errorText(code, detail);
      if (detail === 'taken_over') {
        // 같은 자리가 다른 탭·기기로 넘어감: 자리 고르기 덮개에 이유를 남긴다
        S.takenOver = (S.room && S.room.you) || lastSeat || '같은';
        S.watching = false;
        // 판 중이면 곧바로 자리 없는 화면(관전 + 자리 고르기 덮개, 그 안에 같은 설명)으로 바꾼다.
        // 연결 쪽이 다시 붙어 새 방 정보를 주기 전까지 옛 자리로 보이지 않게. 알림은 대기실에서만(두 번 뜨지 않게).
        if (S.room && S.room.status !== 'lobby') { S.room = Object.assign({}, S.room, { you: null }); render(); }
        else toast(msg);
        return;
      }
      // 이름을 정하는 화면에서는 입력란 아래에만 보여 준다
      if (!S.room || S.room.you === null) { S.formError = msg; render(); }
      else notify(msg);
    });
    S.connStatus = client.status();
    const room = client.room();
    if (room) onRoom(room);
    const view = client.view();
    if (view) onView(view);
  }

  /** @param {RoomInfo} room */
  function onRoom(room) {
    S.room = room;
    if (room.you !== null) { S.formError = ''; S.joining = false; S.watching = false; S.takenOver = ''; lastSeat = room.you; }
    if (S.first !== 'random' && !room.participants.some((p) => 'name:' + p.name === S.first)) S.first = 'random';
    if (room.status === 'lobby') { S.view = null; S.events = []; if (S.overlay === 'newgame') S.overlay = null; }
  }

  /** @param {PlayerView} view */
  function onView(view) {
    const prev = S.view;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    const restarted = !!prev && (view.turnsTaken < prev.turnsTaken || (prev.phase === 'over' && view.phase !== 'over'));
    if (restarted) {
      // 새 판: 지난 판의 사건은 버리고 판 화면을 새로 시작한다
      const cut = S.events.map((e) => e.type).lastIndexOf('gameOver');
      S.events = cut >= 0 ? S.events.slice(cut + 1) : [];
      S.boardReset = true;
      if (S.overlay === 'newgame') S.overlay = null;
    }
    S.view = view;
    if (view.phase === 'over' && (!prev || prev.phase !== 'over')) S.first = 'random';
  }

  /** @param {boolean} [fresh] 기억한 방 코드를 버리고 새 코드로 연다(같은 코드가 다른 탭에서 열려 있을 때) */
  function openHostSession(fresh) {
    S.formError = '';
    store(HOSTPLAYS_KEY, S.hostPlays ? '1' : '0');
    if (S.hostPlays) {
      const bad = nameProblem(S.name);
      if (bad) { S.formError = bad; render(); return; }
    }
    resetSession();
    const my = sessionNo;
    /** @type {HostHandle} */
    let host;
    try {
      host = Zap.net.openHost(fresh ? { broker: broker(), hostPlays: S.hostPlays, freshCode: true } : { broker: broker(), hostPlays: S.hostPlays });
    } catch (e) {
      S.formError = '서버를 열지 못했습니다: ' + (e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : e);
      render();
      return;
    }
    S.mode = 'host'; S.host = host; S.client = host.localClient || null; S.screen = 'session';
    /** @type {any} */ (window).__zap = { mode: 'host', host, client: S.client };
    S.hostStatus = host.status();
    host.on('status', () => { if (my !== sessionNo) return; S.hostStatus = host.status(); render(); });
    // 참가자마다 연결 경로(직접/중계)가 정해지거나 바뀔 때 서버 패널의 표지를 고친다
    host.on('path', () => { if (my !== sessionNo) return; render(); });
    host.on('events', (evs) => {
      // 서버만 맡는 화면의 움직임용 (플레이를 겸하면 기기 안 연결이 같은 사건을 받는다)
      if (my !== sessionNo || S.client || !Array.isArray(evs)) return;
      addEvents(evs);
    });
    host.on('change', (snap) => {
      if (my !== sessionNo) return;
      if (!S.client) applySnapshot(/** @type {RoomSnapshot} */ (snap || host.snapshot()));
      render();
    });
    if (S.client) {
      const name = S.name.trim();
      saveLastName(name);
      attachClient(S.client);
      // 기기 안 연결은 곧바로 열려 있다. 바로 참가를 보내면 net.js 가 이 탭의 옛 기록으로 자동 참가하는 것보다 앞선다.
      S.joining = true;
      S.client.join(name);
    } else {
      applySnapshot(host.snapshot());
    }
    render();
  }

  /** 서버만 맡을 때: 스냅숏으로 방과 판(관전 시점)을 갱신 @param {RoomSnapshot} snap */
  function applySnapshot(snap) {
    if (!snap) return;
    if (snap.room) onRoom(snap.room);
    if (snap.view) { if (snap.view !== S.view) onView(snap.view); }
    else if (S.view && snap.room && snap.room.status === 'lobby') S.view = null;
  }

  function openClientSession() {
    const code = S.code.toUpperCase().trim();
    if (!code) { S.formError = '방 코드를 입력해 주세요.'; render(); return; }
    resetSession();
    S.code = code;
    /** @type {ClientConnection} */
    let client;
    try {
      client = Zap.net.connect({ broker: broker(), roomCode: code });
    } catch (e) {
      S.formError = '연결을 시작하지 못했습니다: ' + (e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : e);
      S.screen = 'joinSetup';
      render();
      return;
    }
    S.mode = 'client'; S.client = client; S.screen = 'session';
    /** @type {any} */ (window).__zap = { mode: 'client', host: null, client };
    attachClient(client);
    render();
  }

  /* ───────────── 한 화면에서 두기 ───────────── */

  function openLocalSession() {
    const n = S.localN;
    const names = S.localNames.slice(0, n).map((x) => String(x).trim());
    S.formError = '';
    for (let i = 0; i < n; i++) {
      if (nameProblem(names[i])) { S.formError = (i + 1) + '번 자리: ' + nameProblem(names[i]); render(); return; }
    }
    const seen = new Set();
    for (const nm of names) {
      const key = nm.normalize('NFC').toLowerCase();
      if (seen.has(key)) { S.formError = '이름이 서로 달라야 합니다: ' + nm; render(); return; }
      seen.add(key);
    }
    if (!localApi || !Zap.room) { S.formError = '한 화면 모드를 불러오지 못했습니다.'; render(); return; }
    resetSession();
    const my = sessionNo;
    /** @type {any} */
    let handle;
    try {
      handle = localApi.open({ names });
    } catch (e) {
      S.formError = text.errorText(e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : 'bad_state');
      S.screen = 'localSetup';
      render();
      return;
    }
    /** @type {ClientConnection[]} */
    const clients = handle.clients;
    S.mode = 'local'; S.local = handle; S.localSeat = 0; S.client = clients[0]; S.connStatus = 'open'; S.screen = 'session';
    /** @type {any} */ (window).__zap = { mode: 'local', host: null, client: S.client, local: handle };
    clients.forEach((c, i) => {
      c.on('room', () => { if (my === sessionNo) localSync(-1); });
      c.on('state', () => { if (my === sessionNo) localSync(i); });
      c.on('error', (data) => {
        if (my !== sessionNo) return;
        notify(text.errorText((data && data.code) || 'bad_message', data && data.detail));
      });
    });
    handle.on('events', (/** @type {GameEvent[]} */ evs) => {
      // 사건은 방에서 한 번만 받는다(자리마다 같은 사건이 오므로 자리 연결에서는 받지 않는다)
      if (my !== sessionNo || !Array.isArray(evs)) return;
      addEvents(evs);
    });
    const first = S.localFirst.indexOf('seat:') === 0 ? (names[Number(S.localFirst.slice(5))] || 'random') : 'random';
    const r = handle.command({ action: 'start', first });
    if (r && r.ok === false) {
      const msg = text.errorText(r.error);
      leave('localSetup');
      S.formError = msg;
    }
    render();
  }

  /**
   * 한 화면: 자리 연결들이 받은 화면 정보 가운데 "지금 차례인 자리"의 것을 화면에 올린다.
   * 수 하나에 자리마다 화면 정보가 따로 오므로, 차례가 넘어간 자리의 정보가 도착했을 때 그 자리로 바꾼다.
   * @param {number} from  방금 화면 정보를 받은 자리 (-1 이면 방 정보만 바뀜)
   */
  function localSync(from) {
    if (!S.local) return;
    /** @type {ClientConnection[]} */
    const clients = S.local.clients;
    if (from >= 0) {
      const lv = clients[from].view();
      if (lv && lv.phase !== 'over' && lv.current !== S.localSeat) {
        const tv = clients[lv.current] ? clients[lv.current].view() : null;
        if (tv && tv.current === lv.current && tv.turnsTaken === lv.turnsTaken && tv.phase === lv.phase) {
          S.localSeat = lv.current;
          S.client = clients[S.localSeat];
          /** @type {any} */ (window).__zap.client = S.client;
        }
      }
    }
    if (!S.client) return;
    const room = S.client.room();
    if (room) onRoom(room);
    const v = S.client.view();
    // 보이는 자리의 정보가 아직 옛 차례 것이면(곧 그 자리로 바뀔 것이므로) 올리지 않는다
    if (v && v !== S.view && (v.phase === 'over' || v.current === S.localSeat)) {
      const prev = S.view;
      const newTurn = !prev || prev.phase === 'over' || prev.current !== v.current || v.turnsTaken < prev.turnsTaken;
      if (newTurn && v.phase !== 'over') {
        // 다른 자리의 시점으로 바뀐다: 판 화면을 움직임 없이 새로 시작한다(앞 사람의 고르던 것·확대가 남지 않게)
        S.boardReset = true;
        S.curtain = S.localCurtain;
        S.announce = v.phase === 'action';
      }
      if (v.phase === 'over') S.curtain = false;
      onView(v);
    }
    render();
  }

  /** 같은 방 코드가 다른 탭에서 열려 있음: 이 서버를 닫고 새 코드로 다시 연다 */
  function reopenWithFreshCode() {
    const host = S.host;
    resetSession();
    try { if (host) host.close(); } catch (e) { /* 이미 닫힘 */ }
    openHostSession(true);
  }

  /** @param {'home'|'joinSetup'|'localSetup'} to */
  function leave(to) {
    const host = S.host;
    const client = S.client;
    const local = S.local;
    resetSession();
    try { if (local) local.close(); else if (host) host.close(); else if (client) client.close(); } catch (e) { /* 이미 닫힌 연결 */ }
    S.screen = to;
    render();
  }

  /* ───────────── 명령 ───────────── */

  /** @returns {boolean} 지금 이 화면에서 방장 조작을 할 수 있는지 */
  function canAdmin() {
    if (S.host || S.local) return true;
    return !!(S.room && S.room.you !== null && S.room.leader === S.room.you);
  }

  /** @param {AdminCommand} cmd */
  function admin(cmd) {
    if (S.host || S.local) {
      const r = S.local ? S.local.command(cmd) : /** @type {HostHandle} */ (S.host).command(cmd);
      if (r && r.ok === false) toast(text.errorText(r.error));
      else render();
    } else if (S.client) {
      S.client.admin(cmd);
    }
  }

  /** @returns {FirstChoice} */
  function firstChoice() {
    return S.first.indexOf('name:') === 0 ? S.first.slice(5) : 'random';
  }

  /** @param {Move} move */
  function sendMove(move) {
    if (!S.client) return;
    if (pendingTimer) clearTimeout(pendingTimer);
    // 답이 오지 않더라도 판이 계속 잠겨 있지 않게 한다
    pendingTimer = setTimeout(() => { pendingTimer = null; notify('서버의 답이 없습니다. 연결을 확인해 주세요.'); }, 8000);
    S.client.move(move);
  }

  /** 참가 링크: 서버는 net.js 가 만든 것, 참가자는 지금 주소(검색어 제외) + ?room=코드 (+ broker 값 그대로) */
  function joinUrl() {
    if (S.host) return S.host.joinUrl;
    const code = S.room ? S.room.roomCode : S.code;
    let url = String(window.location.href).split(/[?#]/)[0] + '?room=' + encodeURIComponent(code);
    const b = params.get('broker');
    if (b) url += '&broker=' + b.trim();
    return url;
  }

  function copyLink() {
    const url = joinUrl();
    const done = () => { S.copied = true; render(); setTimeout(() => { S.copied = false; render(); }, 2000); };
    const fallback = () => {
      const el = /** @type {HTMLInputElement|null} */ (document.querySelector('[data-test="join-url"]'));
      if (!el) return;
      el.focus(); el.select();
      try { if (document.execCommand('copy')) done(); else toast('복사하지 못했습니다. 링크를 길게 눌러 직접 복사해 주세요.'); }
      catch (e) { toast('복사하지 못했습니다. 링크를 길게 눌러 직접 복사해 주세요.'); }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  /* ───────────── 설정 ───────────── */

  /** @param {string} id */
  function pickSkin(id) {
    if (!SKINS[id] || id === S.skin) return;
    S.skin = id;
    store(SKIN_KEY, id);
    render();
  }

  /** 스킨 견본(카드 한 장 + 보석) @returns {any[]} */
  function skinChoices() {
    const def = Zap.data.cardsById.c62 || Zap.data.cards[60];
    return skinIds().map((id) => {
      const sk = SKINS[id];
      return {
        id, label: sk.label || id,
        sample: () => h('span.skinsample.' + sk.cssClass, null,
          h('span.skinsample__table', null,
            h('span.skinsample__card', { style: '--card-w:74px' }, sk.card(def)),
            h('span.skinsample__gems', null, Zap.data.TOKEN_COLORS.map((c) => h('span.skinsample__gem', null, sk.gem(c, 18)))))),
      };
    });
  }

  function settingsState() {
    const snd = V2 && V2.sound && V2.sound.getSettings ? V2.sound.getSettings() : { on: false, volume: 0.5 };
    const mot = V2 && V2.motion;
    return {
      skins: skinChoices(), skin: S.skin,
      soundOn: !!snd.on,
      soundVol: Number(snd.volume),
      musicOn: S.music.on, musicVol: S.music.volume,
      calm: mot && typeof mot.getReduced === 'function' ? !!mot.getReduced() : false,
    };
  }

  /* ───────────── 판 ───────────── */

  /** 자리 번호로 찾는 이름·접속 여부·방장 */
  function seatInfo() {
    const n = S.view ? S.view.numPlayers : 0;
    /** @type {string[]} */
    const names = [];
    /** @type {boolean[]} */
    const connected = [];
    /** @type {number|null} */
    let leaderSeat = null;
    for (let i = 0; i < n; i++) { names.push('자리 ' + (i + 1)); connected.push(true); }
    if (S.room) {
      for (const p of S.room.participants) {
        if (p.seat === null || p.seat === undefined || p.seat >= n) continue;
        names[p.seat] = p.name;
        connected[p.seat] = p.connected;
        if (p.leader) leaderSeat = p.seat;
      }
    }
    return { names, connected, leaderSeat };
  }

  /** @returns {HTMLElement|null} 판이 들어갈 자리(문서에 있을 때) */
  function boardHost() {
    return /** @type {HTMLElement|null} */ (document.querySelector('[data-own="board"]'));
  }

  /** 판 화면에 마지막으로 넘긴 것: 같은 것이면 다시 그리지 않는다(판 안의 고르던 것·지불 조정이 유지되게) */
  const lastBoard = { /** @type {HTMLElement|null} */ host: null, /** @type {PlayerView|null} */ view: null, sig: '' };

  /** 판을 그리거나 고친다 @param {boolean} [force] */
  function paintBoard(force) {
    const host = boardHost();
    // 판 자리가 문서에서 빠졌으면(가림막·대기실·나가기) 그 판을 치운다(타이머·크기 감시를 멈춤)
    if (lastBoard.host && lastBoard.host !== host && V2 && V2.board && V2.board.clear) {
      try { V2.board.clear(lastBoard.host); } catch (e) { /* 이미 치운 판 */ }
      lastBoard.host = null; lastBoard.view = null; lastBoard.sig = '';
    }
    if (!host || !S.view || !V2 || !V2.board) return;
    const info = seatInfo();
    const sk = skin();
    const seated = !!(S.room && S.room.you !== null && S.view.you !== null);
    const interactive = seated && !!S.client && S.connStatus === 'open';
    const admin_ = canAdmin();
    const sig = [sk && sk.id, info.names.join('\u0001'), info.connected.join(','), S.local ? '' : info.leaderSeat, interactive, admin_].join('|');
    const sameHost = host === lastBoard.host;
    if (!force && sameHost && S.view === lastBoard.view && sig === lastBoard.sig) return;
    const newView = S.view !== lastBoard.view;
    const reset = !sameHost || S.boardReset;
    const events = sameHost && newView && !reset && S.events.length ? S.events.slice() : undefined;
    if (newView || reset) S.events = [];
    S.boardReset = false;
    // 한 화면: 새 차례를 새로 그릴 때(가림막을 걷은 뒤 포함) 차례 시작 빛남·알림 소리
    const announceTurn = !!(S.local && S.announce && S.view.phase === 'action' && S.view.current === S.view.you);
    S.announce = false;
    lastBoard.host = host; lastBoard.view = S.view; lastBoard.sig = sig;
    V2.board.render(host, S.view, {
      skin: sk,
      names: info.names,
      connected: info.connected,
      leader: S.local ? null : info.leaderSeat,
      interactive,
      reset,
      events,
      announceTurn,
      on: {
        move: sendMove,
        newGame: admin_ ? () => { S.overlay = 'newgame'; render(); } : undefined,
      },
    });
  }

  /* ───────────── 판 밖 화면 ───────────── */

  /** @param {HTMLElement} body @param {() => void} close @param {string} test @returns {HTMLElement} */
  function overlay(body, close, test) {
    return h('div.sheetwrap', { test, 'data-key': 'overlay-' + test, onclick: (/** @type {Event} */ e) => { if (e.target === e.currentTarget) close(); } },
      h('div.sheet', { role: 'dialog', 'aria-modal': 'true' }, body));
  }

  /** @returns {HTMLElement} */
  function hostPanelEl() {
    const info = seatInfo();
    return panels.hostPanel({
      room: /** @type {RoomInfo} */ (S.room || (S.host && S.host.snapshot().room)),
      view: S.view,
      joinUrl: joinUrl(),
      status: S.hostStatus,
      first: S.first,
      copied: S.copied,
      hostPlays: !!S.client,
      names: info.names,
      paths: S.host && typeof S.host.paths === 'function' ? S.host.paths() : undefined,
    }, {
      setFirst: (v) => { S.first = v; },
      start: () => admin({ action: 'start', first: firstChoice() }),
      transfer: (name) => admin({ action: 'transfer', to: name }),
      remove: (name) => admin({ action: 'remove', name }),
      copy: copyLink,
      freshCode: reopenWithFreshCode,
    });
  }

  /** @param {boolean} inGame @returns {HTMLElement} */
  function topbar(inGame) {
    const room = S.room;
    const open = (/** @type {any} */ o) => () => { S.overlay = o; render(); };
    const settingsBtn = h('button.btn.btn--small', { test: 'open-settings', onclick: open('settings'), 'aria-label': '설정' }, '설정');
    if (S.local) {
      return h('header.topbar', { 'data-key': 'topbar' },
        h('span.topbar__brand', null, '짭플렌더'),
        h('span.topbar__room.topbar__room--turn', { test: 'local-turn' }, S.view && S.view.phase !== 'over' && !S.curtain
          // 이름이 길면 이름만 줄이고 '님 차례'는 늘 보이게
          ? h('b', null, h('span.topbar__name', null, seatInfo().names[S.view.current]), h('span.topbar__suffix', null, '님 차례')) : '한 화면'),
        h('span.topbar__gap'),
        settingsBtn,
        h('button.btn.btn--small.btn--quiet', { test: 'leave', onclick: open('leave') }, '나가기'));
    }
    const code = room ? room.roomCode : (S.host ? S.host.roomCode : S.code);
    const watching = !S.host && !!room && room.you === null && inGame;
    return h('header.topbar', { 'data-key': 'topbar', class: watching ? 'topbar--busy' : '' },
      h('span.topbar__brand', null, '짭플렌더'),
      code ? h('span.topbar__room.topbar__room--code', { title: '방 코드' }, h('b', { test: 'topbar-code' }, code)) : null,
      S.host ? panels.connPill(S.hostStatus, true) : null,
      S.client && !S.host ? panels.connPill(S.connStatus, false, S.client.path ? S.client.path() : null) : null,
      h('span.topbar__gap'),
      S.host && inGame ? h('button.btn.btn--small', { test: 'open-host-panel', onclick: open('host') }, '서버') : null,
      !S.host && room && room.you !== null && inGame ? h('button.btn.btn--small', { test: 'open-link', onclick: open('link') }, '링크') : null,
      !S.host && room && room.you === null && inGame ? h('span.topbar__watch', { test: 'watching-mark' }, '구경 중') : null,
      !S.host && room && room.you === null && inGame && S.watching ? h('button.btn.btn--small', { test: 'open-claim', onclick: () => { S.watching = false; render(); } }, '자리') : null,
      settingsBtn,
      // 판이 진행 중인 서버는 자리가 좁으므로 '서버 닫기'를 서버 패널 안에 둔다
      S.host && inGame ? null
        : h('button.btn.btn--small.btn--quiet', { test: 'leave', onclick: open('leave') }, S.host ? '서버 닫기' : '나가기'));
  }

  /** 참가자 연결이 끊겼을 때 판 위(위 막대 바로 아래 줄, 판을 가리지 않고 밀어냄)에 띄우는 줄 @returns {HTMLElement|null} */
  function connBanner() {
    if (!S.client || S.host || S.local) return null;
    if (S.connStatus === 'open' || !S.room) return null;
    return h('div.connbanner', { test: 'conn-banner', 'data-status': S.connStatus, 'data-key': 'connbanner', role: 'status' },
      text.connLine(S.connStatus, true, S.closingReason));
  }

  /** 판 자리. 판은 이 자리를 꽉 채운다 @returns {HTMLElement} */
  function stage() {
    return h('main.stage', { 'data-key': 'stage' },
      h('div.stage__board', { 'data-own': 'board', 'data-key': 'board', test: 'board' }));
  }

  /** @returns {any[]} [화면 본문들, 판 화면인지] */
  function sessionBody() {
    const room = S.room;

    // 한 화면에서 두기: 늘 지금 차례인 자리의 시점. 가림막이 내려와 있으면 판을 그리지 않는다(비공개 정보가 문서에 남지 않게)
    if (S.local) {
      if (!S.view || !room || room.status === 'lobby') return [h('main.front.front--form', { test: 'loading-board' }, h('h1.front__h', null, '판을 준비하는 중')), false];
      if (S.curtain && S.view.phase !== 'over') {
        const info = seatInfo();
        return [panels.curtain({ name: info.names[S.view.current] || '' }, { go: () => { S.curtain = false; S.boardReset = true; render(); } }), false];
      }
      return [stage(), true];
    }

    if (S.host && !S.client) {
      // 서버만 맡는 화면: 대기실이면 서버 패널, 판이 있으면 판(관전 시점)이 주 화면이고 서버 패널은 [서버] 덮개
      if (S.view && room && room.status !== 'lobby') return [stage(), true];
      return [h('main.lobby.lobby--host', { test: 'lobby' }, hostPanelEl()), false];
    }

    if (!room) return [panels.connecting({ code: S.code, status: S.connStatus }, { back: () => leave('joinSetup') }), false];

    if (room.you === null) {
      if (S.joining && S.host && room.status === 'lobby') return [h('main.front.front--form', { test: 'opening' }, h('h1.front__h', null, '방을 여는 중')), false];
      if (room.status === 'lobby') {
        return [panels.nameForm({ room, name: S.name, error: S.formError, conn: S.connStatus, connLine: text.connLine(S.connStatus, false, S.closingReason) }, {
          name: (v) => { S.name = v; },
          join: joinWithName,
          claim: (name) => { S.formError = ''; if (S.client) S.client.claim(name); },
        }), false];
      }
      // 판이 진행 중: 판을 구경하며, 끊긴 자리가 있으면 고르게 한다
      if (S.view) return [stage(), true];
      return [panels.claimForm({ room, error: S.formError, takenOver: S.takenOver }, { claim: claimSeat }), false];
    }

    if (room.status === 'lobby') {
      if (S.host) return [h('main.lobby.lobby--host', { test: 'lobby' }, hostPanelEl()), false];
      return [panels.lobby({
        room, canAdmin: canAdmin(), first: S.first, joinUrl: joinUrl(), copied: S.copied,
        conn: S.connStatus, connLine: text.connLine(S.connStatus, false, S.closingReason),
      }, {
        setFirst: (v) => { S.first = v; },
        start: () => admin({ action: 'start', first: firstChoice() }),
        transfer: (name) => admin({ action: 'transfer', to: name }),
        remove: (name) => admin({ action: 'remove', name }),
        copy: copyLink,
      }), false];
    }

    if (S.view) return [stage(), true];
    return [h('main.front.front--form', { test: 'loading-board' }, h('h1.front__h', null, '판을 불러오는 중')), false];
  }

  /** @param {string} name */
  function claimSeat(name) {
    S.formError = '';
    saveLastName(name);
    if (S.client) S.client.claim(name);
  }

  function joinWithName() {
    const bad = nameProblem(S.name);
    if (bad) { S.formError = bad; render(); return; }
    S.formError = '';
    const name = S.name.trim();
    saveLastName(name);
    if (S.client) S.client.join(name);
    render();
  }

  /** @returns {HTMLElement[]} 지금 띄울 덮개 */
  function overlays() {
    const out = [];
    const closeOverlay = () => { S.overlay = null; render(); };
    const room = S.room;
    const inGame = !!(room && room.status !== 'lobby');
    if (S.overlay === 'settings') {
      const st = settingsState();
      out.push(overlay(panels.settings(st, {
        skin: pickSkin,
        soundOn: (v) => { if (V2 && V2.sound) { V2.sound.setSettings({ on: v }); if (v) V2.sound.unlock(); } render(); },
        soundVol: (v) => { if (V2 && V2.sound) V2.sound.setSettings({ volume: v }); render(); },
        musicOn: (v) => { S.music.on = v; store(MUSIC_KEY, JSON.stringify(S.music)); render(); },
        musicVol: (v) => { S.music.volume = v; store(MUSIC_KEY, JSON.stringify(S.music)); render(); },
        calm: (v) => { if (V2 && V2.motion) V2.motion.setReduced(v); render(); },
        close: closeOverlay,
      }), closeOverlay, 'settings-overlay'));
    } else if (S.overlay === 'host' && S.host && inGame) {
      out.push(overlay(h('div', null, hostPanelEl(),
        h('div.btnrow.btnrow--split', null,
          h('button.btn', { test: 'close-host-panel', onclick: closeOverlay }, '판으로 돌아가기'),
          h('button.btn.btn--quiet', { test: 'leave', onclick: () => { S.overlay = 'leave'; render(); } }, '서버 닫기'))), closeOverlay, 'host-overlay'));
    } else if (S.overlay === 'link' && room && !S.host) {
      out.push(overlay(panels.linkPanel({ roomCode: room.roomCode, joinUrl: joinUrl(), copied: S.copied }, { copy: copyLink, close: closeOverlay }), closeOverlay, 'link-overlay'));
    } else if (S.overlay === 'newgame' && room && room.status === 'over' && canAdmin()) {
      out.push(overlay(panels.newGamePanel({ room, first: S.first }, {
        setFirst: (v) => { S.first = v; },
        go: () => { S.overlay = null; admin({ action: 'newGame', first: firstChoice() }); },
        cancel: closeOverlay,
      }), closeOverlay, 'new-game-overlay'));
    } else if (S.overlay === 'leave') {
      out.push(overlay(panels.leaveConfirm({ isHost: !!S.host, isLocal: !!S.local, inLobby: !!(room && room.status === 'lobby') }, { yes: () => leave('home'), no: closeOverlay }), closeOverlay, 'leave-overlay'));
    } else if (!S.overlay && room && inGame && room.you === null && !S.host && !S.local && S.view && !S.watching) {
      // 판이 진행 중인 방에 자리 없이 들어옴: 끊긴 자리 고르기(접으면 구경)
      out.push(overlay(panels.claimForm({ room, error: S.formError, takenOver: S.takenOver }, { claim: claimSeat, watch: () => { S.watching = true; render(); } }),
        () => { S.watching = true; render(); }, 'claim-overlay'));
    }
    return out;
  }

  /** @returns {HTMLElement} */
  function tree() {
    const sk = skin();
    const skinCls = sk ? sk.cssClass : '';
    if (S.screen === 'home') {
      return h('div.app.app--front.' + skinCls, { 'data-key': 'app-front' }, panels.home({
        host: () => { S.screen = 'hostSetup'; S.formError = ''; render(); },
        join: () => { S.screen = 'joinSetup'; S.formError = ''; render(); },
        local: () => { S.screen = 'localSetup'; S.formError = ''; render(); },
        skin: pickSkin,
      }, { localOnly: LOCAL_ONLY, hasLocal: !!(localApi && Zap.room), skins: skinChoices(), skin: S.skin }));
    }
    if (S.screen === 'localSetup') {
      return h('div.app.app--front.' + skinCls, { 'data-key': 'app-front' }, panels.localSetup({
        n: S.localN, names: S.localNames, first: S.localFirst, curtain: S.localCurtain, error: S.formError,
      }, {
        count: (n) => { S.localN = n; if (S.localFirst !== 'random' && Number(S.localFirst.slice(5)) >= n) S.localFirst = 'random'; S.formError = ''; render(); },
        name: (i, v) => { S.localNames[i] = v; },
        nameDone: () => render(),
        first: (v) => { S.localFirst = v; },
        curtain: (v) => { S.localCurtain = v; render(); },
        start: openLocalSession,
        back: () => { S.screen = 'home'; S.formError = ''; render(); },
      }));
    }
    if (S.screen === 'hostSetup') {
      return h('div.app.app--front.' + skinCls, { 'data-key': 'app-front' }, panels.hostSetup({ hostPlays: S.hostPlays, name: S.name, error: S.formError }, {
        toggle: (v) => { S.hostPlays = v; store(HOSTPLAYS_KEY, v ? '1' : '0'); S.formError = ''; render(); },
        name: (v) => { S.name = v; },
        open: () => openHostSession(false),
        back: () => { S.screen = 'home'; S.formError = ''; render(); },
      }));
    }
    if (S.screen === 'joinSetup') {
      return h('div.app.app--front.' + skinCls, { 'data-key': 'app-front' }, panels.joinSetup({ code: S.code, error: S.formError }, {
        code: (v) => { S.code = v; render(); },
        connect: () => { if (S.code.trim().length === 5) openClientSession(); },
        back: () => { S.screen = 'home'; S.formError = ''; render(); },
      }));
    }
    const [body, isGame] = sessionBody();
    const banner = isGame ? connBanner() : null;
    return h('div.app.app--session.' + skinCls, { 'data-key': 'app-session', class: (isGame ? 'app--game' : '') + (banner ? ' app--banner' : '') },
      topbar(!!(S.room && S.room.status !== 'lobby')), banner, body, overlays());
  }

  let lastKind = '';

  /** 화면을 새로 계산해 달라진 곳만 고치고(입력 중인 칸의 초점과 한글 조합이 유지됨), 판을 그린다 */
  function render() {
    const root = document.getElementById('app');
    if (!root) return;
    const sk = skin();
    if (sk && V2 && V2.board && V2.board.ensureFont) V2.board.ensureFont(sk);
    document.documentElement.setAttribute('data-skin', S.skin);
    const t = tree();
    // 화면이 바뀌면(시작 → 설정 → 대기실 → 판 …) 맨 위부터 보이게
    const kind = S.screen + ':' + (t.getAttribute('data-key') || '') + ':' + (S.room ? S.room.status + (S.room.you === null ? '-' : '+') : '');
    Zap.ui.dom.patch(root, [t, S.toast ? h('div.toast', { test: 'app-toast', role: 'status', 'data-key': 'toast' }, S.toast) : null]);
    if (kind !== lastKind) { lastKind = kind; if (window.scrollY) window.scrollTo(0, 0); }
    paintBoard();
  }

  /* ───────────── 시작 ───────────── */

  window.addEventListener('beforeunload', (e) => {
    // 서버 탭을 닫거나 새로 고치면 판이 사라지므로 한 번 묻는다 (시험에서는 __zap.skipUnloadWarning = true 로 끌 수 있음)
    const z = /** @type {any} */ (window).__zap;
    if ((S.host || (S.local && !LOCAL_ONLY)) && S.room && S.room.status === 'playing' && !(z && z.skipUnloadWarning)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (S.overlay) { S.overlay = null; render(); }
  });
  // 브라우저는 첫 조작 전에는 소리를 막는다: 첫 누름에서 소리 장치를 깨운다
  const wake = () => {
    // 효과음이 꺼져 있으면 소리 장치를 만들지 않는다(켤 때 설정에서 깨운다)
    const on = V2 && V2.sound && V2.sound.getSettings ? !!V2.sound.getSettings().on : false;
    if (on && V2.sound.unlock) { try { V2.sound.unlock(); } catch (e) { /* 소리를 못 내는 환경 */ } }
    document.removeEventListener('pointerdown', wake, true);
    document.removeEventListener('keydown', wake, true);
  };
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('keydown', wake, true);

  function boot() {
    if (S.code && !LOCAL_ONLY) openClientSession();
    else render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  Zap.ui.app = { state: S, render, toast, notify };
})();
