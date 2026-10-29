// @ts-check
/*
 * 짭플렌더 화면 — 한국어 문구 (Zap.ui.text)
 * 오류 코드와 연결 상태를 사람이 읽는 문장으로 바꾼다. (판에서 일어난 일은 판 화면이 움직임으로 보여 준다.)
 */
(function () {
  /** @type {Record<string, string>} */
  const ERRORS = {
    // 규칙 처리
    game_over: '판이 이미 끝났습니다.',
    not_your_turn: '지금은 내 차례가 아닙니다.',
    wrong_phase: '지금 단계에서는 할 수 없는 행동입니다.',
    illegal_move: '규칙상 둘 수 없는 수입니다.',
    bad_payment: '낼 토큰이 카드 비용과 맞지 않습니다.',
    noble_already_claimed: '귀족은 한 차례에 한 장만 받을 수 있습니다. 이번 차례에는 이미 받았습니다.',
    noble_not_met: '이 귀족의 조건을 아직 채우지 못했습니다.',
    bad_move: '서버가 알아듣지 못한 요청입니다. 화면을 새로 고친 뒤 다시 해 보세요.',
    // 방 운영
    bad_name: '쓸 수 없는 이름입니다. 1~12자로 정해 주세요("random"은 쓸 수 없습니다).',
    name_taken: '이미 다른 사람이 쓰는 이름입니다. 다른 이름을 정해 주세요.',
    room_full: '방이 가득 찼습니다. 한 방에는 4명까지 들어갈 수 있습니다.',
    game_in_progress: '판이 이미 시작되어 새로 참가할 수 없습니다. 연결이 끊긴 자리만 다시 잡을 수 있습니다.',
    no_such_seat: '그 이름의 자리가 없습니다.',
    seat_taken: '그 자리에는 지금 다른 사람이 접속해 있습니다.',
    already_joined: '이미 이 방에 참가해 있습니다.',
    not_joined: '먼저 이름을 정하고 참가해 주세요.',
    not_leader: '방장만 할 수 있는 일입니다.',
    not_enough_players: '2명 이상 모여야 판을 시작할 수 있습니다.',
    bad_state: '지금은 할 수 없는 일입니다.',
    bad_message: '서버가 알아듣지 못한 요청입니다. 화면을 새로 고친 뒤 다시 해 보세요.',
  };

  /** @param {string} code @param {string} [detail] @returns {string} */
  function errorText(code, detail) {
    if (detail === 'not_connected') return '서버와 연결되어 있지 않아 보내지 못했습니다. 다시 연결되면 한 번 더 해 주세요.';
    if (detail === 'webrtc_unsupported') return '이 브라우저는 기기끼리 직접 연결하는 기능(WebRTC)을 쓸 수 없어 참가할 수 없습니다.';
    if (detail === 'taken_over') return '다른 탭이나 기기에서 같은 자리로 들어와, 이 화면의 자리가 그쪽으로 넘어갔습니다.';
    return ERRORS[code] || ('요청이 거부되었습니다 (' + code + ').');
  }

  /** 참가자 쪽 연결 상태 @param {ConnStatus} st @returns {string} */
  function connText(st) {
    switch (st) {
      case 'connecting': return '서버에 연결하는 중';
      case 'open': return '연결됨';
      case 'reconnecting': return '연결이 끊겨 다시 연결하는 중';
      case 'not_found': return '서버를 찾을 수 없어 다시 시도하는 중';
      case 'closed': return '연결이 닫힘';
      case 'server_gone': return '서버가 닫힘';
      default: return String(st);
    }
  }

  /**
   * 참가자 쪽 연결 상태를 판 위·대기실에 띄우는 한 줄로(연결됨이면 빈 문자열)
   * @param {ConnStatus} st @param {boolean} inGame @param {string} [reason] 서버가 닫힐 때 알린 이유('closed'|'reload')
   * @returns {string}
   */
  function connLine(st, inGame, reason) {
    switch (st) {
      case 'open': return '';
      case 'server_gone':
        return (reason === 'reload' ? '서버가 다시 열리는 중입니다' : '서버가 닫혔습니다')
          + (inGame ? ' — 진행 중이던 판은 이어지지 않습니다.' : '.') + ' 서버가 다시 열리면 자동으로 돌아갑니다.';
      case 'reconnecting': return '연결이 끊겨 다시 연결하는 중입니다…' + (inGame ? ' 연결되면 이어서 둘 수 있습니다.' : '');
      case 'not_found': return '서버를 찾을 수 없습니다. 서버가 다시 열리면 자동으로 연결합니다.';
      case 'connecting': return '서버에 연결하는 중…';
      case 'closed': return '연결이 닫혔습니다. 나갔다가 다시 참가해 주세요.';
      default: return String(st);
    }
  }

  /** 서버 쪽(중개 서버와의) 연결 상태 @param {ConnStatus} st @returns {string} */
  function hostConnText(st) {
    switch (st) {
      case 'connecting': return '중개 서버에 연결하는 중 — 아직 참가를 받을 수 없습니다';
      case 'open': return '중개 서버에 연결됨 — 참가를 받을 수 있습니다';
      case 'reconnecting': return '중개 서버와 끊겨 다시 연결하는 중 — 새 참가와 재접속이 잠시 안 될 수 있습니다';
      case 'not_found': return '중개 서버를 찾을 수 없어 다시 시도하는 중';
      case 'closed': return '서버가 닫혔습니다';
      case 'id_taken': return '이 방 코드가 다른 탭이나 기기에서 이미 열려 있어 기다리는 중';
      default: return String(st);
    }
  }

  /** @param {TokenColor} c @returns {string} */
  function colorName(c) {
    return Zap.data.COLOR_NAMES[c] || String(c);
  }

  Zap.ui.text = { errorText, connText, connLine, hostConnText, colorName };
})();
