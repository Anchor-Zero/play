// @ts-check
// 생성됨: tools/sync-v2.js 가 design/ 에서 복사한 파일 — 직접 고치지 말 것(원본을 고친 뒤 다시 복사).
/*
 * 짭플렌더 v2 — 소리 (Zap.v2.sound)
 *
 * 소리 파일 없이 Web Audio 로 그 자리에서 만든다. 전체 방향은 '귀에 거슬리지 않게 부드럽게':
 * 높은 소리(4kHz 이상)를 걸러 내고, 첫 순간이 날카롭지 않게 몇 ms 에 걸쳐 올라오게 한다.
 *
 *   cardPick      카드를 누를 때(제자리 확대) 집어 드는 소리 — 살며시 올라와 짧게 감기듯. 후보 셋(고르는 중)
 *   cardSlide     카드가 옮겨 갈 때의 부드러운 미끄러짐(위로 쓸어 올리지 않는다)
 *   cardPlace     카드를 놓는 소리 — 확정: 다(짧고 단단한 '탁')
 *   cardDeal      덱에서 새 카드가 깔릴 때: cardPlace 와 같은 계열을 작게
 *   chipPlace     토큰을 놓는 소리(이동 중에는 소리 없음). 카드 놓기보다 작고 둥글게
 *   oppSelect     상대 정보를 누를 때 — 확정: 다(위로 휘는 '뽁')
 *   noblePick / nobleFanfare / noblePlace   귀족 타일 — 확정: 가(호른), 처음 후보보다 조금 약하게
 *   gameEnd       판 끝 — 마침 화음을 바탕으로 길고 웅장하게, '빠-밤'(메달이 내려앉는 순간)이 있다. 후보 셋(고르는 중)
 *   turn          내 차례 알림 — 부드럽고 약한 소리. 후보 셋(고르는 중)
 *
 * 확정된 묶음(FIXED)은 고를 수 없고, 고르는 중인 묶음만 choose(묶음, 후보)로 바꾼다. 고른 것은 판의 움직임에 바로 쓰인다.
 * 설정(켜기·음량)은 getSettings/setSettings 로 읽고 바꾸며, 바뀌면 저장하고 subscribe 한 곳에 알린다.
 * render(묶음, 후보)는 같은 합성 코드를 OfflineAudioContext 로 그려 돌려준다(시안 페이지가 길이·세기·높은 소리 비중을 재는 데 쓴다).
 * 브라우저는 첫 조작 전에 소리를 막으므로 첫 누름에서 소리 장치를 깨운다(unlock).
 */
(function () {
  Zap.v2 = Zap.v2 || {};
  const KEY = 'zap.v2.sound';
  /** @type {AudioContext|null} */
  let ctx = null;
  /** @type {GainNode|null} */
  let master = null;
  /** Young 이 들어 보고 확정한 것 (2026-10-29) */
  const FIXED = { cardPlace: 'c', oppSelect: 'c', noble: 'a', cardPick: 'a', turn: 'c', gameEnd: 'b' };
  /** 아직 고르는 중인 묶음과 기본 후보 */
  const OPEN_DEFAULT = {};  // 2026-10-29: 카드 집기 가, 내 차례 다, 판 끝 나 로 모두 확정
  const S = { on: true, volume: 0.7, /** @type {Record<string, string>} */ pick: Object.assign({}, OPEN_DEFAULT) };
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.on === 'boolean') S.on = saved.on;
    if (saved && typeof saved.volume === 'number') S.volume = Math.max(0, Math.min(1, saved.volume));
    // 고른 후보는 이번 후보 묶음(pick3)만 읽는다(앞선 후보의 이름과 섞이지 않게)
    if (saved && saved.pick3 && typeof saved.pick3 === 'object') for (const k of Object.keys(S.pick)) if (typeof saved.pick3[k] === 'string') S.pick[k] = saved.pick3[k];
  } catch (e) { /* 저장소를 못 쓰는 곳에서는 기본값 */ }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify({ on: S.on, volume: S.volume, pick3: S.pick })); } catch (e) { /* 무시 */ }
  }
  /** 설정이 바뀔 때 알릴 곳 @type {((s:{on:boolean, volume:number}) => void)[]} */
  const listeners = [];
  function changed() { for (const fn of listeners.slice()) { try { fn({ on: S.on, volume: S.volume }); } catch (e) { /* 무시 */ } } }

  /* ───────────── 합성 도구 ───────────── */

  /** @type {WeakMap<BaseAudioContext, AudioBuffer>} */
  const noiseBuf = new WeakMap();
  /** @param {BaseAudioContext} ac @returns {AudioBuffer} */
  function noiseOf(ac) {
    let b = noiseBuf.get(ac);
    if (!b) {
      const len = Math.floor(ac.sampleRate * 1.5);
      b = ac.createBuffer(1, len, ac.sampleRate);
      const d = b.getChannelData(0);
      let seed = 22222;
      for (let i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
      noiseBuf.set(ac, b);
    }
    return b;
  }

  /**
   * 한 소리를 만드는 동안 쓰는 도구 묶음. 모든 소리는 살짝 올라왔다(attack) 사그라든다(decay).
   * @param {BaseAudioContext} ac @param {AudioNode} out
   */
  function kit(ac, out) {
    let n = 0;
    const K = {
      ac, out,
      /** 높은 소리를 걸러 내는 출구 @param {number} cutoff @returns {AudioNode} */
      lp(cutoff) {
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.5;
        f.connect(out);
        return f;
      },
      /** @param {AudioNode} dst @param {number} t @param {number} peak @param {number} attack @param {number} decay @returns {GainNode} */
      env(dst, t, peak, attack, decay) {
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(Math.max(0.00002, peak), t + attack);
        g.gain.exponentialRampToValueAtTime(0.00002, t + attack + decay);
        g.gain.setValueAtTime(0, t + attack + decay + 0.001);
        g.connect(dst);
        return g;
      },
      /**
       * 걸러낸 잡음 한 토막
       * @param {AudioNode} dst @param {number} t @param {BiquadFilterType} type @param {number} freq @param {number} q
       * @param {number} peak @param {number} attack @param {number} decay @param {number} [freqTo]
       */
      noise(dst, t, type, freq, q, peak, attack, decay, freqTo) {
        const src = ac.createBufferSource();
        src.buffer = noiseOf(ac);
        const f = ac.createBiquadFilter();
        f.type = type; f.Q.value = q;
        f.frequency.setValueAtTime(freq, t);
        if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + attack + decay);
        src.connect(f); f.connect(K.env(dst, t, peak, attack, decay));
        n = (n + 0.137) % 1;
        src.start(t, n, attack + decay + 0.05);
        src.stop(t + attack + decay + 0.06);
      },
      /**
       * 음 하나
       * @param {AudioNode} dst @param {number} t @param {OscillatorType} type @param {number} f0 @param {number} f1 끝 음높이 @param {number} glide 음높이가 옮겨 가는 시간
       * @param {number} peak @param {number} attack @param {number} decay
       */
      tone(dst, t, type, f0, f1, glide, peak, attack, decay) {
        const o = ac.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + Math.max(0.005, glide));
        o.connect(K.env(dst, t, peak, attack, decay));
        o.start(t); o.stop(t + attack + decay + 0.03);
      },
      /** 길게 깔리는 음(천천히 올라와 머물다 빠짐) @param {AudioNode} dst @param {number} t @param {number} f @param {number} peak @param {number} attack @param {number} hold @param {number} release */
      pad(dst, t, f, peak, attack, hold, release) {
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + attack);
        g.gain.setValueAtTime(peak, t + attack + hold);
        g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
        g.connect(dst);
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g);
        const g2 = ac.createGain(); g2.gain.value = 0.28; g2.connect(g);
        const o2 = ac.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f; o2.detune.value = 5; o2.connect(g2);
        const end = t + attack + hold + release + 0.03;
        o.start(t); o.stop(end); o2.start(t); o2.stop(end);
      },
      /** 뜯는 현(류트·하프 느낌) @param {AudioNode} dst @param {number} t @param {number} f @param {number} peak @param {number} decay */
      pluck(dst, t, f, peak, decay) {
        K.tone(dst, t, 'triangle', f, f, 0, peak, 0.004, decay);
        K.tone(dst, t, 'sine', f * 2, f * 2, 0, peak * 0.3, 0.004, decay * 0.45);
        K.tone(dst, t, 'sine', f * 3, f * 3, 0, peak * 0.14, 0.003, decay * 0.22);
        K.tone(dst, t, 'sine', f * 4, f * 4, 0, peak * 0.08, 0.003, decay * 0.14);
        K.noise(dst, t, 'bandpass', 2300, 1, peak * 0.35, 0.002, 0.014);
      },
      /**
       * 금관 화음 한 음: 톱니파 두 개를 걸러 둥글게 만들고(높은 배음은 cutoff 위로 잘림), 천천히 올라와 머물다 빠진다
       * @param {AudioNode} dst @param {number} t @param {number} f @param {number} peak @param {number} attack @param {number} hold @param {number} release @param {number} cutoff
       */
      brass(dst, t, f, peak, attack, hold, release, cutoff) {
        const lpf = ac.createBiquadFilter(); lpf.type = 'lowpass'; lpf.Q.value = 0.6;
        lpf.frequency.setValueAtTime(cutoff * 0.45, t);
        lpf.frequency.linearRampToValueAtTime(cutoff, t + attack);
        lpf.frequency.linearRampToValueAtTime(cutoff * 0.6, t + attack + hold + release);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + attack);
        g.gain.setValueAtTime(peak, t + attack + hold);
        g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
        lpf.connect(g); g.connect(dst);
        const end = t + attack + hold + release + 0.03;
        for (const det of [-6, 5]) {
          const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
          o.connect(lpf); o.start(t); o.stop(end);
        }
      },
      /** 팀파니 한 번: 낮은 음이 살짝 내려가며 울리고 가죽 소리가 얹힌다 @param {AudioNode} dst @param {number} t @param {number} f @param {number} peak @param {number} decay */
      timp(dst, t, f, peak, decay) {
        K.tone(dst, t, 'sine', f * 1.12, f, 0.06, peak, 0.006, decay);
        K.tone(dst, t, 'sine', f * 1.5, f * 1.45, 0.05, peak * 0.25, 0.006, decay * 0.4);
        K.noise(dst, t, 'lowpass', 420, 0.7, peak * 0.5, 0.004, 0.09);
      },
      /** 낮은 울림이 차오른다(팀파니 롤 느낌): 걸러낸 잡음 + 낮은 음 @param {AudioNode} dst @param {number} t @param {number} len @param {number} peak @param {number} f */
      swell(dst, t, len, peak, f) {
        const src = ac.createBufferSource(); src.buffer = noiseOf(ac);
        const lpf = ac.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 240; lpf.Q.value = 0.8;
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.08);
        src.connect(lpf); lpf.connect(g); g.connect(dst);
        src.start(t, 0.1, len + 0.1); src.stop(t + len + 0.1);
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g2 = ac.createGain();
        g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(peak * 0.9, t + len); g2.gain.linearRampToValueAtTime(0, t + len + 0.1);
        o.connect(g2); g2.connect(dst); o.start(t); o.stop(t + len + 0.12);
      },
      /** 부드러운 종 @param {AudioNode} dst @param {number} t @param {number} f @param {number} peak @param {number} decay */
      bell(dst, t, f, peak, decay) {
        K.tone(dst, t, 'sine', f, f, 0, peak, 0.012, decay);
        K.tone(dst, t, 'sine', f * 2, f * 2, 0, peak * 0.14, 0.01, decay * 0.5);
        K.tone(dst, t, 'sine', f * 3.01, f * 3.01, 0, peak * 0.04, 0.008, decay * 0.3);
      },
    };
    return K;
  }
  /** @typedef {ReturnType<typeof kit>} Kit */

  /* ───────────── 카드 ───────────── */

  /**
   * 카드 집기 후보: 카드 놓기 '라'(부드럽게 퍼짐) 계열을 더 부드럽게. 첫 순간이 튀지 않게 살며시 올라와(10~30ms) 짧게 감겨 붙듯 끝난다.
   * @type {Record<string, (k:Kit, t:number, g:number) => void>}
   */
  const CARD_PICK = {
    /** 살며시: 걸러낸 숨소리 같은 잡음과 낮은 음이 함께 부풀었다 곧 닫힌다 */
    a(k, t, g) {
      const d = k.lp(2200);
      k.noise(d, t, 'lowpass', 1300, 0.6, g * 0.55, 0.016, 0.07, 620);
      k.tone(d, t + 0.004, 'sine', 210, 172, 0.06, g * 0.42, 0.014, 0.075);
    },
    /** 착 감기게: 위로 살짝 끌려 올라간 뒤 낮은 '착'으로 붙는다(두 토막) */
    b(k, t, g) {
      const d = k.lp(2600);
      k.noise(d, t, 'bandpass', 900, 0.8, g * 0.42, 0.024, 0.045, 1400);
      k.tone(d, t + 0.05, 'sine', 240, 180, 0.03, g * 0.5, 0.008, 0.05);
      k.noise(d, t + 0.05, 'lowpass', 700, 0.6, g * 0.3, 0.006, 0.035);
    },
    /** 포근하게: 거의 음으로만 된 낮고 둥근 '음'. 가장 낮고 오래 남는다 */
    c(k, t, g) {
      const d = k.lp(1500);
      k.tone(d, t, 'sine', 176, 150, 0.1, g * 0.6, 0.03, 0.11);
      k.tone(d, t, 'sine', 352, 300, 0.1, g * 0.12, 0.03, 0.06);
      k.noise(d, t, 'lowpass', 600, 0.6, g * 0.2, 0.03, 0.06);
    },
  };

  /** 옮겨 가는 소리: 낮게 깔리는 부드러운 스침. 서서히 커졌다 작아지고, 음색은 올라가지 않고 살짝 내려간다 @param {Kit} k @param {number} t @param {number} g */
  function cardSlide(k, t, g) {
    const ac = k.ac;
    const d = k.lp(2400);
    const src = ac.createBufferSource(); src.buffer = noiseOf(ac);
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(1150, t); f.frequency.linearRampToValueAtTime(780, t + 0.22);
    const e = ac.createGain();
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(g * 0.2, t + 0.08);
    e.gain.linearRampToValueAtTime(g * 0.14, t + 0.14);
    e.gain.linearRampToValueAtTime(0, t + 0.24);
    src.connect(f); f.connect(e); e.connect(d);
    src.start(t, 0.3, 0.3); src.stop(t + 0.3);
  }

  /** 카드 놓기 후보 @type {Record<string, (k:Kit, t:number, g:number) => void>} */
  const CARD_PLACE = {
    /** 둔하고 묵직한 쪽: 낮은 '툭'이 중심 */
    a(k, t, g) {
      const d = k.lp(2200);
      k.noise(d, t, 'lowpass', 760, 0.7, g * 0.8, 0.005, 0.07);
      k.tone(d, t, 'sine', 176, 104, 0.08, g * 0.8, 0.005, 0.11);
      k.tone(d, t, 'triangle', 352, 230, 0.06, g * 0.14, 0.004, 0.05);
    },
    /** 종이 질감이 살아 있는 쪽: 두 번 스치듯 '차락' */
    b(k, t, g) {
      const d = k.lp(5600);
      k.noise(d, t, 'bandpass', 2100, 0.7, g * 0.55, 0.003, 0.028);
      k.noise(d, t + 0.024, 'bandpass', 1700, 0.8, g * 0.4, 0.004, 0.045);
      k.tone(d, t + 0.02, 'sine', 180, 120, 0.05, g * 0.3, 0.004, 0.06);
    },
    /** 짧고 단단한 쪽: '탁' */
    c(k, t, g) {
      const d = k.lp(4200);
      k.noise(d, t, 'bandpass', 1250, 2.2, g * 1.0, 0.002, 0.026);
      k.tone(d, t, 'triangle', 260, 200, 0.02, g * 0.55, 0.002, 0.036);
    },
    /** 부드럽게 퍼지는 쪽: 천천히 올라와 길게 사그라드는 '스윽-툭' */
    d(k, t, g) {
      const d = k.lp(2800);
      k.noise(d, t, 'lowpass', 1500, 0.5, g * 0.5, 0.018, 0.17, 520);
      k.tone(d, t + 0.01, 'sine', 196, 130, 0.12, g * 0.42, 0.016, 0.17);
    },
  };

  /* ───────────── 토큰 ───────────── */

  /** 토큰 놓기: 작고 둥근 '도독'(한 번 더 작게 튄다) @param {Kit} k @param {number} t @param {number} g */
  function chipPlace(k, t, g) {
    const d = k.lp(3600);
    const hit = (/** @type {number} */ at, /** @type {number} */ a) => {
      k.noise(d, at, 'bandpass', 1650, 2.6, a * 0.42, 0.0028, 0.02);
      k.tone(d, at, 'sine', 920, 640, 0.015, a * 0.2, 0.0025, 0.022);
    };
    hit(t, g);
    hit(t + 0.036, g * 0.4);
  }

  /* ───────────── 상대 선택 ───────────── */

  /** @type {Record<string, (k:Kit, t:number, g:number) => void>} */
  const OPP_SELECT = {
    /** 낮게 떨어지는 둥근 '통' */
    a(k, t, g) {
      const d = k.lp(3500);
      k.tone(d, t, 'sine', 520, 392, 0.09, g * 0.9, 0.004, 0.16);
      k.tone(d, t, 'sine', 1040, 784, 0.09, g * 0.1, 0.004, 0.07);
    },
    /** 두 음이 올라가는 '또롱'(마림바 느낌) */
    b(k, t, g) {
      const d = k.lp(5000);
      const note = (/** @type {number} */ at, /** @type {number} */ f, /** @type {number} */ a) => {
        k.tone(d, at, 'sine', f, f, 0, a * 0.75, 0.003, 0.15);
        k.tone(d, at, 'sine', f * 3.9, f * 3.9, 0, a * 0.1, 0.002, 0.035);
      };
      note(t, 659.3, g); note(t + 0.07, 880, g * 0.9);
    },
    /** 위로 휘는 물방울 '뽁' */
    c(k, t, g) {
      const d = k.lp(4000);
      k.tone(d, t, 'sine', 360, 780, 0.07, g * 0.85, 0.006, 0.12);
    },
  };

  /* ───────────── 귀족 타일 ───────────── */

  /** 묵직한 타일 소리(카드보다 낮고 두껍다) @param {Kit} k @param {number} t @param {number} g @param {number} f0 @param {number} f1 @param {number} len */
  function tile(k, t, g, f0, f1, len) {
    const d = k.lp(1600);
    k.noise(d, t, 'lowpass', 680, 0.7, g * 0.7, 0.006, len * 0.6);
    k.tone(d, t, 'sine', f0, f1, len * 0.7, g * 0.8, 0.006, len);
    k.tone(d, t, 'triangle', f0 * 2.4, f1 * 2.4, len * 0.5, g * 0.34, 0.004, len * 0.5);
  }

  /** @type {Record<string, {pick:(k:Kit, t:number, g:number) => void, fanfare:(k:Kit, t:number, g:number) => void, place:(k:Kit, t:number, g:number) => void}>} */
  const NOBLE = {
    /** 멀리서 들리는 호른: 천천히 올라오는 세 음과 마침음 */
    a: {
      pick(k, t, g) { tile(k, t, g * 0.7, 150, 110, 0.09); },
      fanfare(k, t, g) {
        const d = k.lp(1500);
        k.pad(d, t, 261.6, g * 0.3, 0.05, 0.08, 0.1);
        k.pad(d, t + 0.17, 329.6, g * 0.3, 0.05, 0.08, 0.1);
        k.pad(d, t + 0.34, 392.0, g * 0.32, 0.05, 0.1, 0.12);
        k.pad(d, t + 0.55, 523.3, g * 0.34, 0.07, 0.3, 0.45);
        k.pad(d, t + 0.55, 329.6, g * 0.18, 0.09, 0.3, 0.45);
        k.pad(d, t + 0.55, 196.0, g * 0.16, 0.09, 0.3, 0.45);
      },
      place(k, t, g) { tile(k, t, g * 0.95, 96, 56, 0.15); },
    },
    /** 류트 아르페지오: 뜯는 현이 차례로 올라간다 */
    b: {
      pick(k, t, g) { const d = k.lp(2200); k.noise(d, t, 'bandpass', 420, 2.5, g * 0.7, 0.004, 0.05); k.tone(d, t, 'sine', 190, 150, 0.05, g * 0.5, 0.004, 0.07); },
      fanfare(k, t, g) {
        const d = k.lp(4600);
        const notes = [196.0, 261.6, 329.6, 392.0, 523.3];
        notes.forEach((f, i) => k.pluck(d, t + i * 0.095, f, g * (0.3 + i * 0.015), 0.5 + i * 0.06));
        k.pluck(d, t + 0.56, 659.3, g * 0.2, 0.8);
      },
      place(k, t, g) { const d = k.lp(1800); k.noise(d, t, 'bandpass', 360, 2.2, g * 0.8, 0.005, 0.07); k.tone(d, t, 'sine', 140, 88, 0.1, g * 0.75, 0.005, 0.13); },
    },
    /** 낮게 깔리는 화음과 종 하나 */
    c: {
      pick(k, t, g) { tile(k, t, g * 0.6, 120, 92, 0.12); },
      fanfare(k, t, g) {
        const d = k.lp(2000);
        k.pad(d, t, 261.6, g * 0.26, 0.18, 0.5, 0.6);
        k.pad(d, t + 0.04, 392.0, g * 0.2, 0.2, 0.46, 0.6);
        k.pad(d, t + 0.08, 659.3, g * 0.12, 0.22, 0.4, 0.6);
        k.bell(k.lp(4200), t + 0.3, 1046.5, g * 0.14, 1.0);
      },
      place(k, t, g) { tile(k, t, g * 0.8, 82, 50, 0.2); },
    },
  };

  /* ───────────── 판 끝 ─────────────
   * 확정된 '가'(마침 화음)를 바탕으로 길고 웅장하게. 세 후보 모두 같은 뼈대: 낮은 울림이 차오르고 →
   * '빠'(짧은 화음, BAM-0.22초) → '밤'(BAM 초, 큰 화음 + 팀파니. 승자 메달이 이 순간 내려앉는다) → 길게 남는 화음.
   * 귀를 찌르는 높은 소리를 피하려고 모두 2.4kHz 아래로 거른다. */

  /** '밤'의 시각(초). 메달 움직임이 이것에 맞춘다 */
  const BAM = 1.3;

  /** F 장조 → C 장조로 풀리는 화음 (마침 화음 '가'와 같은 길) */
  const CHORD_F = [87.3, 174.6, 220.0, 261.6, 349.2];
  const CHORD_C = [65.4, 130.8, 196.0, 261.6, 329.6, 392.0, 523.3];

  /** @type {Record<string, (k:Kit, t:number, g:number) => void>} */
  const GAME_END = {
    /** 금관 화음: 차오르는 울림 → 빠-밤 → 화음이 2초 남짓 남는다 */
    a(k, t, g) {
      const d = k.lp(2000);
      k.swell(d, t, BAM - 0.25, g * 0.3, 43.7);
      for (const f of CHORD_F.slice(1)) k.pad(d, t + 0.05, f, g * 0.07, 0.9, 0.1, 0.25);
      for (const f of CHORD_F) k.brass(d, t + BAM - 0.22, f, g * 0.11, 0.025, 0.07, 0.08, 1700);
      k.timp(d, t + BAM - 0.22, 87.3, g * 0.45, 0.25);
      for (const f of CHORD_C) k.brass(d, t + BAM, f, g * (f < 100 ? 0.16 : 0.1), 0.03, 0.75, 1.5, 1900);
      for (const f of [130.8, 196.0, 329.6]) k.pad(d, t + BAM, f, g * 0.09, 0.08, 1.0, 1.4);
      k.timp(d, t + BAM, 65.4, g * 0.75, 1.1);
    },
    /** 종과 화음: 같은 뼈대에 '밤'에서 낮게 거른 종 둘이 얹히고 가장 길게 남는다 */
    b(k, t, g) {
      const d = k.lp(2400);
      k.swell(d, t, BAM - 0.25, g * 0.24, 43.7);
      for (const f of CHORD_F.slice(1)) k.pad(d, t + 0.05, f, g * 0.08, 0.9, 0.1, 0.25);
      for (const f of CHORD_F.slice(1)) k.pad(d, t + BAM - 0.22, f, g * 0.12, 0.02, 0.07, 0.08);
      k.timp(d, t + BAM - 0.22, 87.3, g * 0.35, 0.25);
      for (const f of CHORD_C) k.pad(d, t + BAM, f, g * (f < 100 ? 0.2 : 0.11), 0.04, 1.0, 1.7);
      k.timp(d, t + BAM, 65.4, g * 0.6, 1.3);
      const bd = k.lp(1800);
      k.bell(bd, t + BAM, 523.3, g * 0.22, 2.2);
      k.bell(bd, t + BAM + 0.18, 784.0, g * 0.14, 2.0);
    },
    /** 북과 금관: 팀파니 롤이 세게 차오르고 '빠-밤'이 가장 또렷, 꼬리는 짧다 */
    c(k, t, g) {
      const d = k.lp(2400);
      for (let i = 0; i < 14; i++) k.timp(d, t + 0.08 + i * 0.075, 65.4, g * (0.08 + i * 0.022), 0.12);
      for (const f of CHORD_F) k.brass(d, t + BAM - 0.22, f, g * 0.14, 0.015, 0.08, 0.06, 2200);
      k.timp(d, t + BAM - 0.22, 87.3, g * 0.55, 0.2);
      for (const f of CHORD_C) k.brass(d, t + BAM, f, g * (f < 100 ? 0.18 : 0.12), 0.015, 0.45, 0.9, 2200);
      k.timp(d, t + BAM, 65.4, g * 0.85, 0.8);
    },
  };

  /** 내 차례 후보: 부드럽고 약하게 @type {Record<string, (k:Kit, t:number, g:number) => void>} */
  const TURN = {
    /** 낮은 종 하나: 한 음이 천천히 사그라든다 */
    a(k, t, g) {
      const d = k.lp(1800);
      k.tone(d, t, 'sine', 523.3, 523.3, 0, g * 0.5, 0.025, 1.0);
      k.tone(d, t, 'sine', 1046.5, 1046.5, 0, g * 0.05, 0.02, 0.4);
    },
    /** 두 음 숨결: 올라가는 두 음이 부드럽게 부풀었다 빠진다(때리는 순간이 없다) */
    b(k, t, g) {
      const d = k.lp(1600);
      k.pad(d, t, 392.0, g * 0.32, 0.07, 0.08, 0.35);
      k.pad(d, t + 0.16, 523.3, g * 0.3, 0.07, 0.12, 0.5);
    },
    /** 나무 울림: 마림바처럼 낮은 두 음, 짧고 둥글다 */
    c(k, t, g) {
      const d = k.lp(2400);
      const note = (/** @type {number} */ at, /** @type {number} */ f, /** @type {number} */ a) => {
        k.tone(d, at, 'sine', f, f, 0, a * 0.55, 0.008, 0.35);
        k.tone(d, at, 'sine', f * 4, f * 4, 0, a * 0.05, 0.004, 0.05);
      };
      note(t, 392.0, g); note(t + 0.13, 587.3, g * 0.9);
    },
  };

  /* ───────────── 목록 ───────────── */

  /**
   * 소리 고르기에 보일 목록. len = 오프라인으로 그릴 길이(초).
   * fixed 가 있으면 확정된 묶음(고를 수 없음), 없으면 고르는 중.
   * @type {{group:string, label:string, note:string, len:number, fixed?:string, variants:{id:string, label:string, desc:string}[]}[]}
   */
  const CATALOG = [
    { group: 'cardPick', label: '카드 집기', fixed: 'a', note: '확정', len: 0.4, variants: [
      { id: 'a', label: '가 · 살며시', desc: '숨소리 같은 잡음과 낮은 음이 함께 부풀었다 닫힘' },
    ] },
    { group: 'turn', label: '내 차례', fixed: 'c', note: '확정', len: 1.6, variants: [
      { id: 'c', label: '다 · 나무 울림', desc: '마림바처럼 낮은 두 음. 가장 짧음' },
    ] },
    { group: 'gameEnd', label: '판 끝', fixed: 'b', note: '확정. 빠-밤의 밤(' + BAM + '초)에 승자 메달이 내려앉습니다', len: 4.6, variants: [
      { id: 'b', label: '나 · 종과 화음', desc: '같은 뼈대에 낮게 거른 종 둘. 가장 김' },
    ] },
    { group: 'cardPlace', label: '카드 놓기', fixed: 'c', note: '확정', len: 0.5, variants: [{ id: 'c', label: '다 · 짧고 단단하게', desc: '탁' }] },
    { group: 'oppSelect', label: '상대 선택', fixed: 'c', note: '확정', len: 0.5, variants: [{ id: 'c', label: '다 · 뽁', desc: '위로 휘는 물방울' }] },
    { group: 'noble', label: '귀족 세트', fixed: 'a', note: '확정, 처음보다 조금 약하게. 수치는 팡파르만', len: 2.4, variants: [{ id: 'a', label: '가 · 호른', desc: '집기 → 팡파르 → 놓기' }] },
    { group: 'cardSlide', label: '카드 옮기기', fixed: 'a', note: '', len: 0.5, variants: [{ id: 'a', label: '하나', desc: '낮게 깔리는 스침' }] },
    { group: 'chipPlace', label: '토큰 놓기', fixed: 'a', note: '', len: 0.4, variants: [{ id: 'a', label: '하나', desc: '작고 둥근 도독' }] },
  ];

  /**
   * 소리마다의 세기(배수). OfflineAudioContext 로 재어 맞춘 값: 선택 소리가 가장 또렷하고(-11dBFS 안팎),
   * 카드 놓기 -12~-18, 토큰 놓기는 그보다 작게(-20), 길게 깔리는 소리(팡파르·판 끝·차례)는 -16~-20.
   * @type {Record<string, number>}
   */
  const LEVEL = {
    'cardPlace:a': 0.3, 'cardPlace:b': 0.72, 'cardPlace:c': 0.37, 'cardPlace:d': 0.27,
    'oppSelect:a': 0.27, 'oppSelect:b': 0.39, 'oppSelect:c': 0.33,
    // 귀족 가: 처음 후보보다 약 2dB 약하게(Young 평가 '음량을 살짝 약하게')
    'noblePick:a': 0.23, 'noblePick:b': 0.37, 'noblePick:c': 0.33,
    'nobleFanfare:a': 0.15, 'nobleFanfare:b': 0.33, 'nobleFanfare:c': 0.22,
    'noblePlace:a': 0.23, 'noblePlace:b': 0.29, 'noblePlace:c': 0.3,
    // 판 끝: 처음 '가'(-16dBFS)보다 웅장하되 크지 않게 -12~-14
    'gameEnd:a': 0.254, 'gameEnd:b': 0.188, 'gameEnd:c': 0.2,
    // 카드 집기: 앞의 것(-12dBFS, '너무 셈')보다 7~9dB 작게
    'cardPick:a': 0.221, 'cardPick:b': 0.204, 'cardPick:c': 0.146,
    // 내 차례: 앞의 것(-19dBFS, '너무 셈')보다 5~7dB 작게
    'turn:a': 0.099, 'turn:b': 0.079, 'turn:c': 0.112,
    'cardSlide:a': 0.385, 'chipPlace:a': 0.38,
  };
  /** @param {string} part @param {string} id */
  function lv(part, id) { return LEVEL[part + ':' + id] === undefined ? 1 : LEVEL[part + ':' + id]; }

  /** 귀족 세트를 이어 들려줄 때의 박자(초): 집기 → 팡파르 → 놓기 */
  const NOBLE_AT = { pick: 0, fanfare: 0.16, place: 1.55 };

  /**
   * 묶음·후보 하나를 주어진 문맥에 만든다(실제 재생과 오프라인 그리기가 같은 코드를 쓴다).
   * @param {Kit} k @param {number} t @param {string} group @param {string} id @param {number} g
   */
  function build(k, t, group, id, g) {
    if (group === 'cardPlace') (CARD_PLACE[id] || CARD_PLACE.a)(k, t, g * lv('cardPlace', id));
    else if (group === 'cardDeal') (CARD_PLACE[id] || CARD_PLACE.a)(k, t, g * lv('cardPlace', id) * 0.45);
    else if (group === 'oppSelect') (OPP_SELECT[id] || OPP_SELECT.a)(k, t, g * lv('oppSelect', id));
    else if (group === 'noble') { build(k, t + NOBLE_AT.pick, 'noblePick', id, g); build(k, t + NOBLE_AT.fanfare, 'nobleFanfare', id, g); build(k, t + NOBLE_AT.place, 'noblePlace', id, g); }
    else if (group === 'noblePick') (NOBLE[id] || NOBLE.a).pick(k, t, g * lv('noblePick', id));
    else if (group === 'nobleFanfare') (NOBLE[id] || NOBLE.a).fanfare(k, t, g * lv('nobleFanfare', id));
    else if (group === 'noblePlace') (NOBLE[id] || NOBLE.a).place(k, t, g * lv('noblePlace', id));
    else if (group === 'gameEnd') (GAME_END[id] || GAME_END.a)(k, t, g * lv('gameEnd', id));
    else if (group === 'cardPick') (CARD_PICK[id] || CARD_PICK.a)(k, t, g * lv('cardPick', id));
    else if (group === 'cardSlide') cardSlide(k, t, g * lv('cardSlide', 'a'));
    else if (group === 'chipPlace') chipPlace(k, t, g * lv('chipPlace', 'a'));
    else if (group === 'turn') (TURN[id] || TURN.a)(k, t, g * lv('turn', id));
  }

  /** 어느 묶음의 고른 후보를 쓰는지 @param {string} name @returns {string} */
  function pickedFor(name) {
    if (name === 'cardPlace' || name === 'cardDeal') return FIXED.cardPlace;
    if (name === 'oppSelect') return FIXED.oppSelect;
    if (name === 'noble' || name === 'noblePick' || name === 'nobleFanfare' || name === 'noblePlace') return FIXED.noble;
    if (name === 'gameEnd') return FIXED.gameEnd;
    if (name === 'cardPick') return FIXED.cardPick;
    if (name === 'turn') return FIXED.turn;
    return 'a';
  }

  /* ───────────── 재생 ───────────── */

  /** @returns {AudioContext|null} */
  function ensure() {
    if (ctx) return ctx;
    const AC = /** @type {any} */ (window).AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    const c = /** @type {AudioContext} */ (ctx);
    master = c.createGain();
    master.gain.value = S.on ? S.volume : 0;
    // 여러 소리가 겹칠 때만 눌러 주는 안전장치(평소 세기에서는 걸리지 않는다)
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 8; lim.attack.value = 0.003; lim.release.value = 0.15;
    master.connect(lim); lim.connect(c.destination);
    return ctx;
  }

  /**
   * 사람이 이 페이지를 한 번이라도 눌렀는지(그 전에는 소리 장치를 만들지 않는다: 브라우저가 경고를 남기고 장치를 잠가 둔다).
   * 이 문서의 pointerdown·keydown(아래 wake)이나 unlock() 으로만 켠다(navigator.userActivation 은 환경에 따라 처음부터 참이라 쓰지 않음).
   */
  let pressed = false;
  function hasPressed() { return pressed; }

  /** 첫 누름에서 부른다: 효과음이 켜져 있을 때만 소리 장치를 만들고 깨운다(꺼져 있으면 아무것도 만들지 않는다) */
  function unlock() {
    pressed = true;
    wakeCtx();
  }
  /** 효과음이 켜져 있으면 소리 장치를 만들고 깨운다 */
  function wakeCtx() {
    if (!S.on) return;
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }
  if (typeof document !== 'undefined') {
    const wake = () => { unlock(); };
    document.addEventListener('pointerdown', wake, { capture: true, passive: true });
    document.addEventListener('keydown', wake, { capture: true, passive: true });
  }

  /**
   * 소리 하나를 낸다.
   * @param {string} name  cardPick·cardSlide·cardPlace·cardDeal·chipPlace·oppSelect·noble·noblePick·nobleFanfare·noblePlace·gameEnd·turn
   * @param {{delay?:number, gain?:number, variant?:string}} [o]  delay: 몇 초 뒤에, gain: 세기 배수, variant: 고른 것 대신 이 후보로(들어 보기)
   */
  function play(name, o) {
    if (!S.on) return;
    // 아직 아무도 누르지 않았으면 소리 장치를 만들지 않고 건너뛴다(사건이 첫 누름보다 먼저 와도)
    if (!ctx && !hasPressed()) return;
    const c = ensure();
    if (!c || !master) return;
    if (c.state === 'suspended') { c.resume().catch(() => {}); }
    const opt = o || {};
    const t = c.currentTime + 0.012 + (opt.delay || 0);
    try { build(kit(c, master), t, name, opt.variant || pickedFor(name), opt.gain === undefined ? 1 : opt.gain); } catch (e) { /* 소리 때문에 판이 멈추면 안 된다 */ }
  }

  /**
   * 후보 하나를 오프라인으로 그린다(음량 100%, 안전장치 없이).
   * @param {string} group @param {string} id @returns {Promise<{data:Float32Array, rate:number}|null>}
   */
  function render(group, id) {
    const OAC = /** @type {any} */ (window).OfflineAudioContext || /** @type {any} */ (window).webkitOfflineAudioContext;
    const item = CATALOG.find((x) => x.group === group);
    if (!OAC) return Promise.resolve(null);
    const rate = 44100;
    try {
      const off = /** @type {OfflineAudioContext} */ (new OAC(1, Math.ceil(rate * (item ? item.len : 2)), rate));
      build(kit(off, off.destination), 0.02, group, id, 1);
      return off.startRendering().then((buf) => ({ data: buf.getChannelData(0), rate }), () => null);
    } catch (e) { return Promise.resolve(null); }
  }

  /** 고르는 중인 묶음의 후보를 바꾼다(확정된 묶음은 바꾸지 않음) @param {string} group @param {string} id */
  function choose(group, id) {
    if (!(group in S.pick)) return;
    S.pick[group] = id; save();
  }

  /** @returns {{on:boolean, volume:number}} */
  function getSettings() { return { on: S.on, volume: S.volume }; }
  /**
   * 소리 설정을 바꾸고 저장한다(저장소를 못 쓰면 이 화면에서만). 바뀌면 subscribe 한 곳에 알린다.
   * @param {{on?:boolean, volume?:number}} o
   */
  function setSettings(o) {
    if (!o) return;
    if (typeof o.on === 'boolean') { S.on = o.on; if (S.on && hasPressed()) wakeCtx(); }
    if (typeof o.volume === 'number' && isFinite(o.volume)) S.volume = Math.max(0, Math.min(1, o.volume));
    if (master && ctx) master.gain.setTargetAtTime(S.on ? S.volume : 0, ctx.currentTime, 0.02);
    save();
    changed();
  }
  /** @param {boolean} on */
  function setOn(on) { setSettings({ on: !!on }); }
  /** @param {number} v 0~1 */
  function setVolume(v) { setSettings({ volume: v }); }
  /** 설정이 바뀔 때 부를 함수를 단다. 돌려준 함수를 부르면 뗀다 @param {(s:{on:boolean, volume:number}) => void} fn @returns {() => void} */
  function subscribe(fn) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  Zap.v2.sound = {
    play, unlock, render, choose,
    getSettings, setSettings, subscribe, setOn, setVolume,
    catalog: CATALOG,
    nobleTiming: NOBLE_AT,
    /** 판 끝 소리의 '밤'(메달이 내려앉는 순간)이 소리 시작 뒤 몇 초인지 */
    gameEndBam: BAM,
    /** @param {string} group */
    chosen: (group) => pickedFor(group),
    isOn: () => S.on,
    volume: () => S.volume,
    /** 소리 장치가 깨어 있는지(첫 조작 뒤) */
    ready: () => !!ctx && ctx.state === 'running',
  };
})();
