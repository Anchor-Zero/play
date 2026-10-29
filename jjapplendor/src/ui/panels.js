// @ts-check
/*
 * 짭플렌더 화면 — 판 밖의 화면들 (Zap.ui.panels)
 * 시작 화면(스킨 고르기 포함), 서버 열기·참가 입력, 연결 상태, 이름 정하기·자리 고르기, 대기실, 서버 패널, 설정, 새 판.
 * 판과 결과는 판 화면(Zap.v2.board)이 그린다. 여기 함수들은 값과 할 일(on.*)을 받아 DOM 을 돌려주기만 한다. 흐름은 app.js 가 맡는다.
 * 색·글꼴은 고른 스킨의 테마 변수(--table, --panel, --ink …)를 쓴다(style.css).
 */
(function () {
  /** @type {(spec:string, attrs?:any, ...kids:any[]) => HTMLElement} */
  const h = Zap.ui.dom.h;
  /** @type {(map:Record<string, any>) => string} */
  const cls = Zap.ui.dom.cls;
  const text = Zap.ui.text;

  /** 폼: 엔터로도 제출되게 @param {string} spec @param {() => void} submit @param {...any} kids @returns {HTMLElement} */
  function form(spec, submit, ...kids) {
    return h('form' + spec, { novalidate: true, onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); submit(); } }, kids);
  }

  /** @param {string} msg @returns {HTMLElement|null} */
  function errorBox(msg) {
    return msg ? h('div.formerr', { test: 'form-error', role: 'alert' }, msg) : null;
  }

  /* ───────────── 시작 화면 ───────────── */

  /**
   * 스킨 견본 하나: 카드 한 장 + 보석 여섯
   * @typedef {{id:string, label:string, sample:() => HTMLElement}} SkinChoice
   */

  /**
   * 스킨 고르기 줄
   * @param {SkinChoice[]} skins @param {string} current @param {(id:string) => void} pick
   * @returns {HTMLElement}
   */
  function skinPicker(skins, current, pick) {
    return h('div.skinpick', { role: 'radiogroup', 'aria-label': '그림' }, skins.map((sk) =>
      h('button.skinpick__opt', {
        type: 'button', test: 'skin-' + sk.id, role: 'radio', 'aria-checked': String(sk.id === current),
        class: cls({ 'is-on': sk.id === current }), onclick: () => pick(sk.id),
      },
        h('span.skinpick__sample', { 'data-key': 'sample-' + sk.id, 'aria-hidden': 'true' }, sk.sample()),
        h('span.skinpick__label', null, sk.label))));
  }

  /**
   * @param {{host:() => void, join:() => void, local:() => void, skin:(id:string) => void}} on
   * @param {{localOnly:boolean, hasLocal:boolean, skins:SkinChoice[], skin:string}} o  localOnly: 한 화면 모드만 되는 곳(온라인 연결이 막힌 틀)
   * @returns {HTMLElement}
   */
  function home(on, o) {
    const localBtn = o.hasLocal ? h('button.choice', { test: 'open-local', class: o.localOnly ? 'choice--main' : '', onclick: on.local },
      h('span.choice__t', null, '한 화면에서 두기'),
      h('span.choice__d', null, '이 화면 하나로 모든 자리를 번갈아 둡니다. 연결이 필요 없습니다.')) : null;
    return h('main.front', { test: 'home' },
      h('h1.front__title', null, '짭플렌더'),
      h('p.front__lead', null, '보석을 모아 카드를 사고, 먼저 15점을 넘기면 이기는 2~4인 보드게임입니다.'),
      o.skins.length > 1 ? skinPicker(o.skins, o.skin, on.skin) : null,
      o.localOnly
        ? h('div.front__choices', null, localBtn,
          h('p.note', { test: 'local-only-note' }, '여기서는 한 화면 모드만 됩니다. 친구와 온라인으로 두려면 파일 버전이나 GitHub 주소에서 여세요.'))
        : h('div.front__choices', null,
          h('button.choice.choice--main', { test: 'open-host', onclick: on.host },
            h('span.choice__t', null, '서버 열기'),
            h('span.choice__d', null, '이 기기가 판을 진행합니다. 방 코드를 만들어 사람들을 부릅니다.')),
          h('button.choice', { test: 'open-join', onclick: on.join },
            h('span.choice__t', null, '참가하기'),
            h('span.choice__d', null, '받은 방 코드로 열려 있는 방에 들어갑니다.')),
          localBtn));
  }

  /**
   * 한 화면에서 두기 설정.
   * @param {{n:number, names:string[], first:string, curtain:boolean, error:string}} s
   * @param {{count:(n:number) => void, name:(i:number, v:string) => void, nameDone:() => void, first:(v:string) => void, curtain:(v:boolean) => void, start:() => void, back:() => void}} on
   * @returns {HTMLElement}
   */
  function localSetup(s, on) {
    const seats = [];
    for (let i = 0; i < s.n; i++) {
      seats.push(h('label.field.field--seat', null,
        h('span.plist__no', null, String(i + 1)),
        h('input.input', {
          type: 'text', test: 'local-name-' + i, maxlength: 24, autocomplete: 'off', placeholder: '1~12자', value: s.names[i], 'aria-label': (i + 1) + '번 자리 이름',
          oninput: (/** @type {Event} */ e) => on.name(i, /** @type {HTMLInputElement} */ (e.target).value),
          onchange: () => on.nameDone(),
        })));
    }
    const firstOpts = [h('option', { value: 'random', selected: s.first === 'random' }, '무작위')];
    for (let i = 0; i < s.n; i++) {
      firstOpts.push(h('option', { value: 'seat:' + i, selected: s.first === 'seat:' + i }, (i + 1) + '. ' + (String(s.names[i]).trim() || '이름 없음')));
    }
    return h('main.front.front--form', { test: 'local-setup' },
      h('h1.front__h', null, '한 화면에서 두기'),
      form('.stack', on.start,
        h('div.field', null,
          h('span.field__label', null, '인원'),
          h('div.seg', { role: 'group', 'aria-label': '인원' }, [2, 3, 4].map((n) =>
            h('button.btn.seg__btn', { type: 'button', test: 'local-count-' + n, class: s.n === n ? 'is-on' : '', 'aria-pressed': String(s.n === n), onclick: () => on.count(n) }, n + '명')))),
        h('div.field', null,
          h('span.field__label', null, '자리와 이름 — 차례는 선 플레이어부터 번호 순서로 돕니다'),
          seats),
        h('label.field.field--inline', null,
          h('span.field__label', null, '선 플레이어'),
          h('select.input.input--select', {
            test: 'local-first',
            onchange: (/** @type {Event} */ e) => on.first(/** @type {HTMLSelectElement} */ (e.target).value),
          }, firstOpts)),
        h('label.check', null,
          h('input', {
            type: 'checkbox', test: 'local-curtain', checked: s.curtain,
            onchange: (/** @type {Event} */ e) => on.curtain(/** @type {HTMLInputElement} */ (e.target).checked),
          }),
          h('span', null, h('b', null, '차례가 바뀔 때 가림막'),
            h('small', null, s.curtain
              ? '차례가 넘어가면 화면을 가리고, 다음 사람이 [시작]을 눌러야 판이 보입니다. 덱에서 예약한 카드를 서로 보지 않게 합니다.'
              : '차례가 넘어가면 바로 다음 사람의 화면으로 바뀝니다. 덱에서 예약한 카드가 서로 보일 수 있습니다.'))),
        errorBox(s.error),
        h('div.btnrow', null,
          h('button.btn.btn--primary.btn--big', { type: 'submit', test: 'local-start' }, '판 시작'),
          h('button.btn.btn--quiet', { type: 'button', test: 'back', onclick: on.back }, '뒤로'))));
  }

  /**
   * 한 화면: 차례가 바뀌었을 때의 가림막.
   * @param {{name:string}} s
   * @param {{go:() => void}} on
   * @returns {HTMLElement}
   */
  function curtain(s, on) {
    return h('main.front.front--form.curtain', { test: 'curtain' },
      h('p.result__kicker', null, '화면을 넘겨 주세요'),
      h('h1.front__h', { test: 'curtain-name' }, s.name + '님 차례입니다'),
      h('p.note', null, '준비되면 시작을 누르세요. 누르기 전에는 판이 보이지 않습니다.'),
      h('div.btnrow', null, h('button.btn.btn--primary.btn--big', { test: 'curtain-start', onclick: on.go }, '시작')));
  }

  /**
   * @param {{hostPlays:boolean, name:string, error:string}} s
   * @param {{toggle:(v:boolean) => void, name:(v:string) => void, open:() => void, back:() => void}} on
   * @returns {HTMLElement}
   */
  function hostSetup(s, on) {
    return h('main.front.front--form', { test: 'host-setup' },
      h('h1.front__h', null, '서버 열기'),
      form('.stack', on.open,
        h('label.check', null,
          h('input', {
            type: 'checkbox', test: 'host-plays', checked: s.hostPlays,
            onchange: (/** @type {Event} */ e) => on.toggle(/** @type {HTMLInputElement} */ (e.target).checked),
          }),
          h('span', null, h('b', null, '이 기기에서도 플레이'),
            h('small', null, s.hostPlays
              ? '이 기기에서 직접 둡니다. 처음 들어온 사람이 되어 방장도 맡습니다.'
              : '이 기기는 서버만 맡습니다. 직접 두려면 다른 기기에서 방 코드로 참가하세요.'))),
        s.hostPlays ? h('label.field', null,
          h('span.field__label', null, '내 이름'),
          h('input.input', {
            type: 'text', test: 'host-name', maxlength: 24, autocomplete: 'off', placeholder: '1~12자', value: s.name,
            oninput: (/** @type {Event} */ e) => on.name(/** @type {HTMLInputElement} */ (e.target).value),
          })) : null,
        errorBox(s.error),
        h('div.btnrow', null,
          h('button.btn.btn--primary.btn--big', { type: 'submit', test: 'host-open' }, '서버 열기'),
          h('button.btn.btn--quiet', { type: 'button', test: 'back', onclick: on.back }, '뒤로'))),
      h('p.note', null, '서버를 연 탭을 닫거나 새로 고치면 진행 중인 판이 사라집니다. 폰으로 서버를 열면 다른 앱으로 넘어가 있는 동안 판이 멈춥니다.'));
  }

  /**
   * @param {{code:string, error:string}} s
   * @param {{code:(v:string) => void, connect:() => void, back:() => void}} on
   * @returns {HTMLElement}
   */
  function joinSetup(s, on) {
    return h('main.front.front--form', { test: 'join-setup' },
      h('h1.front__h', null, '참가하기'),
      form('.stack', on.connect,
        h('label.field', null,
          h('span.field__label', null, '방 코드'),
          h('input.input.input--code', {
            type: 'text', test: 'room-code', maxlength: 5, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
            placeholder: '글자 5개', value: s.code,
            oninput: (/** @type {Event} */ e) => {
              const el = /** @type {HTMLInputElement} */ (e.target);
              const up = el.value.toUpperCase().replace(/\s+/g, '');
              if (up !== el.value) el.value = up;
              on.code(up);
            },
          })),
        errorBox(s.error),
        h('div.btnrow', null,
          h('button.btn.btn--primary.btn--big', { type: 'submit', test: 'join-connect', disabled: s.code.trim().length !== 5 }, '연결'),
          h('button.btn.btn--quiet', { type: 'button', test: 'back', onclick: on.back }, '뒤로'))),
      h('p.note', null, '서버를 연 사람에게서 방 코드나 참가 링크를 받으세요. 링크로 들어오면 코드가 자동으로 채워집니다.'));
  }

  /* ───────────── 연결 상태 ───────────── */

  /** 위쪽 막대에 두는 작은 상태 표시 @param {ConnStatus} st @param {boolean} isHost @param {ConnPath|null} [path] 참가자 연결의 경로 @returns {HTMLElement} */
  function connPill(st, isHost, path) {
    const short = st === 'open' ? (isHost ? '참가 받는 중' : '연결됨')
      : st === 'connecting' ? '연결 중'
        : st === 'reconnecting' ? '다시 연결 중'
          : st === 'not_found' ? '서버 찾는 중'
            : st === 'server_gone' ? '서버 닫힘'
              : st === 'id_taken' ? '코드 사용 중' : '닫힘';
    return h('span.pill.pill--' + st, {
      test: isHost ? 'host-status' : 'conn-status', 'data-status': st,
      title: isHost ? text.hostConnText(st) : text.connText(st),
    }, h('i.pill__dot'), short,
    // 연결 경로: 중계(TURN)를 거칠 때만 덧붙인다(직접 연결은 정상 상태라 표시하지 않음)
    st === 'open' && path && path.kind === 'relay'
      ? h('span.pill__path', { test: 'conn-path', 'data-path': 'relay', title: '중계 서버' + (path.relay ? '(' + path.relay + ')' : '') + '를 거쳐 연결됨' }, ' · 중계')
      : null);
  }

  /** 서버 패널 참가자 줄의 연결 경로 표지('직접'/'중계', 모르면 없음) @param {string} name @param {ConnPath|undefined} path @returns {HTMLElement|null} */
  function pathBadge(name, path) {
    if (!path || (path.kind !== 'direct' && path.kind !== 'relay')) return null;
    return h('span.badge.badge--path', {
      test: 'conn-path-' + name, 'data-path': path.kind, class: path.kind === 'relay' ? 'badge--relay' : '',
      title: path.kind === 'relay' ? '중계 서버' + (path.relay ? '(' + path.relay + ')' : '') + '를 거쳐 연결됨' : '중계 없이 직접 연결됨',
    }, path.kind === 'relay' ? '중계' : '직접');
  }

  /**
   * 아직 방 정보를 받지 못했을 때.
   * @param {{code:string, status:ConnStatus}} s
   * @param {{back:() => void}} on
   * @returns {HTMLElement}
   */
  function connecting(s, on) {
    const nf = s.status === 'not_found';
    return h('main.front.front--form', { test: 'connecting', 'data-status': s.status },
      h('h1.front__h', null, nf ? '서버를 찾을 수 없습니다' : s.status === 'closed' ? '연결이 닫혔습니다' : '서버에 연결하는 중'),
      h('p.front__code', null, '방 코드 ', h('b', null, s.code)),
      h('p.note', null, nf
        ? '이 방 코드로 열려 있는 서버가 없습니다. 코드가 맞는지, 서버를 연 기기의 화면이 켜져 있는지 확인해 주세요. 그동안 계속 다시 시도합니다.'
        : s.status === 'reconnecting' ? '연결이 끊겨 다시 연결하고 있습니다.'
          : s.status === 'closed' ? '다시 참가하려면 방 코드를 다시 입력해 주세요.'
            : '서로를 찾는 데 몇 초 걸릴 수 있습니다.'),
      h('div.btnrow', null,
        h('button.btn', { test: 'connect-back', onclick: on.back }, nf || s.status === 'closed' ? '방 코드 다시 입력' : '취소')));
  }

  /* ───────────── 참가자 목록·시작 조작 (대기실과 서버 패널이 함께 씀) ───────────── */

  /**
   * @param {RoomInfo} room
   * @param {{canAdmin:boolean, transfer?:(name:string) => void, remove?:(name:string) => void, paths?:Record<string, ConnPath>}} o
   *   remove: 대기실에서 연결이 끊긴 참가자를 목록에서 바로 빼기(방장·서버)
   *   paths: (서버 화면) 이름 → 그 사람 연결의 경로. 사람마다 '직접'/'중계' 표지
   * @returns {HTMLElement}
   */
  function participantList(room, o) {
    const rows = room.participants.map((p, i) => {
      const order = p.seat !== null && p.seat !== undefined ? p.seat + 1 : i + 1;
      const canMake = o.canAdmin && o.transfer && !p.leader && p.connected;
      const canRemove = o.canAdmin && o.remove && !p.connected && room.status === 'lobby';
      return h('li.plist__row', { test: 'participant-' + p.name, 'data-connected': String(p.connected), 'data-leader': String(p.leader), class: cls({ 'is-off': !p.connected }) },
        h('span.plist__no', { title: '자리(차례 순서)' }, String(order)),
        h('span.plist__name', null, p.name, room.you === p.name ? h('span.me__you', null, '나') : null),
        p.leader ? h('span.badge', null, '방장') : null,
        h('span.badge', { class: p.connected ? 'badge--on' : 'badge--off' }, p.connected ? '접속 중' : '연결 끊김'),
        p.connected && o.paths ? pathBadge(p.name, o.paths[p.name]) : null,
        canMake ? h('button.btn.btn--small', { test: 'make-leader-' + p.name, onclick: () => o.transfer(p.name) }, '방장 넘기기') : null,
        canRemove ? h('button.btn.btn--small', { test: 'remove-' + p.name, title: '연결이 끊긴 참가자를 목록에서 뺍니다', onclick: () => o.remove(p.name) }, '빼기') : null);
    });
    // 판이 시작된 뒤에는 새 참가를 받지 않으므로 '몇 명 중'이 아니라 '몇 명'
    const head = room.status === 'lobby' ? '참가자 ' + room.participants.length + '/' + room.maxPlayers : '참가자 ' + room.participants.length + '명';
    return h('div.plist', null,
      h('div.plist__head', null, head,
        h('small', null, ' — 번호는 자리이고, 차례는 선 플레이어부터 번호 순서로 돕니다')),
      rows.length ? h('ol.plist__rows', { test: 'participants' }, rows)
        : h('p.muted', { test: 'participants' }, '아직 들어온 사람이 없습니다.'));
  }

  /**
   * 선 플레이어 고르기 + 시작 버튼.
   * @param {RoomInfo} room
   * @param {{first:string, label:string, test:string, setFirst:(v:string) => void, go:() => void, blocked?:string}} o
   *   blocked: 시작할 수 없는 이유(예: 서버와 연결이 끊김). 있으면 단추를 끄고 이유를 보인다
   * @returns {HTMLElement}
   */
  function startControls(room, o) {
    const n = room.participants.length;
    const enough = n >= room.minPlayers;
    const off = room.participants.filter((p) => !p.connected).map((p) => p.name);
    const opts = [h('option', { value: 'random', selected: o.first === 'random' }, '무작위')];
    room.participants.forEach((p, i) => {
      // 값에 이름을 그대로 두면 이름이 'random' 인 사람과 헷갈리므로 'name:' 을 앞에 붙인다
      opts.push(h('option', { value: 'name:' + p.name, selected: o.first === 'name:' + p.name, 'data-name': p.name }, (i + 1) + '. ' + p.name));
    });
    return h('div.startbox', null,
      h('label.field.field--inline', null,
        h('span.field__label', null, '선 플레이어'),
        h('select.input.input--select', {
          test: 'first-select',
          onchange: (/** @type {Event} */ e) => o.setFirst(/** @type {HTMLSelectElement} */ (e.target).value),
        }, opts)),
      h('button.btn.btn--primary.btn--big', { test: o.test, disabled: !enough || !!o.blocked, onclick: o.go }, o.label),
      o.blocked ? h('p.note.note--warn', { test: 'start-blocked' }, o.blocked) : null,
      !enough ? h('p.note', null, room.minPlayers + '명 이상 모이면 시작할 수 있습니다.') : null,
      off.length ? h('p.note.note--warn', { test: 'start-offline-note' },
        '연결이 끊긴 사람(' + off.join(', ') + ')도 자리를 받습니다. 그 사람의 차례가 되면 다시 들어올 때까지 판이 기다립니다.') : null);
  }

  /**
   * 참가 링크 + [링크 복사]
   * @param {{joinUrl:string, copied:boolean}} s
   * @param {{copy:() => void}} on
   * @returns {HTMLElement}
   */
  function linkRow(s, on) {
    return h('div.linkbox', null,
      h('span.hostpanel__label', null, '참가 링크'),
      h('div.linkrow', null,
        h('input.input.input--link', {
          type: 'text', readonly: true, test: 'join-url', value: s.joinUrl, 'aria-label': '참가 링크',
          onfocus: (/** @type {Event} */ e) => /** @type {HTMLInputElement} */ (e.target).select(),
        }),
        h('button.btn', { type: 'button', test: 'copy-link', onclick: on.copy }, s.copied ? '복사됨' : '링크 복사')));
  }

  /**
   * (참가자, 판 중) 위 막대의 [링크] 로 여는 덮개
   * @param {{roomCode:string, joinUrl:string, copied:boolean}} s
   * @param {{copy:() => void, close:() => void}} on
   * @returns {HTMLElement}
   */
  function linkPanel(s, on) {
    return h('section.confirm', { test: 'link-panel' },
      h('h2.confirm__h', null, '이 방으로 부르기'),
      h('div', null, h('span.hostpanel__label', null, '방 코드'), h('b.bigcode.bigcode--mid', null, s.roomCode)),
      linkRow(s, on),
      h('p.note', null, '링크를 받은 사람이 열면 방 코드가 채워진 채로 들어옵니다. 판이 시작된 뒤에는 연결이 끊긴 자리로만 들어올 수 있습니다.'),
      h('div.btnrow', null, h('button.btn.btn--quiet', { test: 'link-close', onclick: on.close }, '닫기')));
  }

  /* ───────────── 이름 정하기 · 자리 고르기 ───────────── */

  /**
   * @param {{room:RoomInfo, name:string, error:string, conn?:ConnStatus, connLine?:string}} s  connLine: 서버와의 연결이 열려 있지 않을 때 한 줄
   * @param {{name:(v:string) => void, join:() => void, claim:(name:string) => void}} on
   * @returns {HTMLElement}
   */
  function nameForm(s, on) {
    const full = s.room.participants.length >= s.room.maxPlayers;
    const off = s.room.participants.filter((p) => !p.connected);
    return h('main.front.front--form', { test: 'name-form' },
      h('h1.front__h', null, '방 ', h('span.codeinline', null, s.room.roomCode), '에 참가'),
      s.connLine ? h('p.connline', { test: 'lobby-conn', 'data-status': s.conn || '' }, h('i.pill__dot'), s.connLine) : null,
      full ? h('p.note.note--warn', { test: 'room-full-note' }, off.length
        ? '방이 가득 찼습니다. 새 이름으로는 참가할 수 없고, 아래의 끊긴 자리로만 돌아갈 수 있습니다.'
        : '방이 가득 찼습니다(' + s.room.maxPlayers + '명). 자리가 나면 새 이름으로 참가할 수 있습니다.') : null,
      off.length ? h('div.claimbox', { test: 'lobby-claim' },
        h('div.claimbox__h', null, '끊긴 자리로 돌아가기'),
        h('p.note', null, '아까 들어왔다가 연결이 끊겼다면 내 이름을 고르세요. 같은 자리와 순서로 돌아갑니다.'),
        h('div.claim__seats', null, off.map((p) =>
          h('button.btn.btn--big', { type: 'button', test: 'claim-' + p.name, onclick: () => on.claim(p.name) }, p.name + ' 자리로 돌아가기'))),
        h('div.claimbox__or', null, '또는 새 이름으로 참가')) : null,
      form('.stack', on.join,
        h('label.field', null,
          h('span.field__label', null, '내 이름'),
          h('input.input', {
            type: 'text', test: 'name-input', maxlength: 24, autocomplete: 'off', placeholder: '1~12자', value: s.name, disabled: full,
            oninput: (/** @type {Event} */ e) => on.name(/** @type {HTMLInputElement} */ (e.target).value),
          })),
        errorBox(s.error),
        h('div.btnrow', null, h('button.btn.btn--primary.btn--big', { type: 'submit', test: 'join', disabled: full }, '참가'))),
      participantList(s.room, { canAdmin: false }));
  }

  /**
   * 판이 진행 중일 때: 연결이 끊긴 자리 고르기.
   * @param {{room:RoomInfo, error:string, takenOver?:string}} s  takenOver: 이 화면의 자리가 다른 탭·기기로 넘어간 자리 이름
   * @param {{claim:(name:string) => void, watch?:() => void}} on
   * @returns {HTMLElement}
   */
  function claimForm(s, on) {
    const open = s.room.participants.filter((p) => !p.connected);
    return h('section.claim', { test: 'claim-form' },
      h('h2.claim__h', null, s.room.status === 'over' ? '판이 끝난 방입니다' : '판이 진행 중인 방입니다'),
      s.takenOver ? h('p.note.note--warn', { test: 'taken-over-note' },
        '다른 탭이나 기기에서 ' + s.takenOver + ' 자리로 들어와, 이 화면의 자리가 그쪽으로 넘어갔습니다. 그 화면에서 이어서 두세요.') : null,
      open.length
        ? h('p.note', null, '새로 참가할 수는 없고, 연결이 끊긴 자리로 다시 들어갈 수 있습니다. 내 이름을 고르세요.')
        : h('p.note', null, '지금은 연결이 끊긴 자리가 없어 들어갈 수 없습니다. 판은 구경할 수 있습니다.'),
      errorBox(s.error),
      open.length ? h('div.claim__seats', null, open.map((p) =>
        h('button.btn.btn--big', { test: 'claim-' + p.name, onclick: () => on.claim(p.name) }, p.name + ' 자리로 들어가기'))) : null,
      on.watch ? h('div.btnrow', null, h('button.btn.btn--quiet', { test: 'claim-watch', onclick: on.watch }, '판 구경하기')) : null);
  }

  /* ───────────── 대기실 ───────────── */

  /**
   * @param {{room:RoomInfo, canAdmin:boolean, first:string, joinUrl:string, copied:boolean, conn:ConnStatus, connLine:string}} s
   * @param {{setFirst:(v:string) => void, start:() => void, transfer:(name:string) => void, remove:(name:string) => void, copy:() => void}} on
   * @returns {HTMLElement}
   */
  function lobby(s, on) {
    const room = s.room;
    return h('main.lobby', { test: 'lobby' },
      h('h1.lobby__h', null, '대기실'),
      h('p.lobby__code', null, '방 코드 ', h('b.codeinline', { test: 'room-code-display' }, room.roomCode)),
      s.conn !== 'open' ? h('p.connline', { test: 'lobby-conn', 'data-status': s.conn }, h('i.pill__dot'), s.connLine) : null,
      linkRow(s, on),
      participantList(room, { canAdmin: s.canAdmin, transfer: on.transfer, remove: on.remove }),
      s.canAdmin
        ? startControls(room, { first: s.first, label: '판 시작', test: 'start', setFirst: on.setFirst, go: on.start, blocked: s.conn !== 'open' ? '서버와 연결되어 있지 않아 시작할 수 없습니다.' : '' })
        : h('p.waiting', { test: 'waiting-leader' }, (room.leader ? room.leader + '님(방장)이' : '방장이') + ' 판을 시작하기를 기다리는 중입니다.'));
  }

  /* ───────────── 서버 패널 ───────────── */

  /**
   * @param {{room:RoomInfo, view:PlayerView|null, joinUrl:string, status:ConnStatus, first:string, copied:boolean, hostPlays:boolean, names:string[], paths?:Record<string, ConnPath>}} s
   * @param {{setFirst:(v:string) => void, start:() => void, transfer:(name:string) => void, remove:(name:string) => void, copy:() => void, freshCode:() => void}} on
   * @returns {HTMLElement}
   */
  function hostPanel(s, on) {
    const room = s.room;
    let stateBox;
    if (room.status === 'lobby') {
      stateBox = startControls(room, { first: s.first, label: '판 시작', test: 'start', setFirst: on.setFirst, go: on.start });
    } else if (room.status === 'over') {
      stateBox = h('p.hostpanel__state', { test: 'host-game-state' }, '판이 끝났습니다. 결과 화면의 [새 판]으로 같은 자리 그대로 새 판을 엽니다.');
    } else {
      const v = s.view;
      stateBox = h('p.hostpanel__state', { test: 'host-game-state' }, '판 진행 중' + (v ? ' — ' + (s.names[v.current] || '') + '님의 차례 (지금까지 ' + v.turnsTaken + '차례)' : ''));
    }
    return h('section.hostpanel', { test: 'host-panel' },
      h('h2.hostpanel__h', null, '서버'),
      h('div.hostpanel__code', null,
        h('span.hostpanel__label', null, '방 코드'),
        h('b.bigcode', { test: 'room-code-display' }, room.roomCode)),
      linkRow(s, on),
      h('p.hostpanel__status.hostpanel__status--' + s.status, { test: 'host-status-text', 'data-status': s.status }, h('i.pill__dot'), text.hostConnText(s.status)),
      s.status === 'id_taken' ? h('div.claimbox', { test: 'id-taken' },
        h('div.claimbox__h', null, '이 방 코드가 다른 탭이나 기기에서 이미 열려 있습니다'),
        h('p.note', null, '앞서 연 서버 탭이 아직 열려 있으면 이 탭은 참가를 받을 수 없습니다. 새 코드로 열거나, 앞의 탭을 닫으면 이 탭이 그 코드를 이어받습니다(그대로 두면 계속 기다립니다).'),
        h('div.btnrow', null, h('button.btn.btn--primary', { test: 'host-fresh-code', onclick: on.freshCode }, '새 코드로 열기'))) : null,
      participantList(room, { canAdmin: true, transfer: on.transfer, remove: on.remove, paths: s.paths }),
      stateBox,
      h('p.note', null, s.hostPlays
        ? '이 탭이 서버입니다. 닫거나 새로 고치면 진행 중인 판이 사라집니다.'
        : '이 탭은 서버만 맡고 있습니다. 닫거나 새로 고치면 진행 중인 판이 사라집니다. 직접 두려면 다른 기기나 탭에서 참가 링크로 들어오세요.'));
  }

  /* ───────────── 새 판 · 설정 ───────────── */

  /**
   * 새 판(같은 자리 그대로): 선 플레이어 고르기
   * @param {{room:RoomInfo, first:string}} s
   * @param {{setFirst:(v:string) => void, go:() => void, cancel:() => void}} on
   * @returns {HTMLElement}
   */
  function newGamePanel(s, on) {
    return h('section.confirm', { test: 'new-game-panel' },
      h('h2.confirm__h', null, '새 판'),
      h('p.note', null, '같은 자리 그대로 새 판을 시작합니다.'),
      startControls(s.room, { first: s.first, label: '새 판 시작', test: 'new-game-start', setFirst: on.setFirst, go: on.go }),
      h('div.btnrow', null, h('button.btn.btn--quiet', { test: 'new-game-cancel', onclick: on.cancel }, '취소')));
  }

  /**
   * 설정: 그림(스킨), 효과음, 배경음악(자리만), 움직임 줄이기
   * @param {{skins:SkinChoice[], skin:string, soundOn:boolean, soundVol:number, musicOn:boolean, musicVol:number, calm:boolean}} s
   * @param {{skin:(id:string) => void, soundOn:(v:boolean) => void, soundVol:(v:number) => void, musicOn:(v:boolean) => void, musicVol:(v:number) => void, calm:(v:boolean) => void, close:() => void}} on
   * @returns {HTMLElement}
   */
  function settings(s, on) {
    /** @param {string} test @param {boolean} val @param {(v:boolean) => void} set @param {string} label */
    const toggle = (test, val, set, label) => h('label.check.check--row', null,
      h('input', { type: 'checkbox', test, checked: val, onchange: (/** @type {Event} */ e) => set(/** @type {HTMLInputElement} */ (e.target).checked) }),
      h('b', null, label));
    /** @param {string} test @param {number} v @param {boolean} enabled @param {(v:number) => void} set @param {string} label */
    const slider = (test, v, enabled, set, label) => h('label.field.field--range', null,
      h('span.field__label', null, label),
      h('input.range', {
        type: 'range', test, min: 0, max: 100, step: 5, value: String(Math.round(v * 100)), disabled: !enabled, 'aria-label': label,
        oninput: (/** @type {Event} */ e) => set(Number(/** @type {HTMLInputElement} */ (e.target).value) / 100),
      }),
      h('span.field__val', null, Math.round(v * 100) + '%'));
    return h('section.confirm.settings', { test: 'settings-panel' },
      h('h2.confirm__h', null, '설정'),
      h('div.settings__group', null,
        h('span.settings__label', null, '그림'),
        skinPicker(s.skins, s.skin, on.skin),
        h('p.note', null, '그림은 이 기기에서만 바뀝니다. 같은 판의 다른 사람은 각자 고른 그림으로 봅니다.')),
      h('div.settings__group', null,
        h('span.settings__label', null, '효과음'),
        toggle('sound-on', s.soundOn, on.soundOn, '효과음 켜기'),
        slider('sound-volume', s.soundVol, s.soundOn, on.soundVol, '효과음 음량')),
      h('div.settings__group', null,
        h('span.settings__label', null, '배경음악'),
        toggle('music-on', s.musicOn, on.musicOn, '배경음악 켜기'),
        slider('music-volume', s.musicVol, s.musicOn, on.musicVol, '배경음악 음량'),
        h('p.note', { test: 'music-note' }, '아직 넣은 음악이 없습니다. 음악이 생기면 이 설정대로 나옵니다.')),
      h('div.settings__group', null,
        h('span.settings__label', null, '움직임'),
        toggle('motion-reduce', s.calm, on.calm, '움직임 줄이기'),
        h('p.note', null, '켜면 카드·칩이 날아가는 움직임 없이 바로 바뀝니다. 기기의 \'동작 줄이기\' 설정도 따릅니다.')),
      h('div.btnrow', null, h('button.btn.btn--primary', { test: 'settings-close', onclick: on.close }, '닫기')));
  }

  /**
   * 나가기 확인.
   * @param {{isHost:boolean, isLocal?:boolean, inLobby?:boolean}} s
   * @param {{yes:() => void, no:() => void}} on
   * @returns {HTMLElement}
   */
  function leaveConfirm(s, on) {
    return h('section.confirm', { test: 'leave-dialog' },
      h('h2.confirm__h', null, s.isLocal ? '판을 그만둘까요?' : s.isHost ? '서버를 닫을까요?' : '방에서 나갈까요?'),
      h('p.note', null, s.isLocal ? '나가면 진행 중인 판이 사라집니다.' : s.isHost
        ? '서버를 닫으면 진행 중인 판이 사라지고 모든 참가자의 연결이 끊깁니다.'
        : s.inLobby ? '대기실에서 나가면 참가자 목록에서 빠집니다. 다시 들어오려면 이름을 새로 정해 참가하세요.'
          : '판이 진행 중이면 내 자리는 그대로 남고, 같은 이름으로 다시 들어올 수 있습니다.'),
      h('div.btnrow', null,
        h('button.btn.btn--danger', { test: 'leave-confirm', onclick: on.yes }, s.isHost ? '서버 닫기' : '나가기'),
        h('button.btn.btn--quiet', { test: 'leave-cancel', onclick: on.no }, '계속하기')));
  }

  Zap.ui.panels = { home, skinPicker, localSetup, curtain, hostSetup, joinSetup, connPill, connecting, participantList, startControls, linkRow, linkPanel, nameForm, claimForm, lobby, hostPanel, newGamePanel, settings, leaveConfirm };
})();
