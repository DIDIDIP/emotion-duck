// 체험판: 로봇 없이 링크만으로 열어 볼 수 있게, 서버(server.py)가 하던 일을 브라우저 안에서 흉내 낸다.
// GitHub Pages(…github.io)에서 열거나 주소에 ?demo 를 붙이면 켜진다. 로봇에서 실행할 때는 아무것도 하지 않는다.
// 규칙과 숫자는 emotion.py · game.py · roommap.py · robotgames.py 와 같게 맞췄다.
(() => {
  const DEMO = /github\.io$/.test(location.hostname) || new URLSearchParams(location.search).has("demo");
  if (!DEMO) return;

  const now = () => Date.now() / 1000;
  const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
  const today = () => new Date().toLocaleDateString("sv");
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const STOP = Symbol("stop");

  // ---------- 실시간 연결 흉내 (EventSource 대신) ----------
  const listeners = new Set();
  function broadcast(msg) {
    const data = JSON.stringify(msg);
    listeners.forEach((es) => setTimeout(() => es.onmessage?.({ data }), 0));
  }
  class FakeEventSource {
    constructor() {
      listeners.add(this);
      this._extra = [];
      setTimeout(() => {
        this.onopen?.();
        for (const m of [{ type: "state", state: engine.state(), pet: pet.snapshot() }, { type: "home", home: home.info() },
          { type: "map", map: room.info() }, { type: "ball", ball: ball.info() }, { type: "rgame", rgame: games.status }]) {
          this.onmessage?.({ data: JSON.stringify(m) });
        }
      }, 50);
    }
    addEventListener(type, fn) { if (type === "message") this._extra.push(fn); }
    close() { listeners.delete(this); }
  }
  // addEventListener 로 붙인 것도 받도록
  Object.defineProperty(FakeEventSource.prototype, "onmessage", {
    get() { return (e) => { this._on?.(e); this._extra?.forEach((f) => f(e)); }; },
    set(fn) { this._on = fn; },
  });
  window.EventSource = FakeEventSource;

  // =====================================================================
  // 감정 엔진 (emotion.py)
  // =====================================================================
  const EVENTS = {
    goal: [0.7, 0.8, 0.05, "celebrate", "골이다! 꽥꽥!"], homerun: [0.8, 0.9, 0.05, "celebrate", "홈런! 넘어갔다!"],
    wave: [0.3, 0.3, 0.03, "greet", "안녕! 반가워"], pet: [0.4, -0.2, 0.06, "content", "쓰담쓰담 💕"],
    thumbs_up: [0.4, 0.3, 0.03, "proud", "칭찬 고마워!"], play: [0.5, 0.6, 0.04, "excited", "놀자 놀자!"],
    snack: [0.5, 0.4, 0.04, "excited", "냠냠! 맛있다 🍪"], sleep_now: [0, -0.8, 0.02, "sleep", "잘 자… Zzz"],
    wake: [0.1, 0.3, 0, "greet", "하암~ 잘 잤다!"], rps_win: [0.5, 0.5, 0.02, "celebrate", "내가 이겼다!"],
    rps_lose: [-0.3, 0.3, 0.03, "frustrated", "으앗, 졌다! 한 판 더?"], rps_draw: [0.1, 0.3, 0.02, "excited", "비겼다! 다시 해!"],
    level_up: [0.7, 0.6, 0.05, "celebrate", "레벨 업!"], game_great: [0.7, 0.5, 0.05, "celebrate", "최고야!"],
    game_good: [0.4, 0.3, 0.03, "proud", "재밌었다!"], game_try: [0.2, 0, 0.02, "content", "괜찮아, 즐거웠어!"],
    affection_up: [0.8, 0.5, 0.06, "celebrate", "우리 더 친해졌어!"], hello: [0.3, 0.2, 0.02, "greet", "안녕!"],
    dress_up: [0.4, 0.3, 0.02, "proud", "어때? 잘 어울려?"],
    trick_show: [0.5, 0.5, 0.02, "excited", "짠~ 개인기!"], trick_praised: [0.5, 0.3, 0.03, "proud", "칭찬 받았다!"],
    trick_learned: [0.8, 0.5, 0.06, "celebrate", "개인기를 배웠어!"], trick_confused: [-0.1, 0.4, 0, null, "헷갈려…"],
    trick_unpraised: [-0.2, -0.1, 0, null, "다시 연습해 볼게"], too_tired: [-0.1, -0.4, 0, null, "너무 졸려… 재워 줘"],
    lonely: [-0.3, -0.1, 0, "sad", "심심해… 놀아 줘"],
    map_scan: [0.1, 0.4, 0, null, "방을 한 바퀴 둘러볼게! 빙글빙글~"], map_scanned: [0.4, 0.2, 0.02, "proud", "다 봤어! 지도에서 갈 곳을 골라 줘"],
    map_go: [0.2, 0.4, 0, null, "거기로 갈게!"], map_arrived: [0.5, 0, 0.03, "content", "도착! 여기 맞지?"],
    map_blocked: [-0.3, 0.5, 0, "startle", "앗, 앞에 뭐가 있어!"],
    ball_search: [0.2, 0.5, 0, null, "공 어디 있지? 킁킁"], ball_found: [0.4, 0.5, 0, null, "공 발견! 간다~"],
    ball_arrived: [0.5, 0.3, 0.02, null, "잡았다! ⚽"], ball_failed: [-0.3, 0.2, 0, null, "공을 못 찾겠어…"],
    home_search: [0.1, 0.3, 0, null, "집이 어디 있더라… 두리번두리번"], home_found: [0.3, 0.3, 0, null, "찾았다! 저기가 우리 집이야"],
    home_arrived: [0.5, -0.3, 0.03, "content", "집에 도착! 역시 집이 최고야"], home_failed: [-0.4, 0.2, 0, "frustrated", "집을 못 찾겠어… 도와줄래?"],
  };
  const MOOD_LABELS = [[0.8, 0.7, "joy", "신남"], [0.6, -0.4, "content", "편안"], [0.1, 0.8, "surprised", "놀람"],
    [-0.6, 0.6, "angry", "속상"], [-0.7, -0.4, "sad", "슬픔"], [0, -0.8, "sleepy", "졸림"], [0, 0, "neutral", "보통"]];
  const engine = {
    valence: 0.1, arousal: 0, bond: 0.3, last: now(), asleep: false, history: [],
    feel(event, source = "앱", speech = null) {
      const e = EVENTS[event];
      if (!e) throw new Error(`모르는 사건: ${event}`);
      const [dv, da, db, reaction, sp] = e;
      speech = speech || sp;
      if (this.asleep) speech = "하암… 깼다! " + speech;
      this.asleep = false;
      this.valence = clamp(this.valence + dv * (1 - Math.abs(this.valence) * 0.5));
      this.arousal = clamp(this.arousal + da * (1 - Math.abs(this.arousal) * 0.5));
      this.bond = clamp(this.bond + db, 0, 1);
      if (dv > 0) this.valence = clamp(this.valence + 0.15 * this.bond * dv);
      this.last = now();
      this.history.push({ t: this.last, event, source, speech });
      this.history = this.history.slice(-50);
      broadcast({ type: "feel", state: this.state(), reaction, speech, pet: pet.snapshot() });
    },
    tick(dt) {
      const idle = now() - this.last, k = Math.exp(-Math.log(2) * dt / 20);
      const ba = idle > 60 ? -0.6 : 0;
      this.valence = 0.1 + (this.valence - 0.1) * k;
      this.arousal = ba + (this.arousal - ba) * k;
      if (idle > 180 && !this.asleep) this.asleep = true;
    },
    label() {
      const b = MOOD_LABELS.reduce((a, l) => ((l[0] - this.valence) ** 2 + (l[1] - this.arousal) ** 2 < (a[0] - this.valence) ** 2 + (a[1] - this.arousal) ** 2 ? l : a));
      return [b[2], b[3]];
    },
    state() {
      const [face, label] = this.asleep ? ["sleepy", "잠듦"] : this.label();
      return { valence: +this.valence.toFixed(3), arousal: +this.arousal.toFixed(3), bond: +this.bond.toFixed(3),
        face, label, asleep: this.asleep, history: this.history.slice(-10) };
    },
  };

  // =====================================================================
  // 키우기 (game.py)
  // =====================================================================
  const UNLOCK = { rps: 5, come: 7 };
  const XP_BOOST = 3;   // 체험판은 금방 레벨이 오르도록 경험치 3배
  const EFFECTS = { pet: [4, 0, 3], snack: [15, 10, 15], rps: [6, -8, 10], come: [5, -15, 20], wake: [0, 0, 10],
    gesture: [3, 0, 3], scan: [3, -10, 15], goto: [4, -8, 10], minigame: [6, -5, 14], trick: [4, -3, 8] };
  // 개인기 훈련 (tricks.py)
  const NEED = 3, PRAISE_SECS = 6, MAX_CUSTOM = 6;
  const TRICK_MOVES = { beep: ["삐!", "🔔"], bow: ["꾸벅", "🙇"], spin: ["빙글", "🌀"], back: ["뒤로", "⬇️"],
    forward: ["앞으로", "⬆️"], left: ["왼쪽 돌기", "⬅️"], right: ["오른쪽 돌기", "➡️"], wiggle: ["흔들기", "〰️"] };
  const TRICKS = { bow: ["꾸벅 인사", "🙇", ["bow", "beep"]], spin: ["빙글 돌기", "🌀", ["spin", "beep"]],
    dance: ["신나는 춤", "💃", ["left", "right", "wiggle", "bow", "beep"]], wiggle: ["엉덩이 흔들기", "🐕", ["wiggle", "wiggle", "beep"]] };
  const MOVE_SECS = { beep: 0.5, bow: 1.2, spin: 1.4, back: 0.6, forward: 0.6, left: 0.7, right: 0.7, wiggle: 1.0 };
  const GAMES = { mugunghwa: "무궁화 꽃이 피었습니다", dance: "따라 춤추기", fetch: "공 찾아오기" };
  const HANDS = { rock: "✊ 바위", scissors: "✌️ 가위", paper: "🖐 보" };
  const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };
  const FACE_FROM_MOOD = { joy: "happy", content: "smile", surprised: "surprised", angry: "angry", sad: "sad", sleepy: "sleepy", neutral: "normal" };
  const FACES = { love: ["🥰", "사랑"], happy: ["😆", "신남"], smile: ["😊", "기분 좋음"], normal: ["🙂", "보통"], sad: ["😢", "슬픔"],
    angry: ["😤", "속상"], surprised: ["😲", "놀람"], sleepy: ["😪", "졸림"], sleep: ["💤", "쿨쿨"], tired: ["🥱", "피곤"], yum: ["😋", "냠냠"] };
  const TITLES = [[0, "낯가림"], [15, "아는 사이"], [35, "친구"], [55, "단짝"], [75, "베프"], [92, "소울메이트"]];
  const HELLO = { "낯가림": "어… 안녕? 아직 조금 낯설어", "아는 사이": "안녕! 또 왔네?", "친구": "왔구나! 오늘 뭐 하고 놀까?",
    "단짝": "보고 싶었어! 💕", "베프": "기다리고 있었어! 오늘도 같이 놀자 💕", "소울메이트": "너만 기다렸어! 세상에서 제일 좋아 💖" };
  const ITEMS = {
    led: [["white", "하얀 빛", 1], ["mint", "민트 빛", 2], ["pink", "분홍 빛", 3], ["yellow", "햇살 빛", 6], ["rainbow", "무지개 빛", 10]],
    body: [["charcoal", "차콜", 1], ["cream", "크림", 2], ["sky", "하늘", 4], ["berry", "딸기", 5], ["gold", "황금", 9]],
    hat: [["none", "없음", 1], ["ribbon", "리본", 2], ["cap", "모자", 3], ["flower", "꽃핀", 4], ["headphones", "헤드폰", 5], ["crown", "왕관", 8]],
    cheek: [["none", "없음", 1], ["blush", "발그레", 3], ["sparkle", "반짝반짝", 7]],
    theme: [["default", "기본", 1], ["sakura", "벚꽃", 4], ["night", "밤하늘", 6], ["ocean", "바다", 8]],
  };
  const SLOT_NAMES = { led: "화면 빛", body: "몸 색", hat: "머리 장식", cheek: "볼", theme: "배경" };
  const DEFAULT_LOOK = Object.fromEntries(Object.entries(ITEMS).map(([k, v]) => [k, v[0][0]]));
  const eul = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? "을" : "를"); };
  const iya = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? "이야" : "야"); };
  function titleOf(a) {
    let i = 0;
    TITLES.forEach(([at], k) => { if (a >= at) i = k; });
    const nxt = TITLES[i + 1];
    return { title: TITLES[i][1], tier: i, at: TITLES[i][0], next_title: nxt ? nxt[1] : null, next_at: nxt ? nxt[0] : null };
  }
  const SAVE = "emotion-duck-demo";

  const pet = {
    s: null, faceHold: null, rpsUntil: 0, lastGesture: null, lastPet: 0, lastLonely: 0, lastHello: 0, acc: { happy: 0, energy: 0 },
    load() {
      const base = { name: "오리", level: 1, xp: 0, happy: 70, energy: 80, sleeping: false, day: today(), snacks_today: 0,
        affection: 5, game_plays: {}, best: {}, hello_day: null, look: { ...DEFAULT_LOOK }, new_items: [], tricks: {}, custom: [] };
      try { Object.assign(base, JSON.parse(localStorage.getItem(SAVE) || "{}")); } catch {}
      base.look = { ...DEFAULT_LOOK, ...base.look };
      this.s = base;
    },
    save() { try { localStorage.setItem(SAVE, JSON.stringify(this.s)); } catch {} },
    newDay() { if (this.s.day !== today()) { this.s.day = today(); this.s.snacks_today = 0; this.s.game_plays = {}; } },
    face() {
      if (this.s.sleeping) return "sleep";
      if (this.faceHold && now() < this.faceHold[1]) return this.faceHold[0];
      const st = engine.state();
      if (st.asleep) return "sleep";
      if (this.s.energy < 15) return "tired";
      const f = FACE_FROM_MOOD[st.face] || "normal";
      if (f === "normal" && this.s.happy >= 80) return "smile";
      if (f === "normal" && this.s.happy < 30) return "sad";
      return f;
    },
    snapshot() {
      const s = this.s;
      this.newDay();
      const face = this.face();
      return {
        name: s.name, level: s.level, xp: s.xp, xp_next: 20 * s.level, happy: Math.round(s.happy), energy: Math.round(s.energy),
        sleeping: s.sleeping, snacks_left: 3 - s.snacks_today, unlock: UNLOCK, face, emoji: FACES[face][0], label: FACES[face][1],
        rps_open: now() < this.rpsUntil && !s.sleeping, gesture: this.lastGesture,
        affection: Math.round(s.affection), ...titleOf(s.affection), look: s.look,
        closet: Object.entries(ITEMS).flatMap(([slot, items]) => items.map(([id, name, level]) => ({
          slot, id, name, level, unlocked: s.level >= level, new: s.new_items.includes(`${slot}:${id}`) }))),
        slot_names: SLOT_NAMES,
        games: Object.fromEntries(Object.entries(GAMES).map(([g, n]) => [g, { name: n, left: Math.max(0, 3 - (s.game_plays[g] || 0)), best: s.best[g] || 0 }])),
        tricks: Object.entries(TRICKS).map(([id, [name, icon]]) => ({ id, name, icon, progress: s.tricks[id] || 0, learned: (s.tricks[id] || 0) >= NEED })),
        custom: { moves: s.custom, progress: s.tricks.custom || 0, learned: s.custom.length > 0 && (s.tricks.custom || 0) >= NEED },
        moves: Object.entries(TRICK_MOVES).map(([id, [name, icon]]) => ({ id, name, icon })),
        trick: { ...trainer.status },
      };
    },
    hold(face) { this.faceHold = [face, now() + 4]; },
    apply(action, scale = 1) {
      const [dh, de, xp] = EFFECTS[action], s = this.s;
      s.happy = clamp(s.happy + Math.round(dh * scale), 0, 100);
      s.energy = clamp(s.energy + de, 0, 100);
      s.xp += Math.round(xp * scale) * XP_BOOST;
      while (s.xp >= 20 * s.level) {
        s.xp -= 20 * s.level;
        s.level += 1;
        const opened = Object.entries(UNLOCK).filter(([, lv]) => lv === s.level).map(([k]) => ({ rps: "가위바위보", come: "이리 와" })[k]);
        const gifts = Object.entries(ITEMS).flatMap(([slot, items]) => items.filter(([, , lv]) => lv === s.level).map(([id, n]) => [slot, id, n]));
        s.new_items.push(...gifts.map(([slot, id]) => `${slot}:${id}`));
        let extra = opened.length ? ` ${opened[0]}가 열렸어!` : "";
        if (gifts.length) extra += ` 선물로 ${gifts.map((g) => g[2]).join(", ")}도 받았어 🎁`;
        engine.feel("level_up", "게임", `레벨 업! 이제 Lv${s.level}이야!${extra}`);
      }
    },
    res(ok, message, extra = {}) { return { ok, message, ...extra }; },
    refuseTired() { this.hold("tired"); engine.feel("too_tired"); return this.res(false, "에너지가 부족해요. 먼저 재워 주세요"); },
    act(action, p = {}) {
      if (action === "hello") { const r = this.hello(); this.save(); return r; }
      if (this.s.sleeping && !["pet", "wake", "sleep", "rename", "equip", "seen_items", "custom_save"].includes(action)) {
        return this.res(false, "쿨쿨 자는 중이에요. 화면을 눌러 깨워 주세요");
      }
      const fn = this["do_" + action];
      if (!fn) throw new Error(`모르는 행동: ${action}`);
      const r = fn.call(this, p);
      this.save();
      broadcast({ type: "pet", pet: this.snapshot() });
      return r;
    },
    do_pet() {
      if (this.s.sleeping) return this.do_wake();
      if (now() - this.lastPet < 2) { this.hold("love"); return this.res(true, null); }
      this.lastPet = now();
      this.apply("pet"); this.hold("love"); engine.feel("pet");
      return this.res(true, "쓰담쓰담 💕");
    },
    do_snack() {
      if (this.s.snacks_today >= 3) {
        this.hold("sad"); engine.feel("lonely", "앱", "오늘 간식은 다 먹었어… 내일 또 줘!");
        return this.res(false, "오늘 간식은 다 먹었어요");
      }
      this.s.snacks_today++; this.apply("snack"); this.hold("yum"); engine.feel("snack");
      return this.res(true, "냠냠! 맛있다 🍪");
    },
    do_sleep() {
      if (this.s.sleeping) return this.do_wake();
      this.s.sleeping = true; this.faceHold = null; this.rpsUntil = 0;
      engine.feel("sleep_now");
      return this.res(true, "잘 자… Zzz");
    },
    do_wake() {
      this.s.sleeping = false;
      const rested = this.s.energy >= 90;
      this.apply(rested ? "wake" : "gesture"); this.hold(rested ? "happy" : "sleepy");
      engine.feel("wake", "앱", rested ? null : "음냐… 아직 졸린데…");
      return this.res(true, rested ? "하암~ 잘 잤다!" : "음냐… 아직 졸린데…");
    },
    do_rps({ hand } = {}) {
      if (this.s.level < UNLOCK.rps) return this.res(false, `가위바위보는 Lv${UNLOCK.rps}에 열려요`);
      if (this.s.energy < 15) return this.refuseTired();
      if (!hand) { this.rpsUntil = now() + 10; engine.feel("play", "앱", "가위바위보! 손을 보여 줘 ✊✌️🖐"); return this.res(true, "손을 보여 주세요"); }
      this.rpsUntil = 0;
      const mine = pick(Object.keys(HANDS));
      const [event, face, outcome] = mine === hand ? ["rps_draw", "surprised", "draw"] : BEATS[mine] === hand ? ["rps_win", "happy", "robot"] : ["rps_lose", "sad", "user"];
      const speech = { draw: `나도 ${HANDS[mine]}! 비겼다!`, robot: `나는 ${HANDS[mine]}! 내가 이겼다!`, user: `나는 ${HANDS[mine]}… 졌다! 한 판 더?` }[outcome];
      this.apply("rps"); this.s.affection = Math.min(100, this.s.affection + 1); this.hold(face);
      engine.feel(event, "가위바위보", speech);
      return this.res(true, speech, { robot: mine, outcome });
    },
    do_come() {
      if (this.s.level < UNLOCK.come) return this.res(false, `이리 와는 Lv${UNLOCK.come}에 열려요`);
      if (this.s.energy < 15) return this.refuseTired();
      if (!home.info().registered) {
        engine.feel("lonely", "앱", "어디로 가야 할지 모르겠어. 카메라 화면에서 집을 알려 줘!");
        return this.res(false, "카메라 화면에서 집을 먼저 등록해 주세요", { need_home: true });
      }
      home.go(); this.apply("come");
      return this.res(true, "지금 갈게!");
    },
    do_scan() { if (this.s.energy < 15) return this.refuseTired(); room.scan(); this.apply("scan"); return this.res(true, "방을 둘러볼게!"); },
    do_goto({ x, y }) { if (this.s.energy < 15) return this.refuseTired(); room.goTo(x, y); this.apply("goto"); return this.res(true, "거기로 갈게!"); },
    do_play({ game }) {
      if (!GAMES[game]) throw new Error("모르는 놀이");
      if (this.s.energy < 15) return this.refuseTired();
      games.start(game);
      return this.res(true, null);
    },
    do_minigame({ game, score, max_score }) {
      if (this.s.energy < 15) return this.refuseTired();
      const ratio = clamp(score / Math.max(1, max_score), 0, 1);
      const plays = this.s.game_plays[game] || 0, rewarded = plays < 3;
      this.s.game_plays[game] = plays + 1;
      const newBest = score > (this.s.best[game] || 0);
      if (newBest) this.s.best[game] = score;
      const gain = rewarded ? Math.round(1 + 5 * ratio) : 0;
      const before = titleOf(this.s.affection).tier;
      this.s.affection = Math.min(100, this.s.affection + gain);
      this.apply("minigame", 0.4 + 0.6 * ratio);
      let [event, face, speech] = ratio >= 0.8 ? ["game_great", "love", "최고야! 우리 진짜 잘 맞는다 💕"]
        : ratio >= 0.4 ? ["game_good", "happy", "재밌었다! 또 하자!"] : ["game_try", "smile", "괜찮아, 같이 해서 즐거웠어!"];
      if (gain) speech += ` (호감도 +${gain})`;
      this.hold(face); engine.feel(event, GAMES[game], speech);
      const after = titleOf(this.s.affection);
      if (after.tier > before) engine.feel("affection_up", "호감도", `우리 이제 ${iya(after.title)}! 💖`);
      return this.res(true, speech, { gain, rewarded, new_best: newBest, title_up: after.tier > before ? after.title : null });
    },
    hello() {
      if (this.s.sleeping || now() - this.lastHello < 600) return this.res(true, null);
      this.lastHello = now();
      const first = this.s.hello_day !== today();
      let speech = HELLO[titleOf(this.s.affection).title];
      if (first) { this.s.hello_day = today(); this.s.affection = Math.min(100, this.s.affection + 2); speech += " (오늘 첫 방문 호감도 +2)"; }
      this.hold(this.s.affection >= 55 ? "love" : "happy");
      engine.feel("hello", "앱", speech);
      return this.res(true, speech);
    },
    do_equip({ slot, item }) {
      const it = (ITEMS[slot] || []).find(([id]) => id === item);
      if (!it) throw new Error("없는 아이템");
      if (this.s.level < it[2]) return this.res(false, `Lv${it[2]}에 열려요`);
      this.s.look[slot] = item;
      this.s.new_items = this.s.new_items.filter((k) => k !== `${slot}:${item}`);
      this.hold("love");
      engine.feel("dress_up", "꾸미기", ["none", "default"].includes(item) ? "원래대로!" : "어때? 잘 어울려? 💕");
      return this.res(true, null, { item: it[1] });
    },
    do_seen_items() { this.s.new_items = []; return this.res(true, null); },
    do_rename({ name }) {
      name = String(name || "").trim().slice(0, 10);
      if (!name) throw new Error("이름을 입력해 주세요");
      this.s.name = name; this.hold("love");
      engine.feel("thumbs_up", "앱", `내 이름은 ${name}! 마음에 들어 💕`);
      return this.res(true, null);
    },
    do_gesture({ name }) {
      this.lastGesture = name;
      if (name === "thumbs_up") trainer.praise();
      return this.res(true, null);
    },
    trickDef(id) {
      if (id === "custom") return ["나만의 개인기", [...this.s.custom]];
      if (!TRICKS[id]) throw new Error("모르는 개인기");
      return [TRICKS[id][0], TRICKS[id][2]];
    },
    do_trick({ id, mode = "practice" }) {
      const [name, moves] = this.trickDef(id);
      const progress = this.s.tricks[id] || 0;
      if (mode === "show" && progress < NEED) return this.res(false, "아직 못 배웠어요. 먼저 연습시켜 주세요");
      if (this.s.energy < 15) return this.refuseTired();
      trainer.start(id, name, moves, mode, Math.min(0.95, 0.6 + 0.15 * progress));
      return this.res(true, null);
    },
    do_trick_praise() { const ok = trainer.praise(); return this.res(ok, ok ? null : "지금은 칭찬할 때가 아니에요"); },
    do_custom_save({ moves }) {
      moves = (moves || []).filter((m) => TRICK_MOVES[m]).slice(0, MAX_CUSTOM);
      if (JSON.stringify(moves) !== JSON.stringify(this.s.custom)) { this.s.custom = moves; this.s.tricks.custom = 0; }
      engine.feel("thumbs_up", "나만의 개인기", moves.length ? "새 개인기 저장! 연습시켜 줘 🎬" : "나만의 개인기를 비웠어요");
      return this.res(true, null);
    },
    trickResult(id, mode, praised, clumsy) {
      const [name] = this.trickDef(id);
      if (mode === "show") { this.apply("gesture"); this.hold("happy"); engine.feel("trick_show", "개인기", `${name} 어땠어? 😎`); }
      else if (praised && !clumsy) {
        const n = (this.s.tricks[id] || 0) + 1;
        this.s.tricks[id] = n;
        this.apply("trick");
        if (n === NEED) {
          this.s.affection = Math.min(100, this.s.affection + 3); this.hold("love");
          engine.feel("trick_learned", "개인기", `${eul(name)} 배웠어! 이제 언제든 보여 줄게 💡 (호감도 +3)`);
        } else { this.hold("happy"); engine.feel("trick_praised", "개인기", `칭찬 받았다! (${Math.min(n, NEED)}/${NEED}) 😊`); }
      } else if (praised && clumsy) { this.hold("surprised"); engine.feel("trick_confused", "개인기", "어… 방금 건 어설펐는데? 헷갈려 🤔"); }
      else { this.hold("sad"); engine.feel("trick_unpraised", "개인기", "음… 다시 연습해 볼게"); }
      this.save();
      broadcast({ type: "pet", pet: this.snapshot() });
    },
    tick(dt) {
      const s = this.s, a = this.acc;
      if (s.sleeping) {
        a.energy += dt / 2;
        if (s.energy >= 100) { s.energy = 100; this.do_wake(); }
      } else a.energy -= dt / 180;
      a.happy -= dt / 90;
      for (const k of ["happy", "energy"]) {
        if (Math.abs(a[k]) >= 1) { const st = Math.trunc(a[k]); s[k] = clamp(s[k] + st, 0, 100); a[k] -= st; }
      }
      if (s.happy < 30 && !s.sleeping && now() - this.lastLonely > 120) { this.lastLonely = now(); engine.feel("lonely", "혼자"); }
      this.save();
    },
  };

  // =====================================================================
  // 가상의 방과 카메라 (roommap.py 흉내 모드)
  // =====================================================================
  const CAM = { hfov: 62, vfov: 48, height: 11, tilt: 12 };
  const ROOM = [-150, 250, -100, 200];
  const FURN = [[[120, 120], 40, [200, 120, 90]], [[-110, 160], 30, [90, 140, 60]], [[180, -60], 25, [60, 160, 40]]];
  const wrap = (a) => ((a + 180) % 360 + 360) % 360 - 180;
  const rad = (d) => (d * Math.PI) / 180;
  function hits(x, y, bearing) {
    const dx = -Math.sin(rad(bearing)), dy = Math.cos(rad(bearing));
    let wall = 1e9;
    [[ROOM[0], "x"], [ROOM[1], "x"], [ROOM[2], "y"], [ROOM[3], "y"]].forEach(([w, ax]) => {
      const d = ax === "x" ? dx : dy;
      if (Math.abs(d) > 1e-6) { const k = (w - (ax === "x" ? x : y)) / d; if (k > 0) wall = Math.min(wall, k); }
    });
    let furn = null, color = null;
    for (const [[cx, cy], r, col] of FURN) {
      const fx = cx - x, fy = cy - y, proj = fx * dx + fy * dy, perp = Math.abs(fx * dy - fy * dx);
      if (proj > 0 && perp < r) { const k = proj - Math.sqrt(r * r - perp * perp); if (k < wall && (furn === null || k < furn)) { furn = k; color = col; } }
    }
    return [wall, furn, color];
  }
  const ray = (x, y, b) => { const [w, f] = hits(x, y, b); return f ?? w; };
  const canvas = document.createElement("canvas");
  canvas.width = 320; canvas.height = 240;
  const cx2d = canvas.getContext("2d");
  function render(x, y, heading, extra) {
    const W = 320, H = 240, row = (down) => Math.round((0.5 + (down - CAM.tilt) / CAM.vfov) * H);
    for (let c = 0; c < W; c += 2) {
      const b = heading - ((c + 1) / W - 0.5) * CAM.hfov;
      const [wall, furn, color] = hits(x, y, b);
      const base = row((Math.atan(CAM.height / wall) * 180) / Math.PI), sh = Math.max(0.55, 1 - wall / 900);
      cx2d.fillStyle = `rgb(${240 * sh},${228 * sh},${215 * sh})`; cx2d.fillRect(c, 0, 2, H);
      const g = cx2d.createLinearGradient(0, base, 0, H);
      g.addColorStop(0, "rgb(185,150,120)"); g.addColorStop(1, "rgb(210,180,160)");
      cx2d.fillStyle = g; cx2d.fillRect(c, Math.max(0, base), 2, H);
      if (furn !== null) {
        const top = row((-Math.atan((70 - CAM.height) / furn) * 180) / Math.PI), bot = row((Math.atan(CAM.height / furn) * 180) / Math.PI);
        const k = Math.max(0.6, 1 - furn / 600);
        cx2d.fillStyle = `rgb(${color[0] * k},${color[1] * k},${color[2] * k})`; cx2d.fillRect(c, Math.max(0, top), 2, Math.min(H, bot) - Math.max(0, top));
      }
    }
    if (extra) extra(cx2d);
    cx2d.fillStyle = "rgba(60,60,60,.8)"; cx2d.font = "12px sans-serif"; cx2d.fillText(`체험판 · ${Math.round(wrap(heading))}°`, 8, 16);
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  // ---------- 방 지도 ----------
  const room = {
    frames: [], photos: [], pose: { x: 0, y: 0, heading: 0 }, target: null, scannedAt: 0, token: 0,
    status: { state: "empty", message: "아직 방을 스캔하지 않았어요", progress: 0 },
    info() {
      return { ...this.status, simulated: true, pose: { ...this.pose }, target: this.target,
        frames: this.frames.map((f, i) => ({ i, heading: f.heading, dist: f.dist, open: f.open, photo: true })),
        camera: CAM, max_range: 300, margin: 20, scanned_at: this.scannedAt };
    },
    set(state, message, progress) {
      this.status = { state, message, progress: progress ?? this.status.progress };
      broadcast({ type: "map", map: this.info() });
    },
    busy() { return ["scanning", "turning", "moving"].includes(this.status.state); },
    scan() {
      if (this.busy() || games.busy()) throw new Error("지금 다른 곳으로 움직이는 중이에요");
      this._scan();
    },
    async _scan() {
      const tok = ++this.token;
      engine.feel("map_scan", "방 지도");
      const frames = [], photos = [];
      for (let k = 0; k < 12; k++) {
        await wait(350);
        if (tok !== this.token) return this.set(this.frames.length ? "ready" : "empty", "스캔을 멈췄어요");
        const h = k * 30, d = ray(0, 0, h);
        frames.push({ heading: h, dist: d > 300 ? null : Math.round(d), open: d > 300 });
        photos.push(render(0, 0, h));
        this.set("scanning", `방 둘러보는 중… ${h}° (체험판)`, h / 360);
      }
      Object.assign(this, { frames, photos, pose: { x: 0, y: 0, heading: 0 }, target: null, scannedAt: Math.floor(now()) });
      this.set("ready", `스캔 완료! 사진 ${frames.length}장 · 지도를 눌러 갈 곳을 고르세요`, 1);
      engine.feel("map_scanned", "방 지도");
    },
    goTo(x, y) {
      if (!this.frames.length) throw new Error("먼저 방을 스캔해 주세요");
      if (this.busy() || games.busy()) throw new Error("지금 다른 곳으로 움직이는 중이에요");
      this._goTo(x, y);
    },
    async _goTo(x, y) {
      this.target = { x: Math.round(x), y: Math.round(y) };
      const tok = ++this.token, p = this.pose;
      const bearing = (Math.atan2(-(x - p.x), y - p.y) * 180) / Math.PI, dist = Math.hypot(x - p.x, y - p.y);
      engine.feel("map_go", "방 지도");
      const start = p.heading, diff = wrap(bearing - start);
      for (let k = 1; k <= 8; k++) {
        await wait(80);
        if (tok !== this.token) return this.set("ready", "멈췄어요");
        p.heading = wrap(start + (diff * k) / 8);
        this.set("turning", "방향 맞추는 중", 0.1);
      }
      const x0 = p.x, y0 = p.y;
      let done = 0;
      while (done < dist) {
        await wait(100);
        if (tok !== this.token) return this.set("ready", "멈췄어요");
        done = Math.min(dist, done + 5);
        if (ray(p.x, p.y, bearing) < 18) { engine.feel("map_blocked", "방 지도"); return this.set("blocked", "앞에 뭔가 있어서 멈췄어요", done / dist); }
        p.x = x0 - done * Math.sin(rad(bearing)); p.y = y0 + done * Math.cos(rad(bearing));
        this.set("moving", `가는 중… ${Math.round(dist - done)}cm 남음 (체험판)`, 0.2 + (0.8 * done) / dist);
      }
      this.set("arrived", "도착했어요!", 1);
      engine.feel("map_arrived", "방 지도");
    },
    cancel() { this.token++; },
  };

  // ---------- 색 찾기: 집(이리 와) · 공(공 찾아오기) ----------
  function finder(name, label, color) {
    const key = `${SAVE}-${name}`;
    let registered = false;
    try { registered = localStorage.getItem(key) === "1"; } catch {}
    const f = {
      status: { state: "idle", message: "대기 중", progress: 0 }, token: 0,
      info() { return { ...this.status, registered, color: registered ? color : null, simulated: true }; },
      set(state, message, progress) { this.status = { state, message, progress: progress ?? this.status.progress }; broadcast({ type: name, [name]: this.info() }); },
      register() { registered = true; try { localStorage.setItem(key, "1"); } catch {} this.set("idle", `${label}을(를) 기억했어요`); return this.info(); },
      go(fast) {
        if (!registered) throw new Error(`먼저 ${label}을(를) 등록해 주세요`);
        this._go(fast);
      },
      async _go(fast) {
        const tok = ++this.token;
        engine.feel(`${name}_search`, label);
        const n = fast ? Math.round(rand(6, 14)) : 9;
        for (let i = 1; i <= n; i++) {
          await wait(fast ? 450 : 700);
          if (tok !== this.token) return this.set("cancelled", "멈췄어요");
          if (i === Math.ceil(n * 0.45)) engine.feel(`${name}_found`, label);
          this.set(i < n * 0.45 ? "searching" : "approaching", `${i < n * 0.45 ? `두리번거리며 ${label} 찾는 중` : `${label}(으)로 가는 중`} (체험판)`, i / n);
        }
        this.set("arrived", `${label}에 도착했어요 (체험판)`, 1);
        engine.feel(`${name}_arrived`, label);
      },
      cancel() { this.token++; },
    };
    return f;
  }
  const home = finder("home", "집", "#e34948");
  const ball = finder("ball", "공", "#f6b93b");

  // =====================================================================
  // 로봇 놀이 (robotgames.py 흉내)
  // =====================================================================
  const MOVES = { left: "왼쪽 돌기", right: "오른쪽 돌기", forward: "앞으로", back: "뒤로", nod: "끄덕끄덕" };
  const CHANT = "무궁화꽃이피었습니다";
  // ---------- 개인기 훈련 흉내 (tricks.py) ----------
  const trainer = {
    status: { active: null, mode: null, phase: "idle", message: "", left: 0 }, praised: false, running: false,
    set(kw) { this.status = { ...this.status, ...kw }; broadcast({ type: "pet", pet: pet.snapshot() }); },
    praise() { if (this.status.phase !== "judge") return false; this.praised = true; return true; },
    start(id, name, moves, mode, chance) {
      if (this.running || games.busy() || room.busy()) throw new Error("지금 다른 걸 하는 중이에요");
      if (!moves.length) throw new Error("먼저 동작을 담아 주세요");
      this.running = true; this.praised = false;
      const clumsy = mode === "practice" && Math.random() > chance;
      this._run(id, name, moves, mode, clumsy);
    },
    async _run(id, name, moves, mode, clumsy) {
      const todo = clumsy ? moves.slice(0, Math.max(1, Math.floor(moves.length / 2))) : moves;
      this.set({ active: id, mode, phase: "doing", left: 0, message: mode === "practice" ? `${name} 해 볼게요! 로봇을 보세요 👀` : `${name}! 짠~` });
      for (const mv of todo) {
        this.set({ message: `${TRICK_MOVES[mv][1]} ${TRICK_MOVES[mv][0]}…` });
        await wait(MOVE_SECS[mv] * 1000);
      }
      if (clumsy) { this.set({ message: "🤔 갸웃…" }); await wait(700); }
      if (mode === "show") { this.running = false; this.set({ active: null, phase: "idle", message: "" }); pet.trickResult(id, mode, false, false); return; }
      const hint = clumsy ? "(어설프게 하다 멈췄어요 🤔)" : "(제대로 했어요 ✨)";
      for (let left = PRAISE_SECS; left > 0 && !this.praised; left--) {
        this.set({ phase: "judge", left, message: `잘했으면 👍 엄지 척! ${hint}` });
        for (let k = 0; k < 10 && !this.praised; k++) await wait(100);
      }
      const praised = this.praised;
      this.running = false;
      this.set({ active: null, phase: "idle", message: "", left: 0 });
      pet.trickResult(id, mode, praised, clumsy);
    },
  };

  const games = {
    status: { game: null, phase: "idle" }, token: 0, inputs: [], wake: null,
    busy() { return (!!this.status.game && !this.status.done && this.status.phase !== "idle") || trainer.running; },
    set(kw) { this.status = { ...this.status, ...kw }; broadcast({ type: "rgame", rgame: { ...this.status } }); },
    start(game) {
      if (this.busy() || room.busy()) throw new Error("지금 다른 걸 하는 중이에요");
      if (game === "fetch" && !ball.info().registered) throw new Error("먼저 카메라로 공 색을 등록해 주세요");
      this._run(game);
    },
    async _run(game) {
      const tok = ++this.token;
      this.inputs = [];
      this.status = {};
      this.set({ game, phase: "ready", message: "준비!", score: 0, max: { mugunghwa: 10, dance: 8, fetch: 10 }[game], round: 0,
        done: false, result: null, simulated: true });
      let score;
      try {
        score = await this[game](tok);
      } catch (e) {
        if (e === STOP) { if (tok === this.token - 1 && this.status.phase !== "cancelled") this.set({ phase: "cancelled", message: "놀이를 멈췄어요", done: true }); return; }
        throw e;
      }
      const result = pet.act("minigame", { game, score, max_score: this.status.max });
      this.set({ phase: "done", score, done: true, result });
    },
    sleep(ms, tok) { return new Promise((res, rej) => setTimeout(() => (tok === this.token ? res() : rej(STOP)), ms)); },
    input(data) { if (!this.busy()) return false; this.inputs.push(data); this.wake?.(); return true; },
    take(tok, ms) {
      return new Promise((res, rej) => {
        const end = Date.now() + ms;
        const check = () => {
          if (tok !== this.token) return rej(STOP);
          if (this.inputs.length) return res(this.inputs.shift());
          if (Date.now() >= end) return res(null);
          this.wake = check;
          setTimeout(check, 100);
        };
        check();
      });
    },
    cancel() {
      this.token++;
      ball.cancel();
      if (this.busy()) this.set({ phase: "cancelled", message: "놀이를 멈췄어요", done: true });
    },

    // 체험판 무궁화: '터치!' = 한 걸음. 노래할 때 6걸음 다가가면 승리, 돌아봤을 때 누르면 들킨다
    async mugunghwa(tok) {
      const STEPS = 6;
      let steps = 0, survived = 0;
      this.set({ phase: "ready", message: "체험판: 노래할 때 '터치!'를 누르면 한 걸음씩 다가가요", robot: "front" });
      for (const n of [3, 2, 1]) { this.set({ countdown: n }); await this.sleep(900, tok); }
      this.set({ countdown: null });
      for (;;) {
        const total = rand(1800, 4500);
        this.inputs = [];
        for (let k = 0; k < CHANT.length; k++) {
          this.set({ phase: "chant", robot: "away", chant: CHANT.slice(0, k + 1), message: `지금이야! 다가가세요 · 로봇까지 ${STEPS - steps}걸음` });
          await this.sleep(total / CHANT.length, tok);
          while (this.inputs.length) { this.inputs.shift(); steps++; }
          if (steps >= STEPS) {
            this.set({ phase: "won", message: "앗, 잡혔다! 네가 이겼어 🎉", chant: "" });
            await this.sleep(1200, tok);
            return survived <= 2 ? 10 : 9;
          }
        }
        this.set({ phase: "look", robot: "front", message: "멈춰! 👀 지금 누르면 들켜요" });
        this.inputs = [];
        const end = Date.now() + rand(2000, 3200);
        while (Date.now() < end) {
          await this.sleep(100, tok);
          if (this.inputs.length) {
            this.set({ phase: "caught", message: "움직였다! 잡았다~ 😝", chant: "" });
            await this.sleep(1500, tok);
            return Math.min(8, survived * 2);
          }
        }
        survived++;
        this.set({ round: survived });
      }
    },

    async dance(tok) {
      const seq = [];
      let cleared = 0;
      this.set({ phase: "ready", message: "로봇이 추는 춤을 잘 보세요!", seq_len: 0, shown: [] });
      await this.sleep(1500, tok);
      for (let rnd = 0; rnd < 8; rnd++) {
        seq.push(pick(Object.keys(MOVES)));
        if (rnd === 0) seq.push(pick(Object.keys(MOVES)));
        this.set({ phase: "watch", round: rnd + 1, seq_len: seq.length, shown: [], entered: 0, message: "잘 보세요… 👀" });
        await this.sleep(600, tok);
        const pace = Math.max(150, 450 - rnd * 40);
        for (let k = 0; k < seq.length; k++) {
          this.set({ shown: seq.slice(0, k + 1), current: seq[k] });
          await this.sleep(700 + pace, tok);
        }
        this.set({ phase: "input", current: null, message: "따라 해 보세요! 👆", shown: [] });
        this.inputs = [];
        for (let k = 0; k < seq.length; k++) {
          const got = await this.take(tok, 12000);
          const mv = got && got.move;
          if (mv !== seq[k]) {
            this.set({ phase: "wrong", message: mv ? `땡! ${MOVES[seq[k]]}였어요` : "시간이 지났어요", answer: seq });
            await this.sleep(1800, tok);
            return cleared;
          }
          this.set({ entered: k + 1 });
        }
        cleared++;
        this.set({ phase: "good", score: cleared, message: "딩동댕! 🎶" });
        await this.sleep(800, tok);
      }
      this.set({ phase: "good", message: "완벽해! 우리 춤 최고야 🕺" });
      return cleared;
    },

    async fetch(tok) {
      this.set({ phase: "ready", message: "공을 아무 데나 굴려 두세요! 3초 뒤에 찾으러 가요" });
      for (const n of [3, 2, 1]) { this.set({ countdown: n }); await this.sleep(1000, tok); }
      this.set({ countdown: null, phase: "search", message: "공 찾는 중… 🔍" });
      const t0 = Date.now();
      ball.go(true);
      for (;;) {
        await this.sleep(200, tok);
        const st = ball.status.state, el = (Date.now() - t0) / 1000;
        this.set({ elapsed: +el.toFixed(1), message: ball.status.message, progress: ball.status.progress });
        if (st === "arrived") {
          this.set({ phase: "found", message: `찾았다! ${el.toFixed(1)}초 걸렸어 ⚽` });
          return el <= 10 ? 10 : Math.max(3, Math.round(10 - (el - 10) / 3));
        }
        if (st === "cancelled" || st === "failed") return 1;
      }
    },
  };

  // =====================================================================
  // 서버 호출 흉내 (server.py 의 rpc)
  // =====================================================================
  const samples = [];
  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
  async function rpc(method, params = {}) {
    await wait(30);
    switch (method) {
      case "info": return { name: "체험판", robot: false, camera: false, port: 443, urls: [location.origin + location.pathname] };
      case "feel": engine.feel(params.event, params.source); return engine.state();
      case "state": return engine.state();
      case "mood_history": return samples.slice();
      case "game": return pet.snapshot();
      case "act": { const { action, ...rest } = params; return pet.act(action, rest); }
      case "gesture": return pet.act("gesture", { name: params.name });
      case "home_status": return home.info();
      case "home_register": return home.register();
      case "home_go": home.go(); return home.info();
      case "home_cancel": home.cancel(); return home.info();
      case "map": return room.info();
      case "map_cancel": room.cancel(); return room.info();
      case "rgame": return games.status;
      case "rgame_input": return { ok: games.input(params) };
      case "rgame_cancel": games.cancel(); return { ok: true };
      case "ball_register": return ball.register();
      case "ball_status": return ball.info();
      case "cue": case "drive": return { ok: true };
      default: throw new Error(`없는 메서드: ${method}`);
    }
  }

  pet.load();
  setInterval(() => {
    engine.tick(1);
    pet.tick(1);
    const st = engine.state();
    const sample = { t: +now().toFixed(1), valence: st.valence, arousal: st.arousal, bond: st.bond };
    samples.push(sample);
    if (samples.length > 300) samples.shift();
    broadcast({ type: "state", state: st, sample, pet: pet.snapshot() });
  }, 1000);

  window.DemoServer = {
    rpc,
    camera() { return render(room.pose.x, room.pose.y, room.pose.heading); },
    photo(i) { return room.photos[i] || ""; },
  };

  // 체험판 안내 띠
  addEventListener("DOMContentLoaded", () => {
    const bar = document.createElement("div");
    bar.className = "demo-bar";
    bar.innerHTML = '🤖 <b>체험판</b> · 로봇 없이 화면만 움직여요 (경험치 3배) · <a href="https://github.com/DIDIDIP/emotion-duck" target="_blank" rel="noopener">진짜 라즈봇2에 설치하기</a>';
    document.body.prepend(bar);
  });
})();
