// 효과: 파티클(하트·반짝이·부스러기·Zzz), 색종이, 효과음, 진동
const Fx = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let soundOn = true;
  try { soundOn = localStorage.getItem("sound") !== "0"; } catch {}
  let ctx = null;

  // ---------- 파티클 ----------
  const SETS = {
    love: ["💗", "💕", "💖"],
    yum: ["🍪", "✨", "😋"],
    happy: ["✨", "⭐", "🎉"],
    sad: ["💧"],
    zzz: ["💤"],
    note: ["🎵", "🎶"],
    spark: ["✨"],
  };
  function burst(kind, count = 6) {
    if (reduce) return;
    const layer = document.getElementById("fx");
    const set = SETS[kind] || SETS.spark;
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "particle";
      p.textContent = set[i % set.length];
      p.style.left = `${30 + Math.random() * 40}%`;
      p.style.top = `${35 + Math.random() * 25}%`;
      p.style.setProperty("--dx", `${(Math.random() - 0.5) * 140}px`);
      p.style.setProperty("--dy", `${-80 - Math.random() * 80}px`);
      p.style.setProperty("--rot", `${(Math.random() - 0.5) * 60}deg`);
      p.style.animationDelay = `${i * 60}ms`;
      p.style.fontSize = `${18 + Math.random() * 14}px`;
      layer.appendChild(p);
      setTimeout(() => p.remove(), 1800 + i * 60);
    }
  }

  function confetti() {
    if (reduce) return;
    const layer = document.getElementById("confetti");
    const colors = ["#f26d8f", "#f6b93b", "#5b8def", "#1fb39b", "#8a6cf0", "#ff7a5c"];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement("i");
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = `${Math.random() * 400}ms`;
      c.style.animationDuration = `${1600 + Math.random() * 1200}ms`;
      c.style.setProperty("--drift", `${(Math.random() - 0.5) * 200}px`);
      c.style.setProperty("--spin", `${Math.random() * 900}deg`);
      layer.appendChild(c);
      setTimeout(() => c.remove(), 3200);
    }
  }

  // ---------- 효과음 (Web Audio로 직접 합성, 파일 없음) ----------
  function tone(freqs, { dur = 0.09, gap = 0.02, type = "sine", vol = 0.12 } = {}) {
    if (!soundOn) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      let t = ctx.currentTime;
      for (const f of freqs) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
        t += dur + gap;
      }
    } catch {}
  }
  const SOUNDS = {
    pet: () => tone([880, 1175], { dur: 0.08 }),
    snack: () => tone([660, 520, 660, 880], { dur: 0.05, type: "square", vol: 0.05 }),
    happy: () => tone([784, 988, 1175], { dur: 0.07 }),
    sad: () => tone([440, 370, 311], { dur: 0.14, type: "triangle" }),
    sleep: () => tone([523, 440, 349], { dur: 0.18, type: "triangle", vol: 0.08 }),
    wake: () => tone([392, 523, 659, 784], { dur: 0.07 }),
    level: () => tone([523, 659, 784, 1047, 1319], { dur: 0.09, vol: 0.14 }),
    error: () => tone([220, 196], { dur: 0.12, type: "triangle", vol: 0.1 }),
    tap: () => tone([1400], { dur: 0.03, vol: 0.04 }),
    scan: () => tone([600, 900, 1200], { dur: 0.06, type: "sine", vol: 0.06 }),
  };
  function sound(name) { SOUNDS[name]?.(); }

  function buzz(ms = 12) { try { navigator.vibrate?.(ms); } catch {} }

  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem("sound", on ? "1" : "0"); } catch {}
  }

  return { burst, confetti, sound, buzz, setSound, get soundOn() { return soundOn; } };
})();
