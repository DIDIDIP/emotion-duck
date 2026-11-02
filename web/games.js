// 놀이 탭: 호감도 카드 + 라즈봇이 직접 하는 놀이 3개의 리모컨·점수판
// 게임 진행은 로봇(robotgames.py)이 하고, 앱은 상태를 받아 보여 주고 버튼 입력만 보낸다.
window.Play = (() => {
  let pet = null;
  let current = null;       // 열려 있는 놀이 id
  let started = false;      // 이 창에서 시작 버튼을 눌렀나
  let ballInfo = { registered: false };
  let camTimer = null;
  const dlg = $("game-dlg");
  const body = $("g-body");
  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // =====================================================================
  // 호감도 카드
  // =====================================================================
  const TIER_NAMES = ["낯가림", "아는 사이", "친구", "단짝", "베프", "소울메이트"];
  function update(p) {
    pet = p;
    $("aff-who").textContent = `${p.name}와(과)의 사이`;
    $("aff-title").textContent = p.title;
    $("aff-num").textContent = p.affection;
    const hearts = $("hearts");
    if (!hearts.children.length) for (let i = 0; i < 10; i++) {
      const s = h("span", "heart");
      s.append(h("i", "h-bg", "🤍"), h("i", "h-fg", "💗"));
      hearts.append(s);
    }
    [...hearts.children].forEach((s, i) => {
      s.style.setProperty("--f", `${Math.max(0, Math.min(1, (p.affection - i * 10) / 10)) * 100}%`);
    });
    $("aff-next").textContent = p.next_title ? `${p.next_title}까지 ${p.next_at - p.affection} 남았어요` : "더할 나위 없는 사이예요 💖";
    $("tiers").replaceChildren(...TIER_NAMES.map((n, i) => h("li", i < p.tier ? "done" : i === p.tier ? "now" : "", n)));
    for (const [g, info] of Object.entries(p.games)) {
      const meta = document.querySelector(`[data-meta="${g}"]`);
      if (meta) meta.innerHTML = `<span>최고 ${info.best}</span><span class="${info.left ? "left" : "none"}">${info.left ? `💗 ${info.left}번` : "오늘 보상 끝"}</span>`;
    }
    renderTricks(p);
  }
  function show() { if (pet) update(pet); }

  // =====================================================================
  // 개인기 훈련 · 나만의 개인기
  // =====================================================================
  let draft = null, dirty = false, lastKey = "", lastPhase = "idle";
  function pips(n) {
    const box = h("span", "pips");
    for (let i = 0; i < 3; i++) box.append(h("i", i < n ? "on" : ""));
    box.setAttribute("aria-label", `칭찬 ${Math.min(n, 3)}/3`);
    return box;
  }
  // 로봇이 하는 중이면 무엇을 하는지, 끝나면 👍 칭찬 버튼과 6초 막대
  function trickPanel(t) {
    const box = h("div", "trick-panel " + t.phase);
    box.append(h("p", null, t.message));
    if (t.phase === "judge") {
      const b = h("button", "btn big praise", "👍 잘했어!");
      b.addEventListener("click", async () => { Fx.sound("happy"); Fx.buzz(20); await act("trick_praise"); });
      const bar = h("span", "judge-timer"); const fill = h("i"); fill.style.width = `${(t.left / 6) * 100}%`; bar.append(fill);
      box.append(b, bar);
    }
    return box;
  }
  function renderTricks(p) {
    if (!p.tricks) return;
    const t = p.trick || { phase: "idle" };
    const busy = t.phase !== "idle";
    if (t.phase === "judge" && lastPhase !== "judge") { Fx.sound("tap"); Fx.buzz(30); }
    lastPhase = t.phase;
    if (!dirty) draft = [...p.custom.moves];
    const key = JSON.stringify([p.tricks, p.custom, t, draft, dirty, p.moves.length]);
    if (key === lastKey) return;
    lastKey = key;

    $("tricks").replaceChildren(...p.tricks.map((tr) => {
      const card = h("div", "trick-card" + (tr.learned ? " learned" : "") + (t.active === tr.id ? " active" : ""));
      const row = h("div", "trick-row");
      const txt = h("span", "trick-txt");
      txt.append(h("b", null, tr.name), tr.learned ? h("span", "learned-tag", "배웠어요 ✓") : pips(tr.progress));
      const btn = h("button", "btn " + (tr.learned ? "show" : "primary"), tr.learned ? "🎬 보여 줘" : "연습");
      btn.disabled = busy;
      btn.addEventListener("click", () => { Fx.sound("tap"); act("trick", { id: tr.id, mode: tr.learned ? "show" : "practice" }); });
      row.append(h("span", "trick-ico", tr.icon), txt, btn);
      card.append(row);
      if (t.active === tr.id) card.append(trickPanel(t));
      return card;
    }));

    const name = (id) => p.moves.find((m) => m.id === id);
    $("move-palette").replaceChildren(...p.moves.map((m) => {
      const b = h("button", "move");
      b.append(h("span", null, m.icon), h("small", null, m.name));
      b.disabled = draft.length >= 6;
      b.addEventListener("click", () => { draft.push(m.id); dirty = true; Fx.sound("tap"); renderTricks(pet); });
      return b;
    }));
    const slots = [];
    for (let i = 0; i < 6; i++) {
      const m = draft[i] && name(draft[i]);
      const b = h("button", "slot" + (m ? " filled" : ""), m ? m.icon : "");
      b.setAttribute("aria-label", m ? `${i + 1}번째 ${m.name} 빼기` : `${i + 1}번째 빈칸`);
      if (m) b.addEventListener("click", () => { draft.splice(i, 1); dirty = true; renderTricks(pet); });
      else b.disabled = true;
      slots.push(b);
    }
    $("move-slots").replaceChildren(...slots);
    $("custom-save").disabled = !dirty;
    $("custom-practice").disabled = busy || dirty || !p.custom.moves.length || p.custom.learned;
    $("custom-show").disabled = busy || dirty || !p.custom.learned;
    $("custom-status").textContent = dirty ? "저장하지 않은 변경이 있어요"
      : !p.custom.moves.length ? "동작을 담고 저장한 뒤 연습시켜 보세요"
      : p.custom.learned ? "배웠어요 ✓ 언제든 보여 줄 수 있어요" : `칭찬 ${p.custom.progress}/3 · 연습시켜 주세요`;
    $("custom-judge").replaceChildren(...(t.active === "custom" ? [trickPanel(t)] : []));
  }
  $("custom-save").addEventListener("click", async () => {
    const r = await act("custom_save", { moves: draft });
    if (r.ok) { dirty = false; lastKey = ""; Fx.sound("happy"); }
  });
  $("custom-practice").addEventListener("click", () => act("trick", { id: "custom", mode: "practice" }));
  $("custom-show").addEventListener("click", () => act("trick", { id: "custom", mode: "show" }));

  // =====================================================================
  // 놀이 소개
  // =====================================================================
  const GAMES = {
    mugunghwa: {
      title: "🌸 무궁화 꽃이 피었습니다", icon: "🌸", max: 10,
      parts: ["🔄 고개", "📷 카메라", "📏 초음파", "🔔 부저"],
      how: ["로봇이 술래! 로봇에게서 멀리 떨어져 서요", "로봇이 고개를 돌리고 삑삑 노래하는 동안 다가가요", "로봇이 돌아보면 멈춰요 — 카메라가 움직임을 잡아요", "로봇 바로 앞까지 오면(초음파) 승리!"],
    },
    dance: {
      title: "🕺 따라 춤추기", icon: "🕺", max: 8,
      parts: ["🛞 바퀴", "🔄 고개", "💡 불빛", "🔔 부저"],
      how: ["로봇이 바퀴·고개로 춤 동작을 차례로 보여 줘요", "같은 순서로 아래 버튼(또는 손짓)을 눌러요", "맞히면 로봇이 따라 춰요 · 한 판마다 하나씩 길어져요"],
    },
    fetch: {
      title: "⚽ 공 찾아오기", icon: "⚽", max: 10,
      parts: ["📷 카메라", "🛞 바퀴", "🔄 고개"],
      how: ["처음 한 번: 공을 카메라 가운데에 보여 주고 색을 등록해요", "시작하면 3초 안에 공을 아무 데나 굴려요", "로봇이 빙글 돌며 찾아서 공 앞까지 가요 · 빠를수록 고득점"],
    },
  };
  const MOVE_ICON = { left: "⬅️", right: "➡️", forward: "⬆️", back: "⬇️", nod: "🙆" };
  const MOVE_NAME = { left: "왼쪽", right: "오른쪽", forward: "앞으로", back: "뒤로", nod: "끄덕" };

  document.querySelectorAll("[data-game]").forEach((b) => b.addEventListener("click", () => open(b.dataset.game)));
  $("g-close").addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  function close() {
    if (started && lastStatus && !lastStatus.done) rpc("rgame_cancel").catch(() => {});
    started = false;
    current = null;
    clearTimeout(camTimer);
    dlg.close();
  }

  function open(id) {
    const g = GAMES[id];
    current = id;
    started = false;
    $("g-title").textContent = g.title;
    $("g-stat").textContent = "";
    if (!dlg.open) dlg.showModal();
    Fx.sound("tap");
    const left = pet?.games[id]?.left ?? 0;
    const intro = h("div", "g-intro");
    intro.append(h("div", "g-big", g.icon));
    const parts = h("div", "g-parts");
    g.parts.forEach((p) => parts.append(h("span", null, p)));
    intro.append(h("p", "g-parts-label", "로봇이 쓰는 것"), parts);
    const ul = h("ol", "g-how");
    g.how.forEach((t) => ul.append(h("li", null, t)));
    intro.append(ul);
    if (id === "fetch") intro.append(ballSetup());
    intro.append(h("p", "g-reward " + (left ? "" : "none"), left ? `오늘 호감도 보상 ${left}번 남았어요 💗` : "오늘 보상은 다 받았어요 · 연습은 얼마든지!"));
    if (pet && pet.energy < 15) intro.append(h("p", "g-warn", "⚡ 에너지가 부족해요. 먼저 재워 주세요"));
    const start = h("button", "btn big primary g-start", "로봇아, 시작하자!");
    start.id = "g-start";
    start.disabled = id === "fetch" && !ballInfo.registered;
    start.addEventListener("click", () => begin(id));
    intro.append(start);
    body.replaceChildren(intro);
    if (id === "fetch") refreshCam();
  }

  // 공 찾아오기: 공 색 등록
  function ballSetup() {
    const box = h("div", "ball-setup");
    const fig = h("figure", "cam small");
    const img = h("img");
    img.id = "g-cam";
    img.alt = "로봇 카메라 화면";
    const note = h("figcaption", null, "카메라 없음 · 흉내 모드");
    note.id = "g-cam-note";
    note.hidden = true;
    fig.append(img, note);
    const row = h("div", "row");
    const reg = h("button", "btn", ballInfo.registered ? "공 다시 등록" : "가운데 보이는 공 등록");
    const sw = h("span", "swatch");
    sw.hidden = !ballInfo.color;
    if (ballInfo.color) sw.style.background = ballInfo.color;
    reg.addEventListener("click", async () => {
      try {
        ballInfo = await rpc("ball_register");
        Fx.sound("happy");
        open("fetch");
      } catch (e) { toast(e.message); Fx.sound("error"); }
    });
    row.append(reg, sw, h("span", "muted small", ballInfo.registered ? "공 색을 기억하고 있어요" : "진한 색 공이 좋아요"));
    box.append(fig, row);
    return box;
  }
  function refreshCam() {
    clearTimeout(camTimer);
    const img = $("g-cam");
    if (!img || !dlg.open) return;
    const next = () => { camTimer = setTimeout(refreshCam, 700); };
    img.onload = () => { if ($("g-cam-note")) $("g-cam-note").hidden = true; next(); };
    img.onerror = () => { if ($("g-cam-note")) $("g-cam-note").hidden = false; next(); };
    img.src = cameraUrl();
  }

  async function begin(id) {
    started = true;
    lastStatus = null;
    body.replaceChildren(h("div", "g-count", "…"));
    const r = await act("play", { game: id });
    if (!r.ok) { started = false; open(id); }
  }

  // =====================================================================
  // 로봇에서 오는 진행 상황 그리기
  // =====================================================================
  let lastStatus = null;
  let shownResult = false;
  function rgame(st) {
    const prev = lastStatus;
    lastStatus = st;
    if (!dlg.open || !started || st.game !== current) return;
    if (st.phase === "cancelled") { open(current); return; }
    if (st.done && st.result) { if (!shownResult) { shownResult = true; finish(st); } return; }
    shownResult = false;
    if (st.game === "mugunghwa") drawMugunghwa(st, prev);
    if (st.game === "dance") drawDance(st, prev);
    if (st.game === "fetch") drawFetch(st);
  }

  function screen(cls) {
    let s = body.querySelector(".live");
    if (!s || !s.classList.contains(cls)) {
      s = h("div", "live " + cls);
      body.replaceChildren(s);
    }
    return s;
  }
  function stopButton() {
    const b = h("button", "btn g-stop", "■ 그만하기");
    b.addEventListener("click", () => rpc("rgame_cancel").catch(() => {}));
    return b;
  }

  // ---------- 무궁화 ----------
  function drawMugunghwa(st, prev) {
    const s = screen("mug");
    if (!s.dataset.ready) {
      s.dataset.ready = 1;
      s.innerHTML = `<div class="mug-panel"><span class="mug-robot"></span><p class="mug-chant"></p><p class="mug-msg"></p></div>`;
      const touch = h("button", "btn big primary mug-touch", "🖐 터치!");
      touch.addEventListener("click", () => { rpc("rgame_input", { touch: true }); Fx.buzz(20); });
      s.append(touch, h("p", "hint center", "로봇 바로 앞(15cm)까지 가면 초음파가 알아채요. 센서가 없으면 이 버튼을 눌러요."), stopButton());
    }
    s.querySelector(".mug-panel").dataset.phase = st.phase;
    s.querySelector(".mug-robot").textContent =
      st.countdown ? st.countdown : { chant: "🙈", look: "👀", caught: "😝", won: "🎉" }[st.phase] || "🤖";
    s.querySelector(".mug-chant").textContent = st.phase === "chant" ? st.chant : st.phase === "look" ? "멈춰!" : "";
    s.querySelector(".mug-msg").textContent = st.message;
    $("g-stat").textContent = `버틴 횟수 ${st.round || 0}`;
    if (prev?.phase !== st.phase) {
      if (st.phase === "look") { Fx.sound("error"); Fx.buzz(40); }
      if (st.phase === "caught") Fx.sound("sad");
      if (st.phase === "won") { Fx.sound("level"); Fx.confetti(); }
    }
    if (st.phase === "chant" && prev?.chant !== st.chant) Fx.sound("tap");
  }

  // ---------- 따라 춤추기 ----------
  function drawDance(st, prev) {
    const s = screen("dance");
    if (!s.dataset.ready) {
      s.dataset.ready = 1;
      s.innerHTML = `<p class="dance-msg"></p><div class="dance-seq"></div><div class="dance-pad"></div>`;
      const pad = s.querySelector(".dance-pad");
      for (const mv of ["forward", "left", "nod", "right", "back"]) {
        const b = h("button", `dpad ${mv}`);
        b.dataset.move = mv;
        b.append(h("span", null, MOVE_ICON[mv]), h("small", null, MOVE_NAME[mv]));
        b.addEventListener("click", () => {
          rpc("rgame_input", { move: mv });
          Fx.sound("tap"); Fx.buzz(10);
          b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 180);
        });
        pad.append(b);
      }
      s.append(stopButton());
    }
    s.querySelector(".dance-msg").textContent = st.message;
    const n = st.seq_len || 0;
    const answer = st.phase === "wrong" ? st.answer : null;
    s.querySelector(".dance-seq").replaceChildren(...Array.from({ length: n }, (_, i) => {
      const shown = answer ? answer[i] : st.shown?.[i];
      const filled = ["input", "good"].includes(st.phase) ? i < (st.entered || 0) : !!shown;
      return h("span", "dot" + (filled ? " on" : ""), shown ? MOVE_ICON[shown] : "");
    }));
    s.querySelector(".dance-pad").classList.toggle("off", st.phase !== "input");
    $("g-stat").textContent = st.round ? `${st.round}/8판 · 성공 ${st.score || 0}` : "";
    if (prev?.phase !== st.phase) {
      if (st.phase === "good") Fx.sound("happy");
      if (st.phase === "wrong") Fx.sound("error");
    }
  }

  // ---------- 공 찾아오기 ----------
  function drawFetch(st) {
    const s = screen("fetch");
    if (!s.dataset.ready) {
      s.dataset.ready = 1;
      s.innerHTML = `<p class="fetch-time"><b>0.0</b><small>초</small></p><figure class="cam small"><img id="g-cam" alt="로봇 카메라 화면"><figcaption id="g-cam-note" hidden>카메라 없음 · 흉내 모드</figcaption></figure><p class="fetch-msg"></p><div class="progress"><span></span></div>`;
      s.append(stopButton());
      refreshCam();
    }
    s.querySelector(".fetch-time b").textContent = st.countdown ? `${st.countdown}` : (st.elapsed || 0).toFixed(1);
    s.querySelector(".fetch-time small").textContent = st.countdown ? " 공을 굴려요!" : "초";
    s.querySelector(".fetch-msg").textContent = st.message;
    s.querySelector(".progress span").style.width = `${Math.round((st.progress || 0) * 100)}%`;
    $("g-stat").textContent = "빠를수록 고득점";
  }

  // ---------- 결과 ----------
  function finish(st) {
    clearTimeout(camTimer);
    const r = st.result || {};
    const ratio = st.score / st.max;
    const stars = ratio >= 0.8 ? 3 : ratio >= 0.4 ? 2 : 1;
    const res = h("div", "g-result");
    const sr = h("div", "g-stars");
    for (let i = 0; i < 3; i++) sr.append(h("span", i < stars ? "on" : "", "★"));
    res.append(sr, h("p", "g-score", `${st.score} / ${st.max}`), h("p", "g-msg", st.message));
    res.append(h("p", "g-gain" + (r.gain ? " big" : ""), r.ok === false ? (r.message || "결과를 저장하지 못했어요")
      : r.gain ? `💗 호감도 +${r.gain}` : "연습 완료! (오늘 보상은 다 받았어요)"));
    const bits = [];
    if (r.new_best) bits.push("🏅 최고 기록!");
    if (r.title_up) bits.push(`🎉 이제 우리는 "${r.title_up}"!`);
    res.append(h("p", "g-extra", bits.join("  ")));
    const row = h("div", "g-row");
    const again = h("button", "btn big", "한 판 더");
    const done = h("button", "btn big primary", "닫기");
    again.addEventListener("click", () => open(current));
    done.addEventListener("click", close);
    row.append(again, done);
    res.append(row);
    body.replaceChildren(res);
    $("g-stat").textContent = "";
    if (stars === 3) { Fx.confetti(); Fx.sound("level"); } else Fx.sound(stars === 2 ? "happy" : "pet");
    started = false;
    done.focus();
  }

  function ball(info) {
    ballInfo = info;
    if (current === "fetch" && !started && $("g-start")) $("g-start").disabled = !info.registered;
  }

  if (location.hash === "#play") showTab("play");
  return { update, show, open, rgame, ball };
})();
