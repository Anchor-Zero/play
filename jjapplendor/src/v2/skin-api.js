// @ts-check
// 생성됨: tools/sync-v2.js 가 design/ 에서 복사한 파일 — 직접 고치지 말 것(원본을 고친 뒤 다시 복사).
/*
 * 짭플렌더 v2 시안 — 그림 담당(스킨)과 판 담당(셸) 사이의 약속. 메인 소유, 고치지 말 것.
 *
 * 스킨 하나 = 방향 하나(판화풍 'engraving', 상감풍 'intarsia').
 * 각 스킨은 design/skins/<id>/skin.js 에서 Zap.skins[id] = {...} 로 자신을 등록하고, design/skins/<id>/skin.css 에 모양을 둔다.
 * 스킨의 CSS 규칙은 모두 `.skin-<id>` 아래에 두어 두 스킨이 한 페이지에 함께 있어도 섞이지 않게 한다.
 *
 * 크기: 스킨 함수가 돌려주는 요소의 크기는 부르는 쪽(셸)이 CSS 변수로 정한다.
 *   --card-w : 카드 폭(px). 카드 높이 = 폭 × 1.4. 폰 약 64~78px, PC 약 140~210px. 이 범위 전체에서 읽혀야 한다.
 *   --noble-w: 귀족 타일 폭. 높이 = 폭 × 1.15 (깃발 형식이라 세로로 조금 긴 편).
 *   칩·보석은 함수 인자 px 로 크기를 받는다.
 *   작은 크기에서 세부를 덜 그리는 처리는 스킨이 컨테이너 쿼리(@container)나 인자로 한다.
 *
 * 테마 값: 스킨 CSS 는 `.skin-<id>` 에 다음 CSS 변수를 정의해 셸이 패널·버튼·글자를 그 방향에 맞춰 칠할 수 있게 한다.
 *   --table (탁자 바탕: background 값 전체, 그라데이션·data URI 가능), --panel, --panel-edge, --ink, --ink-soft,
 *   --accent (금박·놋쇠 같은 강조), --accent-ink, --glow (내 차례 빛), --font-display, --font-number, --font-body
 *   채도 높은 색은 보석 색에만 쓴다(--accent 는 금속 느낌의 차분한 금빛·놋쇠빛).
 */

/** @typedef {'engraving'|'intarsia'|'wire'} SkinId */

/**
 * @typedef {Object} SkinAPI
 * @property {SkinId} id
 * @property {string} label                       화면에 보일 이름, 예: '판화풍'
 * @property {string} cssClass                    'skin-engraving' 등. 셸이 판 전체를 감싸는 요소에 붙인다
 * @property {string} fontCss                     글꼴 정의 CSS(data URI). 셸이 <style> 로 한 번 넣는다
 *
 * @property {(card:CardDef) => HTMLElement} card
 *   앞면 카드. 폭은 --card-w. 점수(틀 없는 큰 숫자, 0점이면 없음)·보석(숫자 없는 입체)·비용 칩(흰→파→초→빨→검)·삽화.
 *   요소에 data-card-id 속성. 손을 대면 들리는 효과는 스킨 CSS 의 :hover / .is-lifted 로.
 * @property {(tier:Tier, count:number) => HTMLElement} deck
 *   덱 더미. 남은 장수에 비례한 두께, 장수 숫자는 더미 위나 옆(작게 아니게). 0장이면 빈 자리 표시.
 * @property {(tier:Tier) => HTMLElement} cardBack
 *   카드 뒷면 한 장(남이 덱에서 예약한 카드 등). 단계 색 + 점.
 * @property {() => HTMLElement} emptySlot        공개 줄의 빈칸
 * @property {(noble:NobleDef) => HTMLElement} noble
 *   귀족 타일(곤팔로네 깃발 + 말머리형 방패 문장 + 관 등). 폭은 --noble-w. 점수 3, 조건은 모서리 둥근 사각형. data-noble-id.
 * @property {(color:TokenColor, px:number) => Element} gem
 *   보석 하나(황금은 플로린 금화). 빛 스침은 요소에 class 'is-glint' 를 붙이면 한 번 재생되게(셸이 가끔 붙였다 뗌).
 * @property {(color:Color, n:number, px:number) => HTMLElement} costChip
 *   카드 비용용 작은 칩(숫자 포함). 공급처 칩과 같은 생김새를 작게.
 * @property {(color:TokenColor, count:number, px:number) => HTMLElement} chipStack
 *   공급처·플레이어 토큰 더미. 칩이 count 에 맞춰 쌓인 높이(많으면 상한), 숫자는 칩 옆·아래(보석 무늬를 가리지 않음).
 *   count 0 이면 빈 자리(흐린 윤곽). px 는 칩 지름.
 * @property {(color:Color, n:number, px:number) => HTMLElement} bonusTile
 *   보너스(산 카드 수) 표시: 작은 카드 더미 모양(모서리 둥근 사각) + 숫자. 귀족 조건 사각형과 같은 계열의 모양.
 * @property {(n:number, px:number) => HTMLElement} pointsBadge
 *   플레이어 점수 표시(카드 점수와 같은 '틀 없는 큰 숫자' 계열).
 * @property {(o:{name:string, score:number, cards:number, shared:boolean, px:number}) => HTMLElement} medal
 *   판 끝의 승자 메달(2026-10-29 추가). 리본 달린 메달(또는 훈장) + 아래 이름판(이름·점수). px 는 메달 지름.
 *   shared 가 true 면 공동 승리(여러 개가 나란히 놓임). 이름은 한국어 최대 12자 — 이름판이 늘어나거나 글자가 줄어들어야 한다.
 *   내려앉는 움직임은 셸이 맡고, 스킨은 정지한 모습과 빛 스침('is-glint')만 맡는다.
 */

/** @typedef {Record<string, SkinAPI>} SkinRegistry */

(function () {
  const g = /** @type {any} */ (globalThis);
  g.Zap = g.Zap || {};
  g.Zap.skins = g.Zap.skins || {};
})();
