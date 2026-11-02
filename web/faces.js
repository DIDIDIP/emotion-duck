// LED 화면 표정: 왼쪽 눈을 9×8 점으로 그린다. 오른쪽 눈은 좌우를 뒤집어 쓴다.
// X = 켜진 점, . = 꺼진 점
const EYES = {
  normal: [
    "..XXXXX..",
    ".XXXXXXX.",
    "XXXXXXXXX",
    "XXXXXXXXX",
    "XXXXXXXXX",
    "XXXXXXXXX",
    ".XXXXXXX.",
    "..XXXXX..",
  ],
  love: [
    ".XX...XX.",
    "XXXX.XXXX",
    "XXXXXXXXX",
    "XXXXXXXXX",
    ".XXXXXXX.",
    "..XXXXX..",
    "...XXX...",
    "....X....",
  ],
  happy: [
    ".........",
    ".........",
    "...XXX...",
    "..XXXXX..",
    ".XX...XX.",
    "XX.....XX",
    "X.......X",
    ".........",
  ],
  smile: [
    ".........",
    "..XXXXX..",
    ".XXXXXXX.",
    "XXXXXXXXX",
    "XXXXXXXXX",
    "XXX...XXX",
    "X.......X",
    ".........",
  ],
  sad: [
    ".........",
    "......XXX",
    "....XXXXX",
    "..XXXXXXX",
    "XXXXXXXXX",
    "XXXXXXXXX",
    ".XXXXXXX.",
    "..XXXXX..",
  ],
  angry: [
    "XXX......",
    "XXXXX....",
    "XXXXXXX..",
    "XXXXXXXXX",
    "XXXXXXXXX",
    "XXXXXXXXX",
    ".XXXXXXX.",
    "..XXXXX..",
  ],
  surprised: [
    "..XXXXX..",
    ".XX...XX.",
    "XX.....XX",
    "XX.....XX",
    "XX.....XX",
    "XX.....XX",
    ".XX...XX.",
    "..XXXXX..",
  ],
  sleepy: [
    ".........",
    ".........",
    ".........",
    ".........",
    "XXXXXXXXX",
    "XXXXXXXXX",
    ".XXXXXXX.",
    ".........",
  ],
  sleep: [
    ".........",
    ".........",
    ".........",
    ".........",
    "X.......X",
    ".XX...XX.",
    "...XXX...",
    ".........",
  ],
  tired: [
    ".........",
    ".........",
    ".........",
    ".........",
    ".........",
    "XXXXXXXXX",
    "XXXXXXXXX",
    ".........",
  ],
  blink: [
    ".........",
    ".........",
    ".........",
    ".........",
    ".........",
    ".........",
    "XXXXXXXXX",
    ".........",
  ],
};
EYES.yum = EYES.happy;

// 꾸미기 '볼' 장식: [x, y, 색 클래스]
const CHEEKS = {
  none: [],
  blush: [[3, 11, "c-blush"], [4, 11, "c-blush"], [5, 11, "c-blush"], [4, 12, "c-blush"],
          [26, 11, "c-blush"], [27, 11, "c-blush"], [28, 11, "c-blush"], [27, 12, "c-blush"]],
  sparkle: [[1, 0, "c-spark"], [0, 1, "c-spark"], [1, 1, "c-spark"], [2, 1, "c-spark"], [1, 2, "c-spark"],
            [30, 11, "c-spark"], [29, 12, "c-spark"], [30, 12, "c-spark"], [31, 12, "c-spark"], [30, 13, "c-spark"]],
};

// 무지개 빛일 때 쓰는 점마다의 색상(가로 위치로 정한다)
function hueOf(x) { return Math.round((x / 32) * 300); }

// 자는 얼굴 오른쪽 위에 작은 z
const ZZZ = [[25, 1], [26, 1], [27, 1], [28, 1], [28, 2], [27, 3], [26, 4], [25, 5], [26, 5], [27, 5], [28, 5]];

const LedFace = (() => {
  const W = 32, H = 14, LEFT = 4, RIGHT = 19, TOP = 3;
  const ns = "http://www.w3.org/2000/svg";
  let svg, pixels = [];
  let face = "normal", dx = 0, blinking = false, cheek = "none";

  function init(el) {
    svg = el;
    const defs = document.createElementNS(ns, "defs");
    defs.innerHTML = '<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">' +
      '<feGaussianBlur stdDeviation="0.35" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    svg.appendChild(defs);
    const g = document.createElementNS(ns, "g");
    g.setAttribute("filter", "url(#glow)");
    svg.appendChild(g);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = document.createElementNS(ns, "rect");
        r.setAttribute("x", x + 0.1); r.setAttribute("y", y + 0.1);
        r.setAttribute("width", 0.8); r.setAttribute("height", 0.8); r.setAttribute("rx", 0.15);
        r.setAttribute("class", "px");
        r.style.setProperty("--h", hueOf(x));
        g.appendChild(r);
        pixels.push(r);
      }
    }
    draw();
    idle();
  }

  function draw() {
    const on = new Set();
    const bmp = EYES[blinking ? "blink" : face] || EYES.normal;
    const mirror = ["sad", "angry"].includes(face) && !blinking;
    bmp.forEach((row, y) => {
      for (let x = 0; x < 9; x++) {
        if (row[x] === "X") on.add((TOP + y) * W + LEFT + x + dx);
        const rx = mirror ? 8 - x : x;
        if (row[rx] === "X") on.add((TOP + y) * W + RIGHT + x + dx);
      }
    });
    if (face === "sleep") ZZZ.forEach(([x, y]) => on.add(y * W + x));
    const extra = new Map((CHEEKS[cheek] || []).map(([x, y, c]) => [y * W + x, c]));
    pixels.forEach((p, i) => {
      p.classList.toggle("on", on.has(i) || extra.has(i));
      p.classList.toggle("c-blush", extra.get(i) === "c-blush" && !on.has(i));
      p.classList.toggle("c-spark", extra.get(i) === "c-spark" && !on.has(i));
    });
  }

  function setCheek(name) {
    if (name === cheek) return;
    cheek = name;
    if (svg) draw();
  }

  // 가끔 깜빡이고 두리번거린다 (자거나 하트일 때는 가만히)
  function idle() {
    const still = ["sleep", "love", "happy", "yum", "tired"].includes(face);
    if (!still && Math.random() < 0.5) {
      blinking = true; draw();
      setTimeout(() => { blinking = false; draw(); }, 140);
    } else if (!still && Math.random() < 0.5) {
      dx = [-1, 0, 1][Math.floor(Math.random() * 3)];
      draw();
    }
    setTimeout(idle, 1800 + Math.random() * 2500);
  }

  function set(name) {
    if (name === face) return;
    face = name;
    dx = 0;
    blinking = false;
    draw();
  }

  return { init, set, setCheek };
})();

// 게임 창처럼 움직이지 않는 작은 얼굴을 그릴 때
function paintFace(svg, name, cheek = "none") {
  const W = 32, H = 14, LEFT = 4, RIGHT = 19, TOP = 3;
  if (!svg._px) {
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg._px = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", x + 0.1); r.setAttribute("y", y + 0.1);
      r.setAttribute("width", 0.8); r.setAttribute("height", 0.8); r.setAttribute("rx", 0.15);
      r.setAttribute("class", "px");
      r.style.setProperty("--h", hueOf(x));
      svg.appendChild(r);
      svg._px.push(r);
    }
  }
  const bmp = EYES[name] || EYES.normal;
  const mirror = ["sad", "angry"].includes(name);
  const on = new Set();
  bmp.forEach((row, y) => {
    for (let x = 0; x < 9; x++) {
      if (row[x] === "X") on.add((TOP + y) * W + LEFT + x);
      if (row[mirror ? 8 - x : x] === "X") on.add((TOP + y) * W + RIGHT + x);
    }
  });
  if (name === "sleep") ZZZ.forEach(([x, y]) => on.add(y * W + x));
  const extra = new Map((CHEEKS[cheek] || []).map(([x, y, c]) => [y * W + x, c]));
  svg._px.forEach((p, i) => {
    p.classList.toggle("on", on.has(i) || extra.has(i));
    p.classList.toggle("c-blush", extra.get(i) === "c-blush" && !on.has(i));
    p.classList.toggle("c-spark", extra.get(i) === "c-spark" && !on.has(i));
  });
}
