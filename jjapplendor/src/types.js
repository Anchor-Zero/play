// @ts-check
/*
 * 짭플렌더 — 공용 형식 정의 (형식 문서의 기계 판독용 부분)
 *
 * 이 파일은 실행 시 전역 객체 Zap 하나만 만든다. 나머지는 모두 JSDoc 형식 정의다.
 * 모든 소스 파일은 "일반 script 태그로 차례로 불러오는" 방식으로 쓴다(모듈 import/export 금지).
 *  - 브라우저: index.html이 <script src> 로 차례로 불러온다 (file:// 로 열어도 동작해야 함).
 *  - Node 시험: require('.../types.js'); require('.../data.js'); require('.../rules.js') 후 globalThis.Zap 을 쓴다.
 * 각 파일은 즉시 실행 함수 (function(){ ... })(); 로 감싸 최상위 이름이 새지 않게 하고,
 * 공개할 것은 Zap.<이름> = {...} 으로만 붙인다. module.exports 는 쓰지 않는다.
 *
 * 형식 정의를 바꿔야 하면 직접 고치지 말고 메인(통합 담당)에게 보고한다.
 */

/* ───────────── 기본 값 ───────────── */

/** 보석 색. w=흰(다이아몬드) u=파랑(사파이어) g=초록(에메랄드) r=빨강(루비) k=검정(오닉스). 화면 순서도 이 순서.
 * @typedef {'w'|'u'|'g'|'r'|'k'} Color */
/** 토큰 종류 = 보석 다섯 색 + 황금
 * @typedef {Color|'gold'} TokenColor */
/** @typedef {{w:number,u:number,g:number,r:number,k:number}} ColorCounts */
/** 다섯 색 + 황금. 모든 칸이 항상 존재해야 한다(없으면 0).
 * @typedef {{w:number,u:number,g:number,r:number,k:number,gold:number}} TokenCounts */
/** @typedef {1|2|3} Tier */

/* ───────────── 데이터 (data.js) ───────────── */

/** @typedef {{id:string, tier:Tier, bonus:Color, points:number, cost:ColorCounts}} CardDef  id: 'c00'~'c89' */
/** @typedef {{id:string, points:number, require:ColorCounts}} NobleDef  id: 'n0'~'n9' */
/** 인원수별 준비: 보석 색당 개수, 황금 개수, 공개 귀족 수
 * @typedef {{gems:number, gold:number, nobles:number}} SetupRow */
/**
 * @typedef {Object} DataAPI
 * @property {CardDef[]} cards
 * @property {Record<string, CardDef>} cardsById
 * @property {NobleDef[]} nobles
 * @property {Record<string, NobleDef>} noblesById
 * @property {Color[]} COLORS          ['w','u','g','r','k']
 * @property {TokenColor[]} TOKEN_COLORS  ['w','u','g','r','k','gold']
 * @property {Record<number, SetupRow>} SETUP  키 2·3·4
 * @property {Record<TokenColor, string>} COLOR_NAMES  화면용 한국어 이름
 */

/* ───────────── 판 상태 (rules.js 가 만들고 바꾼다) ───────────── */

/** 예약한 카드. fromDeck=true 이면 덱 맨 위에서 가져온 카드(주인 외에는 비공개).
 * @typedef {{id:string, fromDeck:boolean}} ReservedCard */

/**
 * @typedef {Object} PlayerState
 * @property {TokenCounts} tokens     보유 토큰
 * @property {string[]} cards         구매한 카드 id (산 순서)
 * @property {ReservedCard[]} reserved  예약 카드 (최대 3)
 * @property {string[]} nobles        받은 귀족 id
 */

/**
 * 차례 단계.
 *  'action' : 행동 하나를 해야 함
 *  'return' : 행동 후 토큰이 10개를 넘음 → 넘는 만큼 반납해야 함 (귀족 받기는 가능, 차례 넘기기는 불가)
 *  'end'    : 행동(또는 자동 패스) 완료, 토큰 10개 이하 → 귀족 받기(차례당 1회) 가능, 차례 넘기기 가능
 *  'over'   : 판 종료
 * @typedef {'action'|'return'|'end'|'over'} Phase
 */

/**
 * 판 상태 전체. 순수 JSON 이어야 한다(함수·Map·순환 참조 금지). 규칙 처리 코드는 여기 적힌 항목만 써야 하며,
 * 숨은 내부 항목을 추가하지 않는다(시험 코드가 이 형식대로 상태를 직접 만들어 넣을 수 있어야 하므로).
 * @typedef {Object} GameState
 * @property {number} numPlayers          2~4
 * @property {number} firstPlayer         선 플레이어 자리 번호 (종료 판정 기준)
 * @property {number} current             지금 차례인 자리 번호
 * @property {Phase} phase
 * @property {TokenCounts} supply         공급처 토큰
 * @property {{1:string[], 2:string[], 3:string[]}} decks      단계별 덱 (카드 id, 배열 0번이 맨 위)
 * @property {{1:(string|null)[], 2:(string|null)[], 3:(string|null)[]}} market  단계별 공개 카드 4칸 (빈칸은 null)
 * @property {string[]} nobles            아직 남아 있는 공개 귀족 id
 * @property {PlayerState[]} players      자리 번호 순
 * @property {boolean} nobleClaimedThisTurn  이번 차례에 귀족을 이미 받았는지
 * @property {boolean} autoPassed         이번 차례가 '할 수 있는 행동 없음'으로 자동 패스되었는지
 * @property {number|null} finalRoundBy   처음 15점 이상으로 차례를 마친 자리 (종료 발동, 없으면 null)
 * @property {number} turnsTaken          지금까지 끝난 차례 수 (모든 플레이어 합산)
 * @property {number[]|null} winners      판이 끝나면 승자 자리 번호들 (공동 승리면 여럿), 아니면 null
 * @property {number} autoPassStreak      실제 행동(take3·take2·reserve·reserveDeck·buy) 없이 연달아 나온 자동 패스 수 (2026-10-29). 행동하면 0, 자동 패스마다 +1, 인원수에 이르면 교착으로 판이 끝난다
 * @property {'points'|'deadlock'} [endReason]  판이 끝난 이유 (2026-10-29): 'points' 15점 종료, 'deadlock' 모든 자리가 행동할 수 없는 교착. 끝나기 전에는 없음
 */

/* ───────────── 수 (참가자 → 서버) ───────────── */

/** 서로 다른 색 보석 가져오기. colors 는 서로 다른 색 3개. 공급처에 남은 색이 3색 미만일 때만 남은 색 수만큼(2개 또는 1개).
 * @typedef {{type:'take3', colors:Color[]}} MoveTake3 */
/** 같은 색 2개. 가져가기 전에 그 색이 공급처에 4개 이상.
 * @typedef {{type:'take2', color:Color}} MoveTake2 */
/** 공개 카드 예약 (어느 단계든)
 * @typedef {{type:'reserve', cardId:string}} MoveReserve */
/** 덱 맨 위 카드 예약
 * @typedef {{type:'reserveDeck', tier:Tier}} MoveReserveDeck */
/** 공개 카드 또는 자기 예약 카드 구매. payment = 실제로 낼 토큰(황금 포함). 유효한 지불이면 어떤 조합이든 허용.
 * @typedef {{type:'buy', cardId:string, payment:TokenCounts}} MoveBuy */
/** 10개 초과분 반납. tokens 합계는 정확히 (보유 합계 - 10).
 * @typedef {{type:'return', tokens:TokenCounts}} MoveReturn */
/** 귀족 받기 (서버가 보너스로 조건 확인)
 * @typedef {{type:'claimNoble', nobleId:string}} MoveClaimNoble */
/** 차례 넘기기 (이때 15점 종료 판정)
 * @typedef {{type:'endTurn'}} MoveEndTurn */
/** @typedef {MoveTake3|MoveTake2|MoveReserve|MoveReserveDeck|MoveBuy|MoveReturn|MoveClaimNoble|MoveEndTurn} Move */

/* ───────────── 사건 (서버 → 모두, 공개해도 되는 정보만) ───────────── */

/**
 * 판에서 일어난 일. 모든 참가자에게 똑같이 보내므로 비공개 정보(덱에서 예약한 카드 id 등)를 담지 않는다.
 * @typedef {{type:'take', seat:number, tokens:TokenCounts}
 *   | {type:'reserve', seat:number, tier:Tier, cardId:string|null, fromDeck:boolean, gold:boolean}
 *   | {type:'buy', seat:number, cardId:string, payment:TokenCounts, fromReserve:boolean}
 *   | {type:'return', seat:number, tokens:TokenCounts}
 *   | {type:'noble', seat:number, nobleId:string}
 *   | {type:'endTurn', seat:number}
 *   | {type:'autoPass', seat:number}
 *   | {type:'finalRound', seat:number}
 *   | {type:'deadlock'}
 *   | {type:'gameOver', winners:number[]}} GameEvent
 * reserve 사건에서 fromDeck=true 이면 cardId 는 항상 null.
 * autoPass: 차례가 넘어와 시작된 자리에 둘 수 있는 행동이 없을 때. 그 자리는 바로 'end' 단계가 된다.
 * finalRound: 처음으로 누군가 15점 이상으로 차례를 마쳤을 때 한 번.
 * deadlock (2026-10-29): 실제 행동 없이 자동 패스가 인원수만큼 이어져(모든 자리가 행동할 수 없음) 판을 그 자리에서 끝낼 때. 순서는 endTurn → (finalRound) → autoPass → deadlock → gameOver 이며, 이때 autoPass 된 자리는 'end' 단계가 되지 않고 판이 'over' 가 된다.
 */

/** 규칙 처리 오류 코드
 * @typedef {'game_over'|'not_your_turn'|'wrong_phase'|'illegal_move'|'bad_payment'|'noble_already_claimed'|'noble_not_met'|'bad_move'} RulesError */

/** @typedef {{ok:true, state:GameState, events:GameEvent[]} | {ok:false, error:RulesError}} ApplyResult */

/* ───────────── 참가자별 화면 정보 (서버 → 참가자) ───────────── */

/** 예약 카드의 보이는 모습. 공개 줄에서 예약했거나 내 카드면 {id, fromDeck}, 남이 덱에서 예약한 카드면 {hidden:true, tier}.
 * @typedef {{id:string, fromDeck:boolean} | {hidden:true, tier:Tier}} ReservedView */

/**
 * @typedef {Object} PlayerPublicView
 * @property {TokenCounts} tokens
 * @property {number} tokenTotal
 * @property {ColorCounts} bonuses
 * @property {number} score
 * @property {string[]} cards
 * @property {ReservedView[]} reserved
 * @property {string[]} nobles
 */

/**
 * 한 자리에서 보이는 판. 덱 순서와 남의 덱 예약 카드 id 는 절대 담지 않는다.
 * @typedef {Object} PlayerView
 * @property {number|null} you            내 자리 번호 (관전·서버 화면이면 null)
 * @property {number} numPlayers
 * @property {number} firstPlayer
 * @property {number} current
 * @property {Phase} phase
 * @property {TokenCounts} supply
 * @property {{1:number, 2:number, 3:number}} deckCounts
 * @property {{1:(string|null)[], 2:(string|null)[], 3:(string|null)[]}} market
 * @property {string[]} nobles
 * @property {PlayerPublicView[]} players
 * @property {boolean} nobleClaimedThisTurn
 * @property {boolean} autoPassed
 * @property {number|null} finalRoundBy
 * @property {number} turnsTaken
 * @property {number[]|null} winners
 * @property {'points'|'deadlock'} [endReason]  판이 끝난 이유 (GameState.endReason 그대로, 끝나기 전에는 없음) (2026-10-29)
 * @property {Move[]} legal   내 차례일 때 지금 둘 수 있는 수 전부(아니면 빈 배열). 구매는 카드마다 1개, payment 는 보석 먼저 쓰는 제안 조합.
 */

/** @typedef {{seat:number, score:number, cardCount:number, rank:number, winner:boolean}} Standing */

/**
 * 규칙 처리 (rules.js). 모든 함수는 입력을 바꾸지 않는다.
 * @typedef {Object} RulesAPI
 * @property {(opts:{numPlayers:number, firstPlayer:number, seed:number}) => GameState} createGame  카드·귀족 섞기는 여기서만, seed 가 같으면 같은 판
 * @property {(state:GameState, seat:number) => Move[]} legalMoves  그 자리가 지금 둘 수 있는 수 전부 (차례가 아니면 [])
 * @property {(state:GameState, seat:number, move:Move) => ApplyResult} applyMove
 * @property {(state:GameState, seat:number|null) => PlayerView} viewFor
 * @property {(state:GameState, seat:number) => number} scoreOf
 * @property {(state:GameState, seat:number) => ColorCounts} bonusesOf
 * @property {(tokens:TokenCounts, bonuses:ColorCounts, card:CardDef) => TokenCounts|null} suggestPayment  보석 먼저, 모자라는 만큼 황금. 못 사면 null
 * @property {(tokens:TokenCounts, bonuses:ColorCounts, card:CardDef, payment:TokenCounts) => boolean} isValidPayment
 * @property {(bonuses:ColorCounts, noble:NobleDef) => boolean} meetsNoble
 * @property {(state:GameState) => Standing[]} standings  순위순
 * @property {(seed:number) => () => number} rng  [0,1) 난수 생성기 (같은 seed → 같은 수열)
 */

/* ───────────── 방 운영 (room.js, 연결 방식과 무관) ───────────── */

/** @typedef {'lobby'|'playing'|'over'} RoomStatus */

/**
 * @typedef {Object} ParticipantInfo
 * @property {string} name
 * @property {boolean} connected
 * @property {number|null} seat     판이 시작되면 자리 번호, 대기실에서는 null
 * @property {boolean} leader       방장 여부
 */

/**
 * 참가자에게 보내는 방 정보
 * @typedef {Object} RoomInfo
 * @property {string} roomCode
 * @property {RoomStatus} status
 * @property {ParticipantInfo[]} participants  들어온 순서
 * @property {string|null} you      이 연결이 차지한 이름 (아직 없으면 null)
 * @property {string|null} leader   방장 이름
 * @property {number} minPlayers    2
 * @property {number} maxPlayers    4
 */

/** 선 플레이어 방식: 'random' 또는 참가자 이름
 * @typedef {'random'|string} FirstChoice */

/** 방장(또는 서버 화면)의 명령
 * @typedef {{action:'start', first:FirstChoice}
 *   | {action:'newGame', first:FirstChoice}
 *   | {action:'transfer', to:string}
 *   | {action:'remove', name:string}} AdminCommand
 * remove (2026-10-29): 대기실에서만, 연결이 끊긴 참가자를 목록에서 바로 뺀다(3분 유예를 기다리지 않음). 접속 중인 사람·판 진행 중에는 bad_state. */

/** 참가자 → 서버 메시지
 * join 의 key: 참가하는 쪽이 만든 임의 문자열. 서버는 이름과 함께 기억한다.
 * claim 의 key: 생략하면 '연결이 끊긴 자리'만 잡을 수 있다. key 가 그 이름의 key 와 같으면 아직 연결된 것으로 보이는 자리도
 *   넘겨받는다(같은 탭이 끊겼다 돌아왔는데 서버가 옛 연결의 끊김을 아직 모를 때를 위한 것). 이때 옛 연결은 서버가 닫는다.
 * @typedef {{type:'hello'}
 *   | {type:'join', name:string, key:string}
 *   | {type:'claim', name:string, key?:string}
 *   | {type:'move', move:Move}
 *   | {type:'admin', cmd:AdminCommand}
 *   | {type:'leave'}} ClientMsg
 * leave (2026-10-29): 참가자가 스스로 나갈 때 연결을 닫기 직전에 보낸다. 대기실이면 목록에서 바로 빠진다(유예 없음, 방장이면 이양).
 *   판 진행 중이면 끊김과 같게 자리를 유지한다(판이 그 사람을 기다림 — 기존 결정). */

/** 방 운영 오류 코드 (규칙 오류 코드는 RulesError 를 그대로 씀)
 * @typedef {'bad_name'|'name_taken'|'room_full'|'game_in_progress'|'no_such_seat'|'seat_taken'|'already_joined'|'not_joined'|'not_leader'|'not_enough_players'|'bad_state'|'bad_message'} RoomError */

/** 서버 → 참가자 메시지
 * @typedef {{type:'room', room:RoomInfo}
 *   | {type:'state', view:PlayerView}
 *   | {type:'events', events:GameEvent[]}
 *   | {type:'error', code:RoomError|RulesError, detail?:string}
 *   | {type:'closing', reason:'closed'|'reload'}} ServerMsg
 * closing (2026-10-29): 서버가 스스로 닫히거나(서버 닫기) 탭을 새로 고치거나 닫을 때(pagehide/beforeunload에서 가능한 만큼) 모든 연결에 먼저 보낸다.
 *   참가자는 '서버가 닫혔습니다(새로 고침이면: 다시 열리는 중) — 진행 중이던 판은 이어지지 않습니다' 로 안내한다. 이 메시지 뒤의 방 정보 변화는 무시해도 된다. */

/**
 * 서버 화면용 전체 정보
 * @typedef {Object} RoomSnapshot
 * @property {RoomInfo} room          you 는 null
 * @property {PlayerView|null} view   관전 시점 화면 정보 (판이 없으면 null)
 */

/**
 * @typedef {Object} RoomOptions
 * @property {string} roomCode
 * @property {(connId:string, msg:ServerMsg) => void} send   특정 연결에 메시지 보내기
 * @property {(connId:string) => void} [kick]                 그 연결을 닫기 (key 로 자리를 넘겨받을 때 옛 연결 정리용). net 쪽이 그 뒤 같은 id 로 disconnect 를 불러도 room 은 무시해야 한다
 * @property {(snap:RoomSnapshot) => void} [onChange]         상태가 바뀔 때마다 (서버 화면 갱신용)
 * @property {number} [seed]                                   판 시작 시 seed (없으면 무작위). 시험용
 * @property {number} [lobbyGraceMs]                           대기실에서 끊긴 참가자를 목록에 남겨 두는 시간 (기본 180000). 시험용으로 줄일 수 있음
 */

/**
 * 방 하나 (room.js). 연결 id 는 net.js 가 정한다(호스트 기기 안 연결은 'local').
 * @typedef {Object} Room
 * @property {(connId:string) => void} connect
 * @property {(connId:string) => void} disconnect
 * @property {(connId:string, msg:ClientMsg) => void} receive
 * @property {(cmd:AdminCommand) => {ok:true}|{ok:false, error:RoomError}} serverCommand   서버 화면의 명령 (최우선 권한)
 * @property {() => RoomSnapshot} snapshot
 */

/** @typedef {{createRoom: (opts:RoomOptions) => Room}} RoomAPI */

/* ───────────── 연결 (net.js) ───────────── */

/** 중개 서버 설정. null 이면 PeerJS 무료 중개 서비스.
 * @typedef {{host:string, port:number, path:string, secure:boolean} | null} BrokerConfig */

/**
 * 'connecting' 연결 중 / 'open' 연결됨 / 'reconnecting' 끊겨서 다시 연결 중 / 'not_found' 그 방 코드의 서버가 없음 / 'closed' 닫힘
 * 'server_gone' (2026-10-29, 참가자 쪽): closing 메시지를 받은 뒤. 계속 다시 연결을 시도하되 화면은 '서버가 닫힘' 안내를 한다(서버가 다시 열리면 'open').
 * 'id_taken' (2026-10-29, 서버 쪽): 같은 방 코드가 다른 탭·기기에서 이미 열려 있음(중개 서비스가 unavailable-id 를 일정 시간 이상 계속 돌려줌).
 *   화면은 이유를 알리고 [새 코드로 열기]를 제공한다. 재시도는 계속해도 된다(앞 탭이 닫히면 넘겨받음).
 * @typedef {'connecting'|'open'|'reconnecting'|'not_found'|'closed'|'server_gone'|'id_taken'} ConnStatus */

/**
 * 연결 경로 (2026-10-29): 이 데이터 연결이 기기 사이를 직접 잇는지, 중계 서버(TURN)를 거치는지. 통신 정보라 방 정보·판 상태에는 넣지 않는다.
 * net.js 가 RTCPeerConnection.getStats() 의 선택된 후보 쌍으로 판정한다(열린 직후, ICE 가 다시 이어질 때. 주기적 확인 없음).
 *  kind: 'direct' 양쪽 후보가 host/srflx/prflx / 'relay' 어느 한쪽이 relay / 'unknown' 판정 못 함
 *  local·remote: 이쪽·저쪽 후보 종류('host'|'srflx'|'prflx'|'relay'), 알 때만.  relay: 중계일 때 중계 서버 주소('eu-0.turn.peerjs.com:3478' 또는 IP:포트), 알 때만
 * @typedef {{kind:'direct'|'relay'|'unknown', local?:string, remote?:string, relay?:string}} ConnPath */

/**
 * 참가자 쪽 연결. 원격(PeerJS)과 호스트 기기 안 연결이 같은 형태다.
 * @typedef {Object} ClientConnection
 * @property {(name:string) => void} join
 * @property {(name:string) => void} claim
 * @property {(move:Move) => void} move
 * @property {(cmd:AdminCommand) => void} admin
 * @property {(ev:'room'|'state'|'events'|'error'|'status'|'closing'|'path', fn:(data:any) => void) => void} on   'closing' → {reason:'closed'|'reload'} (2026-10-29), 'path' → ConnPath|null (2026-10-29)
 * @property {() => ConnPath|null} [path]   이 연결의 경로 (2026-10-29). 열린 연결이 없거나 판정 전이면 null, 기기 안 연결(localClient)은 늘 null. 한 화면 모드(local.js)의 연결에는 없다
 * @property {() => ConnStatus} status
 * @property {() => RoomInfo|null} room     마지막으로 받은 방 정보
 * @property {() => PlayerView|null} view   마지막으로 받은 화면 정보
 * @property {() => void} close   스스로 나갈 때는 닫기 전에 leave 를 보낸다(2026-10-29)
 */

/**
 * 서버(방을 연 기기) 쪽 핸들
 * @typedef {Object} HostHandle
 * @property {string} roomCode
 * @property {string} joinUrl                참가 링크 (중개 서버 설정이 주소에 있으면 그대로 이어 붙임)
 * @property {(cmd:AdminCommand) => {ok:true}|{ok:false, error:RoomError}} command   서버 화면의 명령
 * @property {() => RoomSnapshot} snapshot
 * @property {ClientConnection|null} localClient   서버가 플레이어를 겸하면 기기 안 연결, 아니면 null
 * @property {(ev:'change'|'status'|'events'|'path', fn:(data:any) => void) => void} on   'change' → RoomSnapshot, 'status' → ConnStatus, 'events' → GameEvent[] (참가자에게 보내는 것과 같은 사건, 서버 화면의 기록용), 'path' → Record<이름, ConnPath> (2026-10-29)
 * @property {() => ConnStatus} status
 * @property {() => Record<string, ConnPath>} paths   참가자 이름 → 그 사람 연결의 경로 (2026-10-29). 접속 중이고 판정이 끝난 원격 참가자만(끊긴 사람·자리 없는 구경꾼·기기 안 연결은 없음)
 * @property {() => void} close
 */

/**
 * @typedef {Object} NetAPI
 * @property {(search:string) => BrokerConfig} parseBroker   location.search 의 broker=호스트:포트 를 읽음
 * @property {(opts:{broker:BrokerConfig, hostPlays:boolean, roomCode?:string, freshCode?:boolean, seed?:number}) => HostHandle} openHost  freshCode: 기억한 코드를 버리고 새 코드로 연다(2026-10-29, id_taken 때)
 * @property {(opts:{broker:BrokerConfig, roomCode:string}) => ClientConnection} connect
 * @property {() => string} newRoomCode
 * @property {(roomCode:string) => string} peerIdFor
 * @property {(stats:any) => ConnPath} classifyStats   getStats() 결과(RTCStatsReport 또는 항목 배열)로 경로 판정 (2026-10-29, 순수 함수)
 */

/* ───────────── 전역 ───────────── */

/**
 * @typedef {Object} ZapNS
 * @property {DataAPI} data
 * @property {RulesAPI} rules
 * @property {RoomAPI} room
 * @property {NetAPI} net
 * @property {any} [ui]      화면 담당이 자유롭게 사용
 * @property {Record<string, any>} [skins]   v2 시안의 그림 스킨 (design/skin-api.js 의 SkinAPI)
 * @property {any} [v2]      v2 시안의 판·움직임·소리 담당이 자유롭게 사용
 */

/** @type {ZapNS} */
var Zap = (/** @type {any} */ (globalThis)).Zap || ((/** @type {any} */ (globalThis)).Zap = {});
