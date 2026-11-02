// 방 지도 탭: 스캔 결과를 위에서 본 지도와 사진 띠로 보여 주고, 누른 곳으로 로봇을 보낸다.
// 지도 좌표: 스캔한 자리가 (0,0), 처음 바라본 방향이 위(+y), 단위 cm. 각도는 왼쪽(반시계)이 +.
window.MapView = (() => {
  let info = null;
  let target = null;          // 화면에서 고른 목표 (아직 보내지 않음)
  let photoPin = null;        // { i, u, v } 사진 위에 찍은 점
  const OPEN_SHOW = 220;      // '트인 곳'은 지도에 이 거리까지만 그린다
  const deg = (r) => (r * 180) / Math.PI;
  const rad = (d) => (d * Math.PI) / 180;
  const wrap = (a) => ((a + 180) % 360 + 360) % 360 - 180;
  const toXY = (bearing, d) => ({ x: -d * Math.sin(rad(bearing)), y: d * Math.cos(rad(bearing)) });
  const busy = () => info && ["scanning", "turning", "moving"].includes(info.state);

  // 각 스캔 방향에서 갈 수 있는 거리 (벽 - 여유)
  function reach(f) {
    if (f.open) return OPEN_SHOW;
    return Math.max(0, f.dist - info.margin);
  }
  function sortedFrames() {
    return info.frames.slice().sort((a, b) => wrap(a.heading) - wrap(b.heading));
  }
  // 방향 θ에서 갈 수 있는 거리: 이웃한 두 스캔 방향 사이를 선형으로 잇는다
  function reachAt(theta) {
    const fs = sortedFrames();
    if (!fs.length) return 0;
    for (let k = 0; k < fs.length; k++) {
      const a = fs[k], b = fs[(k + 1) % fs.length];
      const span = wrap(b.heading - a.heading) || 360;
      const off = wrap(theta - a.heading);
      if (off >= 0 && off <= (span < 0 ? span + 360 : span)) {
        const t = off / (span < 0 ? span + 360 : span);
        return reach(a) * (1 - t) + reach(b) * t;
      }
    }
    return reach(fs[0]);
  }
  function clamp(p) {
    const r = Math.hypot(p.x, p.y);
    const theta = deg(Math.atan2(-p.x, p.y));
    const max = reachAt(theta);
    if (r <= max) return { ...p, clamped: false };
    const q = toXY(theta, max);
    return { x: q.x, y: q.y, clamped: true };
  }

  // ---------- 그리기 ----------
  function render() {
    if (!info || $("view-map").hidden) return;
    const has = info.frames.length > 0;
    $("map-empty").hidden = has;
    $("map-empty").classList.toggle("scanning", info.state === "scanning");
    $("map-wrap").hidden = !has;
    $("pano-box").hidden = !has;
    if (has) { drawMap(); drawPano(); }
    drawControls();
  }

  function drawMap() {
    const svg = $("map");
    svg.replaceChildren();
    const fs = sortedFrames();
    const pts = fs.map((f) => ({ f, ...toXY(f.heading, f.open ? OPEN_SHOW : f.dist) }));
    const xs = [0, info.pose.x, ...pts.map((p) => p.x)], ys = [0, info.pose.y, ...pts.map((p) => p.y)];
    if (target) { xs.push(target.x); ys.push(target.y); }
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const size = Math.max(maxX - minX, maxY - minY) + 90;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const vb = [cx - size / 2, -cy - size / 2, size, size];
    svg.setAttribute("viewBox", vb.join(" "));
    const k = size / 340;   // 화면 1px 이 몇 cm 인지 (글자·아이콘 크기용)

    // 50cm 격자, 1m 마다 진하게
    const g0 = Math.floor(vb[0] / 50) * 50, g1 = vb[0] + size;
    for (let v = g0; v <= g1; v += 50) el("line", { x1: v, x2: v, y1: vb[1], y2: vb[1] + size, class: v % 100 ? "g" : "g m" }, svg);
    const h0 = Math.floor(vb[1] / 50) * 50, h1 = vb[1] + size;
    for (let v = h0; v <= h1; v += 50) el("line", { y1: v, y2: v, x1: vb[0], x2: vb[0] + size, class: v % 100 ? "g" : "g m" }, svg);

    // 갈 수 있는 곳
    el("polygon", { points: pts.map((p) => `${p.x},${-p.y}`).join(" "), class: "free" }, svg);
    // 트인 방향
    pts.filter((p) => p.f.open).forEach((p) => el("line", { x1: 0, y1: 0, x2: p.x, y2: -p.y, class: "open-ray" }, svg));
    // 벽·물건: 이웃한 두 방향이 모두 막혀 있으면 선으로 잇는다
    let d = "";
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      if (!p.f.open && !q.f.open) d += `M${p.x} ${-p.y}L${q.x} ${-q.y}`;
      if (!p.f.open) el("circle", { cx: p.x, cy: -p.y, r: 3.5 * k, class: "wall-dot" }, svg);
    });
    el("path", { d, class: "wall" }, svg);
    // 스캔한 자리
    const o = 7 * k;
    el("path", { d: `M${-o} 0H${o}M0 ${-o}V${o}`, class: "origin" }, svg);

    // 목표와 경로
    const pose = info.pose;
    const goal = target || (busy() && info.target) || null;
    if (goal) {
      el("line", { x1: pose.x, y1: -pose.y, x2: goal.x, y2: -goal.y, class: "path" }, svg);
      el("circle", { cx: goal.x, cy: -goal.y, r: 16 * k, class: "pin-ring" }, svg);
      el("circle", { cx: goal.x, cy: -goal.y, r: 7 * k, class: "pin" }, svg);
    }
    // 로봇
    const r = el("g", { transform: `translate(${pose.x} ${-pose.y}) rotate(${-pose.heading})` }, svg);
    el("circle", { r: 26 * k, class: "robot-glow" }, r);
    el("rect", { x: -11 * k, y: -14 * k, width: 22 * k, height: 28 * k, rx: 6 * k, class: "robot-body" }, r);
    el("path", { d: `M0 ${-11 * k}L${5 * k} ${-4 * k}H${-5 * k}Z`, class: "robot-nose" }, r);
    // 1m 축척
    const sx = vb[0] + 16 * k, sy = vb[1] + size - 16 * k;
    el("path", { d: `M${sx} ${sy - 5 * k}V${sy}H${sx + 100}V${sy - 5 * k}`, class: "wall", style: "stroke-width:1.5" }, svg);
    el("text", { x: sx + 50, y: sy - 8 * k, "text-anchor": "middle", class: "scale", style: `font-size:${12 * k}px` }, svg).textContent = "1m";
  }

  function drawPano() {
    const box = $("pano");
    const fs = info.frames.slice().sort((a, b) => wrap(b.heading) - wrap(a.heading));
    const key = `${info.scanned_at}:${fs.length}`;
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.replaceChildren(...fs.map((f) => {
        const fig = document.createElement("figure");
        fig.className = "shot";
        fig.dataset.i = f.i;
        const img = document.createElement("img");
        img.alt = `${label(f.heading)} 방향 사진`;
        if (f.photo) img.src = `${base}/scan/${f.i}.jpg?v=${info.scanned_at}`;
        const hz = document.createElement("span");
        hz.className = "horizon";
        hz.style.top = `${(0.5 - info.camera.tilt / info.camera.vfov) * 100}%`;
        const cap = document.createElement("figcaption");
        cap.innerHTML = `<b></b><span></span>`;
        cap.firstChild.textContent = label(f.heading);
        cap.lastChild.textContent = f.open ? "트임" : `벽 ${Math.round(f.dist)}cm`;
        fig.append(img, hz, cap);
        fig.addEventListener("click", (e) => pickPhoto(f, img, e));
        return fig;
      }));
    }
    box.querySelectorAll(".shot-pin").forEach((p) => p.remove());
    if (photoPin) {
      const fig = box.querySelector(`.shot[data-i="${photoPin.i}"]`);
      if (fig) {
        const pin = document.createElement("span");
        pin.className = "shot-pin";
        pin.style.left = `${photoPin.u * 100}%`;
        pin.style.top = `${photoPin.v * fig.querySelector("img").offsetHeight}px`;
        fig.appendChild(pin);
      }
    }
  }

  function label(h) {
    const a = Math.round(wrap(h));
    if (Math.abs(a) <= 10) return "정면";
    if (Math.abs(a) >= 170) return "뒤";
    return a > 0 ? `왼쪽 ${a}°` : `오른쪽 ${-a}°`;
  }

  function drawControls() {
    const st = info.state;
    const moving = busy();
    const chip = $("map-chip");
    const CHIP = { empty: "스캔 전", scanning: "스캔 중…", ready: "준비됨", turning: "방향 맞추는 중", moving: "이동 중",
      arrived: "도착!", blocked: "막혔어요" };
    chip.textContent = (CHIP[st] || st) + (info.simulated ? " · 흉내" : "");
    chip.className = "chip " + (st === "blocked" ? "warn" : st === "empty" ? "idle" : "");
    const has = info.frames.length > 0;
    $("map-scan").textContent = has ? "🔍 다시 스캔" : st === "scanning" ? "🔍 스캔 중…" : "🔍 방 스캔하기";
    $("map-scan").classList.toggle("primary", !has);
    $("map-scan").disabled = moving;
    $("map-go").disabled = moving || !target;
    $("map-go").hidden = moving || !has;
    document.querySelector(".map-actions").classList.toggle("solo", !has && !moving);
    $("map-stop").hidden = !moving;
    $("map-bar").style.width = `${Math.round((info.progress || 0) * 100)}%`;
    if (moving || ["arrived", "blocked"].includes(st) || !target) {
      $("map-target").textContent = st === "empty" ? ""
        : moving || st !== "ready" ? info.message
        : info.frames.length ? "👆 지도나 사진에서 갈 곳을 눌러 주세요" : "";
    } else {
      describeTarget();
    }
  }

  function describeTarget() {
    const p = info.pose;
    const dx = target.x - p.x, dy = target.y - p.y;
    const dist = Math.hypot(dx, dy);
    const turn = Math.round(wrap(deg(Math.atan2(-dx, dy)) - p.heading));
    const dir = Math.abs(turn) <= 5 ? "앞으로" : turn > 0 ? `왼쪽으로 ${turn}° 돌아` : `오른쪽으로 ${-turn}° 돌아`;
    const len = dist >= 100 ? `${(dist / 100).toFixed(1)}m` : `${Math.round(dist)}cm`;
    $("map-target").textContent = `📍 ${dir} ${len}` + (target.clamped ? " (벽 앞까지)" : "");
  }

  // ---------- 고르기 ----------
  function setTarget(p, pin = null) {
    if (busy()) return;
    target = clamp(p);
    photoPin = pin;
    Fx.sound("tap");
    Fx.buzz(8);
    render();
  }

  $("map").addEventListener("click", (e) => {
    if (!info?.frames.length) return;
    const svg = $("map");
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const w = pt.matrixTransform(svg.getScreenCTM().inverse());
    setTarget({ x: w.x, y: -w.y });
  });

  // 사진 속 바닥을 누르면: 카메라 높이·숙인 각도로 그 바닥까지 거리를 계산한다
  function pickPhoto(f, img, e) {
    const rect = img.getBoundingClientRect();
    const u = (e.clientX - rect.left) / rect.width;
    const v = (e.clientY - rect.top) / rect.height;
    const cam = info.camera;
    const bearing = f.heading - (u - 0.5) * cam.hfov;
    const down = cam.tilt + (v - 0.5) * cam.vfov;     // 수평보다 몇 도 아래를 봤나
    let dist = down > 1.5 ? cam.height / Math.tan(rad(down)) : Infinity;
    if (!isFinite(dist)) {
      toast("바닥이 아닌 곳이에요. 그 방향 벽 앞까지 갈게요");
    }
    dist = Math.min(dist, 400);
    setTarget(toXY(bearing, dist), { i: f.i, u, v });
  }

  // ---------- 버튼 ----------
  $("map-scan").addEventListener("click", async () => {
    target = null; photoPin = null;
    const r = await act("scan");
    if (r.ok) Fx.sound("scan");
  });
  $("map-go").addEventListener("click", async () => {
    if (!target) return;
    const r = await act("goto", { x: Math.round(target.x), y: Math.round(target.y) });
    if (r.ok) { target = null; photoPin = null; }
  });
  $("map-stop").addEventListener("click", () => rpc("map_cancel").catch(() => {}));
  window.addEventListener("resize", () => drawPano());

  function update(next) {
    info = next;
    render();
  }
  async function show() {
    if (!info) { try { info = await rpc("map"); } catch { return; } }
    render();
  }

  if (location.hash === "#room") showTab("map");
  return { update, show };
})();
