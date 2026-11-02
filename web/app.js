// 감정 오리 키우기 앱 (돌보기 탭 + 공통 연결)
const $ = (id) => document.getElementById(id);
let rpcId = 0;

// ---------- 서버 주소 (다른 로봇에 연결하면 바뀐다) ----------
let base = "";
try { base = localStorage.getItem("robot") || ""; } catch {}

async function rpc(method, params = {}) {
  const res = await fetch(base + "/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2400);
}

function say(text) {
  if (!text) return;
  const b = $("bubble");
  b.textContent = text;
  b.style.animation = "none"; void b.offsetWidth; b.style.animation = "";
  if ($("voice").checked && "speechSynthesis" in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\s.,!?~]/gu, " "));
    u.lang = "ko-KR"; u.pitch = 1.6; u.rate = 1.1;
    speechSynthesis.speak(u);
  }
}

// =====================================================================
// 탭
// =====================================================================
const TABS = ["pet", "play", "map"];
function showTab(name) {
  TABS.forEach((t) => {
    $("tab-" + t).setAttribute("aria-selected", String(t === name));
    $("view-" + t).hidden = t !== name;
  });
  document.querySelector(".tabs").dataset.tab = name;
  if (name === "map") window.MapView?.show();
  if (name === "play") window.Play?.show();
  history.replaceState(null, "", name === "map" ? "#room" : name === "play" ? "#play" : location.pathname);
}
TABS.forEach((t) => $("tab-" + t).addEventListener("click", () => { Fx.sound("tap"); showTab(t); }));

// =====================================================================
// 펫 상태 그리기
// =====================================================================
let pet = null;
const UNLOCK_NAMES = { rps: "가위바위보", come: "이리 와" };

function drawPet(p) {
  const prev = pet;
  pet = p;
  LedFace.set(p.face);
  $("emoji").textContent = p.emoji;
  $("label").textContent = p.label;
  $("lv").textContent = p.level;
  $("lv-ring").style.setProperty("--p", Math.round((p.xp / p.xp_next) * 100));
  $("lv-ring").setAttribute("aria-label", `레벨 ${p.level}, 경험치 ${p.xp}/${p.xp_next}`);
  $("xp-text").textContent = `경험치 ${p.xp}/${p.xp_next} · 다음 레벨까지 ${p.xp_next - p.xp}`;
  if ($("name-form").hidden) $("name").textContent = p.name;

  bar("happy", p.happy);
  bar("energy", p.energy);
  $("aff-mini-bar").style.width = `${p.affection}%`;
  $("aff-mini").textContent = p.affection;
  window.Play?.update(p);
  window.Closet?.update(p);
  $("happy-bar").parentElement.classList.toggle("low", p.happy < 30);
  $("energy-bar").parentElement.classList.toggle("low", p.energy < 15);

  $("snack-sub").textContent = p.snacks_left > 0 ? `오늘 ${p.snacks_left}번 남음` : "내일 또 줄 수 있어요";
  document.querySelector('[data-act="snack"]').classList.toggle("used", p.snacks_left === 0);

  $("sleep-ico").textContent = p.sleeping ? "☀️" : "🌙";
  $("sleep-name").textContent = p.sleeping ? "깨우기" : "재우기";
  $("sleep-sub").textContent = p.sleeping ? "쿨쿨 · 에너지 충전 중" : "에너지 회복";

  document.querySelectorAll("[data-unlock]").forEach((btn) => {
    const need = p.unlock[btn.dataset.unlock];
    const locked = p.level < need;
    btn.classList.toggle("locked", locked);
    const busy = btn.dataset.unlock === "come" && isBusy(homeInfo);
    btn.classList.toggle("busy", busy);
    btn.querySelector(".a-sub").textContent = locked ? `🔒 Lv${need}에 열려요`
      : btn.dataset.unlock === "rps" ? "한 판 하자" : busy ? "가는 중…" : "집으로 와요";
  });

  $("rps-pick").hidden = !p.rps_open;
  if (p.rps_open && !(prev && prev.rps_open)) startCountdown();

  const G = { rock: "바위 ✊", scissors: "가위 ✌️", paper: "보 ✋", wave: "안녕 👋", thumbs_up: "최고 👍", palm: "보 ✋" };
  $("gesture").textContent = p.gesture ? G[p.gesture] || p.gesture : "손짓 대기";
  $("gesture").classList.toggle("idle", !p.gesture);

  if (prev && p.level > prev.level) {
    const opened = Object.entries(p.unlock).filter(([, lv]) => lv === p.level).map(([k]) => UNLOCK_NAMES[k]);
    $("levelup-title").textContent = `Lv ${p.level}!`;
    $("levelup-sub").textContent = opened.length ? `🔓 ${opened.join(", ")}이(가) 열렸어요` : "더 친해졌어요";
    $("levelup").hidden = false;
    const hasGift = window.Closet?.gift(p);
    Fx.confetti();
    Fx.sound("level");
    if (!hasGift) setTimeout(() => { $("levelup").hidden = true; }, 2800);
  }
  sleepFx(p.sleeping);
}
// 선물 상자가 있으면 바깥을 눌러도 닫히지 않는다 (버튼으로 닫기)
$("levelup").addEventListener("click", (e) => {
  if (e.target === $("levelup") && ($("gift").hidden && $("gift-actions").hidden)) $("levelup").hidden = true;
});

function bar(key, value) {
  $(key + "-bar").style.width = `${Math.max(0, Math.min(100, value))}%`;
  $(key).textContent = value;
}

// 자는 동안 Zzz가 떠오른다
let zzzTimer = null;
function sleepFx(on) {
  if (on && !zzzTimer) zzzTimer = setInterval(() => Fx.burst("zzz", 1), 2400);
  if (!on && zzzTimer) { clearInterval(zzzTimer); zzzTimer = null; }
}

let countdown = null;
function startCountdown() {
  clearInterval(countdown);
  const end = Date.now() + 10000;
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    $("rps-count").textContent = Math.ceil(left / 1000);
    $("rps-timer").style.width = `${left / 100}%`;
    if (left <= 0) { clearInterval(countdown); $("rps-pick").hidden = true; }
  };
  tick();
  countdown = setInterval(tick, 100);
}

// =====================================================================
// 행동
// =====================================================================
async function act(action, params = {}) {
  Fx.buzz();
  try {
    const r = await rpc("act", { action, ...params });
    if (!r.ok && r.message) { toast(r.message); Fx.sound("error"); }
    if (r.need_home) { $("cam-box").open = true; $("cam-box").scrollIntoView({ behavior: "smooth" }); }
    return r;
  } catch (e) {
    toast(e.message.includes("fetch") ? "로봇과 연결이 안 돼요" : e.message);
    Fx.sound("error");
    return { ok: false };
  }
}
document.querySelectorAll("[data-act]").forEach((btn) => {
  btn.addEventListener("click", () => act(btn.dataset.act));
});
document.querySelectorAll("[data-hand]").forEach((btn) => {
  btn.addEventListener("click", () => { $("rps-pick").hidden = true; act("rps", { hand: btn.dataset.hand }); });
});
$("face").addEventListener("click", () => {
  Fx.burst("love", 3);   // 서버 응답 전에 바로 반응해서 손맛을 살린다
  act("pet");
});

function playReaction(name) {
  if (!name) return;
  const d = $("face");
  d.classList.remove(...[...d.classList].filter((c) => c.startsWith("react-")));
  void d.offsetWidth;
  d.classList.add("react-" + name);
}

// 사건 → 파티클·효과음
const EVENT_FX = {
  pet: ["love", "pet"], snack: ["yum", "snack"], sleep_now: ["zzz", "sleep"], wake: ["spark", "wake"],
  rps_win: ["happy", "happy"], rps_lose: ["sad", "sad"], rps_draw: ["spark", "tap"], play: ["note", "tap"],
  too_tired: ["zzz", "error"], lonely: ["sad", "sad"], level_up: [null, null],
  wave: ["love", "pet"], thumbs_up: ["love", "happy"],
  map_scan: ["spark", "scan"], map_scanned: ["happy", "happy"], map_go: ["note", "tap"],
  map_arrived: ["happy", "happy"], map_blocked: ["sad", "error"],
  home_found: ["spark", "tap"], home_arrived: ["happy", "happy"], home_failed: ["sad", "sad"],
  goal: ["happy", "happy"], homerun: ["happy", "happy"],
};
function eventFx(event) {
  const [burst, sound] = EVENT_FX[event] || [];
  if (burst) Fx.burst(burst, burst === "zzz" ? 2 : 7);
  if (sound) Fx.sound(sound);
}

// =====================================================================
// 이름 바꾸기
// =====================================================================
$("name-btn").addEventListener("click", () => {
  $("name-input").value = pet?.name || "";
  $("name-btn").hidden = true;
  $("name-form").hidden = false;
  $("name-input").focus();
  $("name-input").select();
});
$("name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("name-input").value.trim();
  $("name-form").hidden = true;
  $("name-btn").hidden = false;
  if (name && name !== pet?.name) {
    $("name").textContent = name;
    await act("rename", { name });
  }
});
$("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { $("name-form").hidden = true; $("name-btn").hidden = false; }
});

// =====================================================================
// 카메라 · 집 등록 · 이리 와 진행
// =====================================================================
let homeInfo = { state: "idle", registered: false };
let camTimer = null;
function isBusy(info) { return ["searching", "approaching"].includes(info.state); }

function refreshCamera() {
  clearTimeout(camTimer);
  if (!$("cam-box").open || $("view-pet").hidden) return;
  const img = $("cam");
  const next = () => { camTimer = setTimeout(refreshCamera, isBusy(homeInfo) ? 400 : 1000); };
  img.onload = () => { $("cam-note").hidden = true; next(); };
  img.onerror = () => { $("cam-note").hidden = false; next(); };
  img.src = `${base}/camera.jpg?t=${Date.now()}`;
}
$("cam-box").addEventListener("toggle", refreshCamera);

function drawHome(info) {
  homeInfo = info;
  const busy = isBusy(info);
  $("h-cancel").hidden = !busy;
  $("h-register").disabled = busy;
  $("h-swatch").hidden = !info.color;
  if (info.color) $("h-swatch").style.background = info.color;
  $("h-register").textContent = info.registered ? "집 다시 등록" : "이걸 집으로 등록";
  $("h-message").textContent = info.state === "idle" ? (info.registered ? "집이 등록되어 있어요" : "") : info.message;
  $("h-message").className = "status-msg " + info.state;
  $("h-bar").style.width = `${Math.round((info.progress || 0) * 100)}%`;
  if (pet) drawPet(pet);
}
async function homeCall(method) {
  try { drawHome(await rpc(method)); } catch (e) { toast(e.message); Fx.sound("error"); }
}
$("h-register").addEventListener("click", () => homeCall("home_register"));
$("h-cancel").addEventListener("click", () => homeCall("home_cancel"));

// =====================================================================
// 기분 기록 그래프
// =====================================================================
const SERIES = [
  { key: "valence", name: "기분", color: "--s1" },
  { key: "arousal", name: "활기", color: "--s2" },
  { key: "bond", name: "친밀도", color: "--s3" },
];
const WINDOW = 300;
let samples = [];
const pct = (x) => Math.round(x * 100);
const signed = (x) => { const n = pct(x); return n > 0 ? `+${n}` : String(n); };
const fmt = (key, x) => (key === "bond" ? String(pct(x)) : signed(x));
const clock = (t) => new Date(t * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const svgNS = "http://www.w3.org/2000/svg";
function el(name, attrs, parent) {
  const n = document.createElementNS(svgNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

let geom = null, hoverX = null;
function drawChart() {
  if (!$("mood-box").open || $("view-pet").hidden) return;
  const svg = $("chart-svg");
  const W = svg.clientWidth || 320, H = 180;
  const pad = { l: 32, r: 50, t: 8, b: 22 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const now = samples.length ? samples[samples.length - 1].t : Date.now() / 1000;
  const x = (t) => pad.l + (1 - (now - t) / WINDOW) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v + 1) / 2) * (H - pad.t - pad.b);
  geom = { x, y, pad, W, now };
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    el("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: v === 0 ? "zero" : "gridline" }, svg);
    el("text", { x: pad.l - 6, y: y(v) + 3, "text-anchor": "end", class: "tick" }, svg).textContent = signed(v);
  }
  for (const ago of [300, 180, 60, 0]) {
    const anchor = ago === 300 ? "start" : ago === 0 ? "end" : "middle";
    el("text", { x: x(now - ago), y: H - 6, "text-anchor": anchor, class: "tick" }, svg)
      .textContent = ago === 0 ? "지금" : `${ago / 60}분 전`;
  }
  const shown = samples.filter((s) => now - s.t <= WINDOW);
  if (shown.length >= 2) {
    const last = shown[shown.length - 1];
    const ends = SERIES.map((s) => ({ s, y: y(last[s.key]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
    for (const { s, y: ly } of ends) {
      const d = shown.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p[s.key]).toFixed(1)}`).join("");
      el("path", { d, class: "series", stroke: `var(${s.color})` }, svg);
      el("text", { x: W - pad.r + 6, y: ly + 4, class: "end-label" }, svg).textContent = s.name;
    }
  }
  el("line", { class: "cross", y1: pad.t, y2: H - pad.b, x1: -10, x2: -10, id: "cross", visibility: "hidden" }, svg);
  for (const s of SERIES) el("circle", { r: 4, class: "marker", fill: `var(${s.color})`, id: "m-" + s.key, visibility: "hidden" }, svg);
  if (hoverX !== null) hover(hoverX);
}

function hover(clientX) {
  hoverX = clientX;
  if (!geom || samples.length < 2) return;
  const rect = $("chart-svg").getBoundingClientRect();
  const px = (clientX - rect.left) * (geom.W / rect.width);
  const t = geom.now - (1 - (px - geom.pad.l) / (geom.W - geom.pad.l - geom.pad.r)) * WINDOW;
  const p = samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  if (geom.now - p.t > WINDOW) return leave();
  const cx = geom.x(p.t);
  const cross = $("cross");
  cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
  for (const s of SERIES) {
    const m = $("m-" + s.key);
    m.setAttribute("cx", cx); m.setAttribute("cy", geom.y(p[s.key])); m.setAttribute("visibility", "visible");
  }
  const tip = $("tip");
  tip.replaceChildren(clock(p.t), ...SERIES.map((s) => {
    const row = document.createElement("div");
    const dot = document.createElement("i");
    dot.style.background = `var(${s.color})`;
    row.append(dot, `${s.name} ${fmt(s.key, p[s.key])}`);
    return row;
  }));
  tip.hidden = false;
  const left = (cx / geom.W) * rect.width;
  tip.style.left = `${Math.min(Math.max(0, left - tip.offsetWidth / 2), rect.width - tip.offsetWidth)}px`;
}
function leave() {
  hoverX = null;
  $("tip").hidden = true;
  for (const id of ["cross", ...SERIES.map((s) => "m-" + s.key)]) $(id)?.setAttribute("visibility", "hidden");
}
$("chart").addEventListener("pointermove", (e) => hover(e.clientX));
$("chart").addEventListener("pointerdown", (e) => hover(e.clientX));
$("chart").addEventListener("pointerleave", leave);
$("mood-box").addEventListener("toggle", drawChart);
window.addEventListener("resize", drawChart);

const NAMES = {
  pet: "쓰다듬기", snack: "간식", sleep_now: "재우기", wake: "기상", level_up: "레벨 업",
  rps_win: "가위바위보 승", rps_lose: "가위바위보 패", rps_draw: "가위바위보 무", play: "놀자",
  too_tired: "피곤해서 거절", lonely: "심심함", wave: "인사", thumbs_up: "칭찬",
  map_scan: "방 스캔", map_scanned: "스캔 완료", map_go: "지도 이동", map_arrived: "도착", map_blocked: "막힘",
  goal: "골", homerun: "홈런", home_search: "집 찾기", home_found: "집 발견", home_arrived: "집 도착", home_failed: "집 못 찾음",
};
function drawHistory(items) {
  const rows = items.slice().reverse().map((h) => {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = NAMES[h.event] || h.event;
    li.append(`${clock(h.t).slice(0, -3)} `, b, ` — ${h.speech}`);
    return li;
  });
  if (!rows.length) { const li = document.createElement("li"); li.textContent = "아직 없어요"; rows.push(li); }
  $("history").replaceChildren(...rows);
}

// =====================================================================
// 기기 연결 창
// =====================================================================
$("conn-btn").addEventListener("click", () => { $("conn-dialog").showModal(); refreshInfo(); });

async function refreshInfo() {
  try {
    const t0 = performance.now();
    const info = await rpc("info");
    $("c-status").textContent = "연결됨";
    $("c-robot").textContent = (info.robot ? "라즈봇2 · " : "흉내 모드 · ") + info.name;
    $("c-camera").textContent = info.camera ? "켜짐" : "없음";
    $("c-ping").textContent = `${Math.round(performance.now() - t0)} ms`;
    const url = base || info.urls[0] || location.origin;
    $("c-url").textContent = url;
    drawQR(url);
  } catch {
    $("c-status").textContent = "연결 안 됨";
    $("c-ping").textContent = "-";
  }
}
function drawQR(url) {
  const box = $("qr");
  if (box.dataset.url === url) return;
  box.dataset.url = url;
  box.replaceChildren();
  if (window.QRCode) {
    new QRCode(box, { text: url, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
  } else {
    box.textContent = "QR을 그리려면 인터넷이 필요해요. 옆 주소를 휴대폰에 직접 입력하세요.";
    box.style.cssText = "font-size:.75rem;color:#333";
  }
}
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("c-url").textContent); $("copy").textContent = "복사됨"; }
  catch { $("copy").textContent = "직접 복사하세요"; }
  setTimeout(() => { $("copy").textContent = "주소 복사"; }, 1500);
});
$("addr-form").addEventListener("submit", (e) => {
  e.preventDefault();
  let v = $("addr").value.trim().replace(/\/+$/, "");
  if (v && !/^https?:\/\//.test(v)) v = "http://" + v;
  if (v && !/:\d+$/.test(v)) v += ":8000";
  base = v;
  try { localStorage.setItem("robot", base); } catch {}
  connect();
  refreshInfo();
});
$("addr").value = base.replace(/^https?:\/\//, "");

// =====================================================================
// 실시간 연결
// =====================================================================
let es = null;
let spoken = false;
let greeted = false;
function setConn(on, text) {
  $("conn-dot").classList.toggle("on", on);
  $("conn-btn").setAttribute("aria-label", `기기 연결 (${text})`);
}
async function connect() {
  if (es) es.close();
  spoken = false;
  setConn(false, "연결 중");
  try { samples = await rpc("mood_history"); } catch { samples = []; }
  es = new EventSource(base + "/stream");
  es.onopen = () => setConn(true, "연결됨");
  es.onerror = () => setConn(false, "다시 연결 중");
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "home") return drawHome(msg.home);
    if (msg.type === "map") return window.MapView?.update(msg.map);
    if (msg.type === "rgame") return window.Play?.rgame(msg.rgame);
    if (msg.type === "ball") return window.Play?.ball(msg.ball);
    if (msg.pet) drawPet(msg.pet);
    if (msg.pet && !greeted) { greeted = true; act("hello"); }
    if (msg.state) {
      drawHistory(msg.state.history);
      const last = msg.state.history[msg.state.history.length - 1];
      if (!spoken && last && Date.now() / 1000 - last.t < 60) $("bubble").textContent = last.speech;
      spoken = true;
      if (msg.type === "feel") {
        playReaction(msg.reaction);
        say(msg.speech);
        if (last) eventFx(last.event);
      }
    }
    if (msg.type === "state" && msg.sample) {
      samples.push(msg.sample);
      if (samples.length > WINDOW) samples.shift();
      drawChart();
    }
  };
}

$("sound-btn").setAttribute("aria-pressed", String(Fx.soundOn));
$("sound-btn").textContent = Fx.soundOn ? "🔊" : "🔈";
$("sound-btn").addEventListener("click", () => {
  Fx.setSound(!Fx.soundOn);
  $("sound-btn").setAttribute("aria-pressed", String(Fx.soundOn));
  $("sound-btn").textContent = Fx.soundOn ? "🔊" : "🔈";
  Fx.sound("tap");
});
$("drive").addEventListener("change", (e) => rpc("drive", { enabled: e.target.checked }));
try { $("voice").checked = localStorage.getItem("voice") === "1"; } catch {}
$("voice").addEventListener("change", (e) => { try { localStorage.setItem("voice", e.target.checked ? "1" : "0"); } catch {} });

LedFace.init($("screen"));
connect();
