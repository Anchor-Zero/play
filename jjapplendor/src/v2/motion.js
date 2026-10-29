// @ts-check
// 생성됨: tools/sync-v2.js 가 design/ 에서 복사한 파일 — 직접 고치지 말 것(원본을 고친 뒤 다시 복사).
/*
 * 짭플렌더 v2 — 움직임 (Zap.v2.motion)
 *
 * 판이 한 화면 정보에서 다음 화면 정보로 넘어갈 때, 그 사이에 일어난 사건(GameEvent)을 물건의 움직임으로 보여 준다.
 *   토큰 가져오기 → 칩이 공급처에서 그 자리로 하나씩 미끄러짐 (닿을 때만 소리)
 *   카드 구매    → 낸 칩이 공급처로 돌아가고, 카드가 공개 줄에서 그 자리 보너스로 날아듦(미끄러지는 소리 → 놓는 소리), 덱에서 새 카드가 깔림
 *   예약        → 카드(덱이면 뒷면)가 그 자리로, 금화가 따라옴
 *   귀족 방문   → 깃발이 판 가운데로 나와 흔들린 뒤 그 자리로 내려앉음
 *   차례 시작   → 내 자리가 한 번 빛남
 *   판 끝      → 판이 어두워지고, 판 끝 소리의 '빠-밤'에 맞춰 승자 메달이 위에서 내려앉음(살짝 튀었다 자리 잡고 빛이 스침), 이어서 순위표
 * 그 밖에: 손(마우스)을 올린 카드가 살짝 기울고, 보석에 가끔 빛이 스친다(스킨 요소에 'is-glint' 를 붙였다 뗌).
 *
 * 방식: 먼저 옛 화면에서 물건들의 자리를 재고, 새 화면을 그린 뒤, 옛 자리에서 새 자리로 가는 '날아가는 사본'을
 * 판 위의 겹(.zb-fx)에 띄운다. 판 자체는 늘 새 상태를 바로 보여 주므로 움직임이 끊겨도 판은 틀리지 않는다.
 * 움직임 줄이기(설정 또는 시스템의 동작 줄이기)면 움직임 없이 소리만 낸다.
 * 설정: getReduced()/setReduced(b) 가 사용자의 '움직임 줄이기'(저장됨), reduced() 는 시스템 설정까지 합친 실제 값. subscribe(fn) 로 바뀜을 받는다.
 */
(function () {
  Zap.v2 = Zap.v2 || {};
  const KEY = 'zap.v2.motion';
  const S = { on: true };
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.on === 'boolean') S.on = saved.on;
  } catch (e) { /* 기본값 */ }
  /** @type {TokenColor[]} */
  const TOKENS = ['w', 'u', 'g', 'r', 'k', 'gold'];
  const EASE = 'cubic-bezier(.45,.05,.2,1)';

  /** @returns {boolean} 지금 움직임을 줄여야 하는지(사용자 설정 또는 시스템의 동작 줄이기) */
  function reduced() {
    if (!S.on) return true;
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  /** 바뀜을 받을 곳 @type {((reduce:boolean) => void)[]} */
  const listeners = [];
  /** @returns {boolean} 사용자가 '움직임 줄이기'를 켰는지 */
  function getReduced() { return !S.on; }
  /** '움직임 줄이기'를 켜고 끄고 저장한다. 떠 있는 판들의 늘 도는 움직임(빛 스침·단추 빛남)도 바로 따라 바뀐다 @param {boolean} reduce */
  function setReduced(reduce) {
    S.on = !reduce;
    try { window.localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ }
    if (typeof document !== 'undefined') document.querySelectorAll('.zb-frame').forEach((el) => el.classList.toggle('is-calm', !!reduce));
    for (const fn of listeners.slice()) { try { fn(!!reduce); } catch (e) { /* 무시 */ } }
  }
  /** @param {(reduce:boolean) => void} fn @returns {() => void} 떼는 함수 */
  function subscribe(fn) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }
  /** (예전 이름) 움직임 켜기 @param {boolean} on */
  function setOn(on) { setReduced(!on); }

  /** @typedef {{x:number, y:number, w:number, h:number}} Box */

  /** 틀이 축소(transform: scale)되어 있어도 맞게 재도록 틀 기준 좌표로 바꾼다 @param {any} inst */
  function measurer(inst) {
    const fr = inst.frame.getBoundingClientRect();
    const s = (fr.width / (inst.frame.offsetWidth || 1)) || 1;
    /** @param {Element} el @returns {Box} */
    return (el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - fr.left) / s, y: (r.top - fr.top) / s, w: r.width / s, h: r.height / s };
    };
  }

  /** 자리표가 붙은 요소들의 자리를 모두 잰다 @param {any} inst @returns {Map<string, Box & {slot:string}>} */
  function capture(inst) {
    const m = measurer(inst);
    /** @type {Map<string, Box & {slot:string}>} */
    const out = new Map();
    inst.root.querySelectorAll('[data-zb]').forEach((/** @type {Element} */ el) => {
      const key = /** @type {string} */ (el.getAttribute('data-zb'));
      if (out.has(key) || el.closest('.zb-veil')) return;
      out.set(key, Object.assign(m(el), { slot: el.getAttribute('data-slot') || '' }));
    });
    return out;
  }

  /** 지금 움직임을 재생하는 판이 소리를 내도 되는지 */
  let audible = true;
  /** @param {string} name @param {number} ms @param {any} [o] */
  function sfx(name, ms, o) {
    const snd = Zap.v2.sound;
    if (!audible) return;
    if (snd) snd.play(/** @type {any} */ (name), Object.assign({ delay: Math.max(0, ms) / 1000 }, o || {}));
  }

  /**
   * 사본 하나를 from 에서 to 로 날린다.
   * @param {any} inst @param {Element} node 날아갈 것 @param {number} nw 사본의 원래 폭 @param {number} nh 원래 높이
   * @param {Box} from @param {Box} to
   * @param {{delay?:number, dur?:number, fade?:boolean, lift?:number, arc?:number, vars?:Record<string,string>}} o
   * @returns {number} 끝나는 때(ms)
   */
  function fly(inst, node, nw, nh, from, to, o) {
    const delay = o.delay || 0; const dur = o.dur || 450;
    const el = document.createElement('div');
    el.className = 'zb-fly';
    el.style.width = nw + 'px'; el.style.height = nh + 'px';
    el.style.opacity = '0';
    if (o.vars) for (const k of Object.keys(o.vars)) el.style.setProperty(k, o.vars[k]);
    el.appendChild(node);
    inst.fx.appendChild(el);
    const s0 = from.w / nw; const s1 = to.w / nw;
    const x0 = from.x + from.w / 2 - nw * s0 / 2; const y0 = from.y + from.h / 2 - nh * s0 / 2;
    const x1 = to.x + to.w / 2 - nw * s1 / 2; const y1 = to.y + to.h / 2 - nh * s1 / 2;
    const lift = o.lift || 1.12;
    const sm = Math.max(s0, s1) * lift; const arc = o.arc === undefined ? Math.min(60, Math.hypot(x1 - x0, y1 - y0) * 0.12) : o.arc;
    const xm = (x0 + x1) / 2 + (nw * ((s0 + s1) / 2 - sm)) / 2; const ym = (y0 + y1) / 2 - arc + (nh * ((s0 + s1) / 2 - sm)) / 2;
    const a = el.animate([
      { transform: 'translate(' + x0 + 'px,' + y0 + 'px) scale(' + s0 + ')', opacity: 1, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.4))' },
      { transform: 'translate(' + xm + 'px,' + ym + 'px) scale(' + sm + ')', opacity: 1, filter: 'drop-shadow(0 14px 12px rgba(0,0,0,.45))', offset: 0.45 },
      { transform: 'translate(' + x1 + 'px,' + y1 + 'px) scale(' + s1 + ')', opacity: o.fade ? 0 : 1, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.4))' },
    ], { duration: dur, delay, easing: EASE, fill: 'forwards' });
    const done = () => el.remove();
    a.finished.then(done, done);
    return delay + dur;
  }

  /** 도착한 곳이 한 번 톡 튄다 @param {Element|null} el @param {number} delay */
  function pop(el, delay) {
    if (!el) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 280, delay, easing: 'ease-out' });
  }
  /** 사본이 닿을 때까지 진짜를 숨겨 둔다 @param {Element|null} el @param {number} until */
  function hideUntil(el, until) {
    if (!el) return;
    el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.999 }, { opacity: 1 }], { duration: Math.max(1, until), fill: 'backwards' });
  }

  /** @param {any} inst @param {string} key @returns {Element|null} */
  function find(inst, key) {
    return inst.root.querySelector('[data-zb="' + key + '"]');
  }

  /** 칩 더미 안에서 맨 위 칩의 가운데가 어디인지(스킨마다 숫자 자리가 달라서 잰다) @type {Map<string, {x:number, y:number}|null>} */
  const chipCenter = new Map();

  /**
   * 날아갈 칩 하나: 스킨의 칩 더미 1개짜리에서 맨 위 칩만 둥글게 오려 쓴다(개수 숫자는 날아가지 않게).
   * @param {any} inst @param {TokenColor} c @param {number} px @returns {{node:HTMLElement, w:number, h:number}}
   */
  function chipNode(inst, c, px) {
    const skin = /** @type {V2Skin} */ (inst.opts.skin);
    const node = document.createElement('div');
    node.className = 'zb-fly__chip';
    node.style.width = px + 'px'; node.style.height = px + 'px';
    const st = skin.chipStack(c, 1, px);
    node.appendChild(st);
    const key = skin.id + ':' + px;
    let at = chipCenter.get(key);
    if (at === undefined) {
      at = null;
      const sel = gemSelector(skin);
      node.style.visibility = 'hidden';
      inst.fx.appendChild(node);
      const gem = sel ? st.querySelector(sel) : null;
      if (gem) {
        const m = measurer(inst);
        const a = m(st); const g = m(gem);
        if (g.w > 0) at = { x: g.x + g.w / 2 - a.x, y: g.y + g.h / 2 - a.y };
      }
      node.remove();
      node.style.visibility = '';
      chipCenter.set(key, at);
    }
    if (at) {
      st.style.position = 'absolute';
      st.style.left = (px / 2 - at.x).toFixed(1) + 'px';
      st.style.top = (px / 2 - at.y).toFixed(1) + 'px';
      st.style.bottom = 'auto';
      node.style.clipPath = 'circle(' + (px * 0.56).toFixed(1) + 'px at 50% 50%)';
    }
    return { node, w: px, h: px };
  }

  /** 상자의 가운데에 놓인 정사각 @param {Box} b @param {number} size @param {'top'|'center'|'bottom'} [where] @returns {Box} */
  function spot(b, size, where) {
    const y = where === 'top' ? b.y : where === 'bottom' ? b.y + b.h - size : b.y + b.h / 2 - size / 2;
    return { x: b.x + b.w / 2 - size / 2, y, w: size, h: size };
  }

  /**
   * 칩 여러 개를 차례로 날린다.
   * @param {any} inst @param {TokenCounts} tokens @param {(c:TokenColor) => Box|undefined} fromOf @param {(c:TokenColor) => Box|undefined} toOf
   * @param {(c:TokenColor) => Element|null} landEl @param {number} t0 @returns {number} 끝나는 때
   */
  function flyChips(inst, tokens, fromOf, toOf, landEl, t0) {
    const Z = inst.Z; let i = 0; let end = t0;
    for (const c of TOKENS) {
      for (let k = 0; k < (tokens[c] || 0); k++) {
        const a = fromOf(c); const b = toOf(c);
        if (!a || !b) continue;
        const px = Math.round(Math.min(a.w, Z.supplyPx));
        const sizeB = Math.max(12, Math.min(b.w, b.h, px));
        const n = chipNode(inst, c, px);
        const delay = t0 + i * 95;
        const fin = fly(inst, n.node, n.w, n.h, spot(a, Math.min(a.w, px), 'top'), spot(b, sizeB, 'center'), { delay, dur: 430, lift: 1.1 });
        sfx('chipPlace', fin - 25);
        pop(landEl(c), fin - 40);
        end = Math.max(end, fin);
        i++;
      }
    }
    return end;
  }

  /** 덱에서 새 카드가 깔린다 @param {any} inst @param {Map<string, Box & {slot:string}>} before @param {string} slot 'tier:i' @param {number} delay */
  function deal(inst, before, slot, delay) {
    if (!slot) return;
    const el = inst.root.querySelector('.zb-tier [data-slot="' + slot + '"]');
    if (!el) return;
    const tier = slot.split(':')[0];
    const deck = before.get('deck:' + tier);
    const m = measurer(inst);
    const to = m(el);
    if (!deck) return;
    el.animate([
      { transform: 'translate(' + (deck.x - to.x) + 'px,' + (deck.y - to.y) + 'px) scale(.94)', opacity: 0 },
      { opacity: 1, offset: 0.12 },
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
    ], { duration: 400, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
    sfx('cardDeal', delay + 370);
  }

  /**
   * 화면 정보가 바뀌는 사이의 사건을 움직임으로.
   * @param {any} inst  판(BoardInst) @param {PlayerView} prev @param {PlayerView} view @param {GameEvent[]} events @param {() => void} draw 새 화면 그리기
   */
  function transition(inst, prev, view, events, draw) {
    audible = !inst.opts.mute;
    try { run(inst, prev, view, events, draw); } finally { audible = true; }
  }

  /** @param {any} inst @param {PlayerView} prev @param {PlayerView} view @param {GameEvent[]} events @param {() => void} draw */
  function run(inst, prev, view, events, draw) {
    inst.fx.replaceChildren();
    const myStart = view.you !== null && view.current === view.you && view.phase !== 'over' && (prev.current !== view.current);
    if (reduced()) {
      draw();
      let t = 0;
      for (const ev of events) {
        if (ev.type === 'take' || ev.type === 'return') sfx('chipPlace', t);
        else if (ev.type === 'buy' || ev.type === 'reserve') sfx('cardPlace', t);
        else if (ev.type === 'noble') { sfx('nobleFanfare', t); t += 900; }
        else if (ev.type === 'gameOver') sfx('gameEnd', t + 200);
        else continue;
        t += 200;
      }
      if (myStart) sfx('turn', t + 80);
      if (events.some((e) => e.type === 'gameOver')) resultDrop(inst, 0, false);
      return;
    }

    // 1) 옛 자리 재기 + 날아갈 사본 떠 두기
    const before = capture(inst);
    /** @type {Record<string, {node:Element, w:number, h:number}>} */
    const clones = {};
    for (const ev of events) {
      if ((ev.type === 'buy' || ev.type === 'reserve') && ev.cardId) {
        const holder = find(inst, 'card:' + ev.cardId) || findOppCard(inst, ev.cardId);
        const face = holder ? holder.querySelector('[data-card-id]') : null;
        if (face) {
          const w = parseFloat(getComputedStyle(face).getPropertyValue('--card-w')) || inst.Z.cardW;
          clones['card:' + ev.cardId] = { node: /** @type {Element} */ (face.cloneNode(true)), w, h: w * 1.4 };
          if (!before.has('card:' + ev.cardId) && holder) before.set('card:' + ev.cardId, Object.assign(measurer(inst)(holder), { slot: '' }));
        }
      } else if (ev.type === 'noble') {
        const holder = find(inst, 'noble:' + ev.nobleId);
        const face = holder ? holder.querySelector('[data-noble-id]') : null;
        if (face) {
          const w = parseFloat(getComputedStyle(face).getPropertyValue('--noble-w')) || inst.Z.nobleW;
          clones['noble:' + ev.nobleId] = { node: /** @type {Element} */ (face.cloneNode(true)), w, h: w * 1.15 };
        }
      }
    }

    // 2) 새 화면
    draw();
    const after = capture(inst);
    const Z = inst.Z;
    const skin = /** @type {V2Skin} */ (inst.opts.skin);

    // 3) 사건마다 움직임
    let t = 0;
    for (const ev of events) {
      if (ev.type === 'take') {
        t = flyChips(inst, ev.tokens, (c) => before.get('supply:' + c), (c) => after.get('tok:' + ev.seat + ':' + c), (c) => find(inst, 'tok:' + ev.seat + ':' + c), t) + 60;
      } else if (ev.type === 'return') {
        t = flyChips(inst, ev.tokens, (c) => before.get('tok:' + ev.seat + ':' + c), (c) => after.get('supply:' + c), (c) => find(inst, 'supply:' + c), t) + 60;
      } else if (ev.type === 'buy') {
        const def = Zap.data.cardsById[ev.cardId];
        const from = before.get('card:' + ev.cardId);
        const to = after.get('bon:' + ev.seat + ':' + def.bonus) || after.get('seat:' + ev.seat);
        const cl = clones['card:' + ev.cardId];
        const payEnd = flyChips(inst, ev.payment, (c) => before.get('tok:' + ev.seat + ':' + c), (c) => after.get('supply:' + c), (c) => find(inst, 'supply:' + c), t);
        const start = t + 140;
        let land = start;
        if (from && to && cl) {
          sfx('cardSlide', start + 40);
          land = fly(inst, cl.node, cl.w, cl.h, from, spot(to, Math.max(to.w, 14), 'center'), { delay: start, dur: 640, fade: false, lift: 1.14, vars: { '--card-w': cl.w + 'px' } });
          const tile = find(inst, 'bon:' + ev.seat + ':' + def.bonus);
          hideUntil(tile, land - 20);
          pop(tile, land - 20);
          if (def.points > 0) pop(find(inst, 'score:' + ev.seat), land + 40);
        }
        if (from && to && cl) sfx('cardPlace', land - 25); else sfx('cardPlace', t);
        if (from && from.slot) deal(inst, before, from.slot, start + 260);
        t = Math.max(payEnd, land) + 120;
      } else if (ev.type === 'reserve') {
        const mine = ev.cardId ? after.get('card:' + ev.cardId) : undefined;
        const res = find(inst, 'res:' + ev.seat);
        /** @type {Box|undefined} */
        let to = mine || after.get('res:' + ev.seat) || after.get('seat:' + ev.seat);
        // 그 자리의 예약 줄에서 마지막 카드 자리
        if (!mine && res && res.lastElementChild && view.you !== ev.seat) to = measurer(inst)(res.lastElementChild);
        if (!mine && view.you === ev.seat && res) {
          const minis = res.querySelectorAll('.zb-mini');
          if (minis.length) to = measurer(inst)(minis[minis.length - 1]);
        }
        /** @type {{node:Element, w:number, h:number}|undefined} */
        let cl; let from;
        if (ev.cardId) { cl = clones['card:' + ev.cardId]; from = before.get('card:' + ev.cardId); }
        else {
          from = before.get('deck:' + ev.tier);
          const w = from ? from.w : Z.cardW;
          cl = { node: skin.cardBack(ev.tier), w, h: w * 1.4 };
        }
        let land = t;
        if (from && to && cl) {
          sfx('cardSlide', t + 40);
          land = fly(inst, cl.node, cl.w, cl.h, from, to, { delay: t, dur: 560, lift: 1.1, vars: { '--card-w': cl.w + 'px' } });
          const target = ev.cardId && view.you === ev.seat ? find(inst, 'card:' + ev.cardId) : (res ? res.lastElementChild : null);
          hideUntil(target, land - 10);
          sfx('cardPlace', land - 25);
        }
        if (ev.gold) {
          const one = { w: 0, u: 0, g: 0, r: 0, k: 0, gold: 1 };
          land = Math.max(land, flyChips(inst, one, (c) => before.get('supply:' + c), (c) => after.get('tok:' + ev.seat + ':' + c), (c) => find(inst, 'tok:' + ev.seat + ':' + c), t + 220));
        }
        if (from && from.slot) deal(inst, before, from.slot, t + 300);
        t = land + 120;
      } else if (ev.type === 'noble') {
        const cl = clones['noble:' + ev.nobleId];
        const from = before.get('noble:' + ev.nobleId);
        const slotEl = find(inst, 'nob:' + ev.seat);
        /** @type {Box|undefined} */
        let to = after.get('nob:' + ev.seat) || after.get('seat:' + ev.seat);
        if (slotEl && slotEl.lastElementChild) to = measurer(inst)(slotEl.lastElementChild);
        sfx('noblePick', t);
        sfx('nobleFanfare', t + 160);
        if (cl && from && to) {
          const end = nobleVisit(inst, cl, from, to, t);
          sfx('noblePlace', end - 40);
          hideUntil(slotEl ? slotEl.lastElementChild : null, end - 20);
          pop(find(inst, 'score:' + ev.seat), end);
          t = end + 150;
        } else t += 900;
      } else if (ev.type === 'gameOver') {
        resultDrop(inst, t + 150, true);
      }
    }
    if (myStart) turnStart(inst, t + 60);
  }

  /** 남이 공개 예약한 카드(작게 보이는 것)를 찾는다 @param {any} inst @param {string} cardId @returns {Element|null} */
  function findOppCard(inst, cardId) {
    const face = inst.root.querySelector('.zb-opp [data-card-id="' + cardId + '"]');
    return face ? face.closest('.zb-mini') : null;
  }

  /** 귀족 깃발: 판 가운데로 나와 흔들리고, 받은 자리로 내려앉는다 @returns {number} 끝나는 때 */
  function nobleVisit(/** @type {any} */ inst, /** @type {{node:Element, w:number, h:number}} */ cl, /** @type {Box} */ from, /** @type {Box} */ to, /** @type {number} */ t0) {
    const W = inst.frame.offsetWidth; const H = inst.frame.offsetHeight; const Z = inst.Z;
    const big = Math.min(Z.cardW * 1.9, W * 0.42, H * 0.36);
    const market = inst.root.querySelector('.zb-market');
    const mb = market ? measurer(inst)(market) : { x: 0, y: 0, w: W, h: H };
    const cx = mb.x + mb.w / 2; const cy = mb.y + mb.h / 2;
    const nw = cl.w; const nh = cl.h;
    const s0 = from.w / nw; const sB = big / nw; const s1 = to.w / nw;
    /** @param {number} x @param {number} y @param {number} s @param {number} rot */
    const at = (x, y, s, rot) => 'translate(' + (x - nw * s / 2) + 'px,' + (y - nh * s / 2) + 'px) scale(' + s + ') rotate(' + rot + 'deg)';
    const el = document.createElement('div');
    el.className = 'zb-fly zb-fly--noble';
    el.style.width = nw + 'px'; el.style.height = nh + 'px'; el.style.opacity = '0';
    el.style.setProperty('--noble-w', nw + 'px');
    el.style.transformOrigin = '0 0';
    el.appendChild(cl.node);
    const halo = document.createElement('div');
    halo.className = 'zb-fly zb-halo';
    const hs = big * 2.6;
    halo.style.width = hs + 'px'; halo.style.height = hs + 'px';
    halo.style.transform = 'translate(' + (cx - hs / 2) + 'px,' + (cy - hs / 2) + 'px)';
    const dim = document.createElement('div');
    dim.className = 'zb-fly zb-dim';
    inst.fx.appendChild(dim);
    inst.fx.appendChild(halo);
    inst.fx.appendChild(el);
    const dur = 1900;
    dim.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.68 }, { opacity: 0 }], { duration: dur * 0.9, delay: t0, easing: 'ease-in-out', fill: 'both' }).finished.then(() => dim.remove(), () => dim.remove());
    halo.animate([{ opacity: 0 }, { opacity: 0.85, offset: 0.3 }, { opacity: 0.7, offset: 0.68 }, { opacity: 0 }], { duration: dur * 0.86, delay: t0, easing: 'ease-in-out', fill: 'both' }).finished.then(() => halo.remove(), () => halo.remove());
    const fx0 = from.x + from.w / 2; const fy0 = from.y + from.h / 2;
    const tx = to.x + to.w / 2; const ty = to.y + to.h / 2;
    const a = el.animate([
      { transform: at(fx0, fy0, s0, 0), opacity: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.4))', easing: 'cubic-bezier(.3,.6,.2,1)' },
      { transform: at(cx, cy - big * 0.14, sB * 1.04, -4), opacity: 1, filter: 'drop-shadow(0 26px 22px rgba(0,0,0,.5))', offset: 0.27, easing: 'ease-in-out' },
      { transform: at(cx, cy + big * 0.03, sB, 3), offset: 0.4, easing: 'ease-in-out' },
      { transform: at(cx, cy, sB, -1.5), offset: 0.52, easing: 'ease-in-out' },
      { transform: at(cx, cy, sB, 0), filter: 'drop-shadow(0 26px 22px rgba(0,0,0,.5))', offset: 0.7, easing: 'cubic-bezier(.5,0,.3,1)' },
      { transform: at(tx, ty, s1, 0), opacity: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.4))' },
    ], { duration: dur, delay: t0, fill: 'forwards' });
    a.finished.then(() => el.remove(), () => el.remove());
    return t0 + dur;
  }

  /**
   * 판 끝: 판 끝 소리를 t0 에 내고, 소리의 '밤'(sound.gameEndBam 초 뒤)에 승자 메달이 위에서 내려와 닿게 한다.
   * 닿은 뒤 살짝 튀었다 자리 잡고 빛이 스치며, 이어서 순위표가 나타난다. 움직임 줄이기면 바로 제자리(소리만).
   * 결과 덮개(.zb-veil--result)는 판이 이미 그려 둔 것을 움직인다.
   * @param {any} inst @param {number} t0 소리 시작(ms 뒤) @param {boolean} withSound
   */
  function resultDrop(inst, t0, withSound) {
    const snd = Zap.v2.sound;
    const bam = t0 + ((snd && snd.gameEndBam) || 1.3) * 1000;
    if (withSound) sfx('gameEnd', t0);
    const veil = /** @type {HTMLElement|null} */ (inst.root.querySelector('.zb-veil--result'));
    if (!veil) return;
    veil.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    if (reduced()) {
      setTimeout(() => glintMedals(veil), Math.max(0, bam - t0));
      return;
    }
    const H = inst.frame.offsetHeight;
    const fall = 760; const hit = 0.66;
    veil.animate([{ backgroundColor: 'rgba(8,6,4,0)' }, { backgroundColor: 'rgba(8,6,4,.8)' }], { duration: 520, delay: t0, easing: 'ease-out', fill: 'backwards' });
    const medals = veil.querySelectorAll('.zb-result__medal');
    medals.forEach((el) => {
      const r = el.getBoundingClientRect(); const fr = inst.frame.getBoundingClientRect();
      const sc = (fr.width / (inst.frame.offsetWidth || 1)) || 1;
      const up = (r.bottom - fr.top) / sc + 30;
      el.animate([
        { transform: 'translateY(' + (-up) + 'px) rotate(-4deg)', easing: 'cubic-bezier(.55,0,.9,.4)' },
        { transform: 'translateY(0) rotate(0deg)', offset: hit, easing: 'cubic-bezier(.2,.6,.4,1)' },
        { transform: 'translateY(-7%) rotate(.8deg)', offset: hit + 0.14, easing: 'cubic-bezier(.5,0,.6,1)' },
        { transform: 'translateY(0) rotate(0deg)' },
      ], { duration: fall, delay: bam - fall * hit, fill: 'backwards' });
    });
    const halo = veil.querySelector('.zb-result__halo');
    if (halo) halo.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 0.9, transform: 'scale(1.08)', offset: 0.25 }, { opacity: 0.3, transform: 'scale(1)' }], { duration: 1100, delay: bam - 40, easing: 'ease-out', fill: 'backwards' });
    const board = veil.querySelector('.zb-result__board');
    if (board) board.animate([{ opacity: 0, transform: 'translateY(' + Math.round(H * 0.03) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: bam + 380, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'backwards' });
    setTimeout(() => glintMedals(veil), Math.max(0, bam + 160));
  }

  /** 메달에 빛이 한 번 스친다(스킨이 'is-glint' 로 맡음) @param {Element} veil */
  function glintMedals(veil) {
    veil.querySelectorAll('.zb-result__medal').forEach((el) => {
      const m = el.firstElementChild;
      if (!m) return;
      const target = m.classList.contains('zb-medal-fallback') && m.firstElementChild ? m.firstElementChild : m;
      target.classList.remove('is-glint');
      void (/** @type {any} */ (target)).getBoundingClientRect();
      target.classList.add('is-glint');
      setTimeout(() => target.classList.remove('is-glint'), 1800);
    });
  }

  /** 내 차례 시작: 내 자리가 한 번 빛나고 종이 울린다 @param {any} inst @param {number} delay */
  function turnStart(inst, delay) {
    if (!inst.opts.mute) sfx('turn', delay);
    if (reduced()) return;
    setTimeout(() => {
      const tray = inst.root.querySelector('.zb-tray');
      if (!tray) return;
      tray.classList.remove('is-turnstart');
      void (/** @type {HTMLElement} */ (tray)).offsetWidth;
      tray.classList.add('is-turnstart');
      setTimeout(() => tray.classList.remove('is-turnstart'), 1500);
    }, Math.max(0, delay));
  }

  /* ───────────── 늘 도는 것: 빛 스침, 기울기 ───────────── */

  /** @type {WeakMap<object, {timer:any, off:() => void}>} */
  const LIVE = new WeakMap();
  /** @type {Record<string, string>} */
  const gemSel = {};

  /** 스킨이 보석에 붙이는 class 를 알아낸다(gem() 이 돌려준 요소의 첫 class) @param {V2Skin} skin @returns {string} */
  function gemSelector(skin) {
    if (gemSel[skin.id] === undefined) {
      let sel = '';
      try {
        const probe = skin.gem('r', 16);
        const c = probe.classList && probe.classList[0];
        if (c) sel = '.' + c;
      } catch (e) { sel = ''; }
      gemSel[skin.id] = sel;
    }
    return gemSel[skin.id];
  }

  /** 보석 한두 개에 빛이 스친다 @param {any} inst */
  function glint(inst) {
    const sel = gemSelector(inst.opts.skin);
    if (!sel) return;
    /** @type {Element[]} */
    const all = Array.from(inst.root.querySelectorAll('.zb-market ' + sel + ', .zb-supply ' + sel + ', .zb-hold ' + sel));
    const pool = all.filter((el) => !el.closest('.is-zero') && !el.closest('.is-empty'));
    if (!pool.length) return;
    const n = Math.random() < 0.3 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const el = pool[Math.floor(Math.random() * pool.length)];
      el.classList.remove('is-glint');
      void (/** @type {any} */ (el)).getBoundingClientRect();
      el.classList.add('is-glint');
      setTimeout(() => el.classList.remove('is-glint'), 1600);
    }
  }

  /** 판에 늘 도는 움직임을 건다(한 번만) @param {any} inst */
  function attach(inst) {
    if (LIVE.has(inst)) return;
    const live = { timer: 0, off: () => {} };
    const tick = () => {
      if (!inst.frame.isConnected) { detach(inst); return; }
      if (!reduced() && !document.hidden && !inst.frame.classList.contains('is-calm')) glint(inst);
      live.timer = setTimeout(tick, 1900 + Math.random() * 2600);
    };
    live.timer = setTimeout(tick, 1200 + Math.random() * 1500);
    /** @type {HTMLElement|null} */
    let tilted = null;
    const clear = () => { if (tilted) { tilted.style.removeProperty('--rx'); tilted.style.removeProperty('--ry'); tilted = null; } };
    /** @param {PointerEvent} e */
    const move = (e) => {
      if (e.pointerType !== 'mouse' || reduced()) { clear(); return; }
      const t = /** @type {Element} */ (e.target);
      const card = /** @type {HTMLElement|null} */ (t && t.closest ? t.closest('.zb-tier .zb-card, .zb-tier .zb-deckbtn') : null);
      if (card !== tilted) clear();
      if (!card) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5; const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', (px * 9).toFixed(2) + 'deg');
      card.style.setProperty('--rx', (-py * 7).toFixed(2) + 'deg');
      tilted = card;
    };
    inst.frame.addEventListener('pointermove', move, { passive: true });
    inst.frame.addEventListener('pointerleave', clear, { passive: true });
    live.off = () => { inst.frame.removeEventListener('pointermove', move); inst.frame.removeEventListener('pointerleave', clear); clear(); };
    LIVE.set(inst, live);
  }

  /** @param {any} inst */
  function detach(inst) {
    const live = LIVE.get(inst);
    if (!live) return;
    clearTimeout(live.timer);
    live.off();
    LIVE.delete(inst);
  }

  Zap.v2.motion = { transition, attach, detach, glint, turnStart, resultDrop, reduced, getReduced, setReduced, subscribe, setOn, isOn: () => S.on };
})();
