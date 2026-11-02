// 꾸미기: 레벨업 선물 상자, 옷장(아이템 고르기), 고른 모습을 화면에 입히기
window.Closet = (() => {
  // 아이템 모양 (이름·열리는 레벨은 서버 game.py 의 ITEMS)
  const LED = { white: "#f4fbff", mint: "#7dffd8", pink: "#ff9cc8", yellow: "#ffe27a", rainbow: null };
  const BODY = {
    charcoal: null,   // 기본: 테마(밝음/어두움) 색을 그대로 쓴다
    cream: ["#f6e7c8", "#d8c096"], sky: ["#a6d4ff", "#5d9de0"],
    berry: ["#ffa3b8", "#e0587b"], gold: ["#ffe08a", "#d4a21c"],
  };
  const HAT = { none: "", ribbon: "🎀", cap: "🧢", flower: "🌸", headphones: "🎧", crown: "👑" };
  const THEME_SWATCH = {
    default: "linear-gradient(135deg, #f7e4ec, #fbefe9)", sakura: "linear-gradient(135deg, #ffd6e4, #fff0f5)",
    night: "linear-gradient(135deg, #2e2a5c, #141a33)", ocean: "linear-gradient(135deg, #a8e0ff, #e6f7ff)",
  };
  const SLOT_ICON = { led: "💡", body: "🎨", hat: "🎀", cheek: "✨", theme: "🖼️" };

  let pet = null;
  let slot = "hat";
  let look = null;

  // ---------- 모습 입히기 ----------
  function apply(l) {
    if (look && JSON.stringify(look) === JSON.stringify(l)) return;
    look = l;
    const root = document.documentElement.style;
    if (LED[l.led]) root.setProperty("--led-on", LED[l.led]); else root.removeProperty("--led-on");
    document.querySelectorAll("svg#screen, svg#screen-prev, .mini-device svg").forEach((s) => s.classList.toggle("rainbow", l.led === "rainbow"));
    document.body.classList.toggle("led-rainbow", l.led === "rainbow");
    const body = BODY[l.body];
    if (body) { root.setProperty("--bezel-hi", body[0]); root.setProperty("--bezel", body[1]); }
    else { root.removeProperty("--bezel-hi"); root.removeProperty("--bezel"); }
    document.querySelectorAll(".hat").forEach((h) => { h.textContent = HAT[l.hat] || ""; h.dataset.hat = l.hat; });
    LedFace.setCheek(l.cheek);
    document.body.dataset.skin = l.theme;
    paintPreview();
  }

  function paintPreview() {
    const svg = $("screen-prev");
    if (!svg || !look) return;
    paintFace(svg, "love", look.cheek);
    svg.classList.toggle("rainbow", look.led === "rainbow");
  }

  // ---------- 옷장 ----------
  function update(p) {
    pet = p;
    apply(p.look);
    $("closet-dot").hidden = !p.closet.some((c) => c.new);
    if ($("closet").open) render();
  }

  function visual(c) {
    const v = document.createElement("span");
    v.className = "i-vis";
    if (c.slot === "led") {
      v.classList.add("dot-vis");
      v.style.background = LED[c.id] || "conic-gradient(#ff6b6b, #ffd93d, #6bff95, #6bc5ff, #b06bff, #ff6b6b)";
    } else if (c.slot === "body") {
      v.classList.add("body-vis");
      const b = BODY[c.id] || ["#55545c", "#3b3a40"];
      v.style.background = `linear-gradient(180deg, ${b[0]}, ${b[1]})`;
    } else if (c.slot === "hat") {
      v.textContent = HAT[c.id] || "🚫";
    } else if (c.slot === "cheek") {
      v.textContent = { none: "🚫", blush: "😊", sparkle: "✨" }[c.id];
    } else if (c.slot === "theme") {
      v.classList.add("theme-vis");
      v.style.background = THEME_SWATCH[c.id];
    }
    return v;
  }

  function render() {
    if (!pet) return;
    const tabs = $("slot-tabs");
    tabs.replaceChildren(...Object.entries(pet.slot_names).map(([k, name]) => {
      const b = document.createElement("button");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(k === slot));
      const hasNew = pet.closet.some((c) => c.slot === k && c.new);
      b.innerHTML = `<span aria-hidden="true">${SLOT_ICON[k]}</span> ${name}${hasNew ? '<i class="new-dot" aria-label="새 아이템"></i>' : ""}`;
      b.addEventListener("click", () => { slot = k; Fx.sound("tap"); render(); });
      return b;
    }));
    const items = pet.closet.filter((c) => c.slot === slot);
    $("items").replaceChildren(...items.map((c) => {
      const on = pet.look[c.slot] === c.id;
      const b = document.createElement("button");
      b.className = "item" + (c.unlocked ? "" : " locked") + (on ? " on" : "");
      b.setAttribute("aria-pressed", String(on));
      b.append(visual(c));
      const name = document.createElement("b");
      name.textContent = c.name;
      const sub = document.createElement("span");
      sub.className = "i-sub";
      sub.textContent = on ? "✓ 착용 중" : c.unlocked ? "입어 보기" : `🔒 Lv${c.level}`;
      b.append(name, sub);
      if (c.new) { const n = document.createElement("i"); n.className = "new-badge"; n.textContent = "NEW"; b.append(n); }
      b.addEventListener("click", () => equip(c));
      return b;
    }));
    const next = pet.closet.filter((c) => !c.unlocked).sort((a, b) => a.level - b.level)[0];
    $("closet-hint").textContent = next
      ? `다음 선물: Lv${next.level}에 "${next.name}" 외 ${pet.closet.filter((c) => c.level === next.level).length - 1}개`
      : "모든 아이템을 모았어요! 🎉";
    paintPreview();
  }

  async function equip(c) {
    if (!c.unlocked) { toast(`Lv${c.level}이 되면 선물로 받아요`); Fx.sound("error"); return; }
    if (pet.look[c.slot] === c.id) return;
    // 바로 입혀 보이고, 서버 저장은 뒤따른다
    apply({ ...pet.look, [c.slot]: c.id });
    pet = { ...pet, look: { ...pet.look, [c.slot]: c.id }, closet: pet.closet.map((x) => (x === c ? { ...x, new: false } : x)) };
    render();
    Fx.sound("happy");
    await act("equip", { slot: c.slot, item: c.id });
  }

  $("closet-btn").addEventListener("click", () => {
    if (pet) {
      const firstNew = pet.closet.find((c) => c.new);
      if (firstNew) slot = firstNew.slot;
    }
    render();
    $("closet").showModal();
    Fx.sound("tap");
  });
  $("closet").addEventListener("close", () => {
    if (pet?.closet.some((c) => c.new)) act("seen_items");
  });

  // ---------- 레벨업 선물 상자 ----------
  function gift(p) {
    const gifts = p.closet.filter((c) => c.level === p.level);
    $("gift").hidden = !gifts.length;
    $("gift-items").hidden = true;
    $("gift-actions").hidden = true;
    $("gift-box").classList.remove("opened");
    if (!gifts.length) return false;
    $("gift-box").onclick = () => {
      $("gift-box").classList.add("opened");
      Fx.sound("level");
      Fx.confetti();
      setTimeout(() => {
        $("gift").hidden = true;
        $("gift-items").replaceChildren(...gifts.map((c) => {
          const d = document.createElement("div");
          d.className = "gift-item";
          d.append(visual(c));
          const n = document.createElement("b");
          n.textContent = c.name;
          const s = document.createElement("span");
          s.textContent = p.slot_names[c.slot];
          d.append(n, s);
          return d;
        }));
        $("gift-items").hidden = false;
        $("gift-actions").hidden = false;
      }, 450);
    };
    $("gift-wear").onclick = async () => {
      for (const c of gifts) await act("equip", { slot: c.slot, item: c.id });
      $("levelup").hidden = true;
    };
    $("gift-closet").onclick = () => {
      $("levelup").hidden = true;
      slot = gifts[0].slot;
      render();
      $("closet").showModal();
    };
    return true;
  }

  return { update, gift };
})();
