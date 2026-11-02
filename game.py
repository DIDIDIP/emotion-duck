"""키우기 게임: 행복·에너지·레벨을 관리하고, 행동(쓰다듬기, 간식, 재우기, 가위바위보, 이리 와)을 처리한다.

규칙
  - 행복은 시간이 지나면 조금씩 줄고, 쓰다듬기·간식·놀이로 오른다.
  - 에너지는 놀면 줄고, 재우면 차오른다. 너무 적으면 놀자고 해도 졸려서 거절한다.
  - 행동을 하면 경험치가 쌓이고, 레벨이 오르면 새 기능이 열린다 (가위바위보 Lv5, 이리 와 Lv7).
  - 간식은 하루 3번까지.
  - 레벨이 오르면 꾸미기 아이템(화면 빛, 몸 색, 머리 장식, 볼, 배경)을 선물로 받고, 옷장에서 골라 입힌다.
  - 호감도(0~100)는 미니게임·가위바위보·매일 첫 인사로 오른다. 게임별 보상은 하루 3번까지.
    호감도 단계: 낯가림 → 아는 사이 → 친구 → 단짝 → 베프 → 소울메이트
진행 상황은 pet.json에 저장되어 서버를 껐다 켜도 이어진다.
"""
import json
import random
import threading
import time
from datetime import date
from pathlib import Path

SAVE_FILE = Path(__file__).parent / "pet.json"

UNLOCK = {"rps": 5, "come": 7}            # 기능별로 열리는 레벨
SNACKS_PER_DAY = 3
PET_COOLDOWN = 2.0                         # 쓰다듬기 연타 방지(초)
HAPPY_DECAY_EVERY = 90                     # 이 초마다 행복 -1
ENERGY_DECAY_EVERY = 180                   # 깨어 있으면 이 초마다 에너지 -1
SLEEP_RECOVER_EVERY = 2                    # 자는 동안 이 초마다 에너지 +1
TIRED = 15                                 # 에너지가 이보다 적으면 놀이 거절
FACE_HOLD = 4.0                            # 행동 뒤 특별한 표정을 유지하는 시간(초)

# 행동별 (행복, 에너지, 경험치) 변화
EFFECTS = {
    "pet":   (+4, 0, 3),
    "snack": (+15, +10, 15),
    "rps":   (+6, -8, 10),
    "come":  (+5, -15, 20),
    "wake":  (0, 0, 10),
    "gesture": (+3, 0, 3),
    "scan":  (+3, -10, 15),
    "goto":  (+4, -8, 10),
    "minigame": (+6, -5, 14),   # 점수 비율만큼 행복·경험치를 준다
}

GAMES = {"mugunghwa": "무궁화 꽃이 피었습니다", "dance": "따라 춤추기", "fetch": "공 찾아오기"}   # 로봇이 직접 하는 놀이 (robotgames.py)
GAME_REWARDS_PER_DAY = 3
TITLES = [(0, "낯가림"), (15, "아는 사이"), (35, "친구"), (55, "단짝"), (75, "베프"), (92, "소울메이트")]
HELLO = {   # 호감도 단계별 첫인사
    "낯가림": "어… 안녕? 아직 조금 낯설어",
    "아는 사이": "안녕! 또 왔네?",
    "친구": "왔구나! 오늘 뭐 하고 놀까?",
    "단짝": "보고 싶었어! 💕",
    "베프": "기다리고 있었어! 오늘도 같이 놀자 💕",
    "소울메이트": "너만 기다렸어! 세상에서 제일 좋아 💖",
}
HELLO_EVERY = 600       # 인사는 10분에 한 번만

# 꾸미기 아이템: 슬롯 → [(아이디, 이름, 열리는 레벨)]. 모양·색은 앱(web/closet.js)이 그린다
ITEMS = {
    "led":   [("white", "하얀 빛", 1), ("mint", "민트 빛", 2), ("pink", "분홍 빛", 3),
              ("yellow", "햇살 빛", 6), ("rainbow", "무지개 빛", 10)],
    "body":  [("charcoal", "차콜", 1), ("cream", "크림", 2), ("sky", "하늘", 4),
              ("berry", "딸기", 5), ("gold", "황금", 9)],
    "hat":   [("none", "없음", 1), ("ribbon", "리본", 2), ("cap", "모자", 3), ("flower", "꽃핀", 4),
              ("headphones", "헤드폰", 5), ("crown", "왕관", 8)],
    "cheek": [("none", "없음", 1), ("blush", "발그레", 3), ("sparkle", "반짝반짝", 7)],
    "theme": [("default", "기본", 1), ("sakura", "벚꽃", 4), ("night", "밤하늘", 6), ("ocean", "바다", 8)],
}
SLOT_NAMES = {"led": "화면 빛", "body": "몸 색", "hat": "머리 장식", "cheek": "볼", "theme": "배경"}
DEFAULT_LOOK = {slot: items[0][0] for slot, items in ITEMS.items()}


def item_level(slot, item):
    return next((lv for i, _, lv in ITEMS.get(slot, []) if i == item), None)


def iya(word):
    """받침이 있으면 '이야', 없으면 '야' (단짝이야 / 친구야)"""
    code = ord(word[-1]) - 0xAC00
    return word + ("이야" if 0 <= code < 11172 and code % 28 else "야")


def title_of(affection):
    i = max(k for k, (at, _) in enumerate(TITLES) if affection >= at)
    at, name = TITLES[i]
    nxt = TITLES[i + 1] if i + 1 < len(TITLES) else None
    return {"title": name, "tier": i, "at": at, "next_title": nxt and nxt[1], "next_at": nxt and nxt[0]}

HANDS = {"rock": "✊ 바위", "scissors": "✌️ 가위", "paper": "🖐 보"}
BEATS = {"rock": "scissors", "scissors": "paper", "paper": "rock"}
GESTURES = {   # 손짓 인식 코드가 보내는 이름 → 감정 사건
    "wave": "wave", "thumbs_up": "thumbs_up", "palm": "wave",
}

# 감정 엔진의 표정 → 화면 표정
FACE_FROM_MOOD = {"joy": "happy", "content": "smile", "surprised": "surprised",
                  "angry": "angry", "sad": "sad", "sleepy": "sleepy", "neutral": "normal"}
LABELS = {
    "love": ("🥰", "사랑"), "happy": ("😆", "신남"), "smile": ("😊", "기분 좋음"),
    "normal": ("🙂", "보통"), "sad": ("😢", "슬픔"), "angry": ("😤", "속상"),
    "surprised": ("😲", "놀람"), "sleepy": ("😪", "졸림"), "sleep": ("💤", "쿨쿨"),
    "tired": ("🥱", "피곤"), "yum": ("😋", "냠냠"),
}


def xp_to_next(level):
    return 20 * level


class PetGame:
    def __init__(self, engine, home, room, on_change, xp_boost=1):
        self.engine = engine
        self.home = home
        self.room = room
        self.robotgames = None             # server.py 가 RobotGames 를 만들어 넣는다
        self.on_change = on_change         # 상태가 바뀌면 앱에 알리기
        self.xp_boost = xp_boost           # 발표 시연용: 경험치 배수
        self.lock = threading.RLock()
        self.face_override = None          # (표정, 끝나는 시각)
        self.rps_open_until = 0            # 손짓으로 가위바위보를 낼 수 있는 시간
        self.last_gesture = None
        self.last_pet = 0
        self.last_lonely = 0
        self.last_hello = 0
        self._acc = {"happy": 0.0, "energy": 0.0}
        self.s = self._load()

    # ---------- 앱에 보내는 상태 ----------
    def snapshot(self):
        with self.lock:
            s = self.s
            self._new_day()
            face = self._face()
            emoji, label = LABELS[face]
            return {
                "name": s["name"], "level": s["level"], "xp": s["xp"], "xp_next": xp_to_next(s["level"]),
                "happy": round(s["happy"]), "energy": round(s["energy"]),
                "sleeping": s["sleeping"], "snacks_left": SNACKS_PER_DAY - s["snacks_today"],
                "unlock": UNLOCK, "face": face, "emoji": emoji, "label": label,
                "rps_open": time.time() < self.rps_open_until and not s["sleeping"],
                "gesture": self.last_gesture,
                "affection": round(s["affection"]), **title_of(s["affection"]),
                "look": s["look"],
                "closet": [{"slot": slot, "id": i, "name": n, "level": lv, "unlocked": s["level"] >= lv,
                            "new": f"{slot}:{i}" in s["new_items"]} for slot, items in ITEMS.items() for i, n, lv in items],
                "slot_names": SLOT_NAMES,
                "games": {g: {"name": n, "left": max(0, GAME_REWARDS_PER_DAY - s["game_plays"].get(g, 0)),
                              "best": s["best"].get(g, 0)} for g, n in GAMES.items()},
            }

    # ---------- 행동 ----------
    def act(self, action, **params):
        with self.lock:
            if action == "hello":
                result = self._do_hello()
                self._save()
                return result
            if self.s["sleeping"] and action not in ("pet", "wake", "sleep", "rename", "equip", "seen_items"):
                return self._result(False, "쿨쿨 자는 중이에요. 화면을 눌러 깨워 주세요")
            handler = getattr(self, "_do_" + action, None)
            if handler is None:
                raise ValueError(f"모르는 행동: {action}")
            result = handler(**params)
            self._save()
        self.on_change(self.snapshot())
        return result

    def _do_pet(self):
        if self.s["sleeping"]:
            return self._do_wake()
        now = time.time()
        if now - self.last_pet < PET_COOLDOWN:
            self._hold("love")
            return self._result(True, None)
        self.last_pet = now
        self._apply("pet")
        self._hold("love")
        self.engine.feel("pet", source="앱")
        return self._result(True, "쓰담쓰담 💕")

    def _do_snack(self):
        if self.s["snacks_today"] >= SNACKS_PER_DAY:
            self._hold("sad")
            self.engine.feel("lonely", source="앱", speech="오늘 간식은 다 먹었어… 내일 또 줘!")
            return self._result(False, "오늘 간식은 다 먹었어요")
        self.s["snacks_today"] += 1
        self._apply("snack")
        self._hold("yum")
        self.engine.feel("snack", source="앱")
        return self._result(True, "냠냠! 맛있다 🍪")

    def _do_sleep(self):
        if self.s["sleeping"]:
            return self._do_wake()
        self.s["sleeping"] = True
        self.face_override = None
        self.rps_open_until = 0
        self.engine.feel("sleep_now", source="앱")
        return self._result(True, "잘 자… Zzz")

    def _do_wake(self):
        self.s["sleeping"] = False
        rested = self.s["energy"] >= 90
        self._apply("wake" if rested else "gesture")
        self._hold("happy" if rested else "sleepy")
        self.engine.feel("wake", source="앱", speech=None if rested else "음냐… 아직 졸린데…")
        return self._result(True, "하암~ 잘 잤다!" if rested else "음냐… 아직 졸린데…")

    def _do_rps(self, hand=None):
        if self.s["level"] < UNLOCK["rps"]:
            return self._result(False, f"가위바위보는 Lv{UNLOCK['rps']}에 열려요")
        if self.s["energy"] < TIRED:
            return self._refuse_tired()
        if hand is None:                    # 손짓으로 낼 수 있게 10초 기다린다
            self.rps_open_until = time.time() + 10
            self.engine.feel("play", source="앱", speech="가위바위보! 손을 보여 줘 ✊✌️🖐")
            return self._result(True, "손을 보여 주세요")
        if hand not in HANDS:
            raise ValueError("hand 는 rock, scissors, paper 중 하나")
        self.rps_open_until = 0
        mine = random.choice(list(HANDS))
        if mine == hand:
            event, face, outcome = "rps_draw", "surprised", "draw"
        elif BEATS[mine] == hand:
            event, face, outcome = "rps_win", "happy", "robot"
        else:
            event, face, outcome = "rps_lose", "sad", "user"
        speech = {"draw": f"나도 {HANDS[mine]}! 비겼다!", "robot": f"나는 {HANDS[mine]}! 내가 이겼다!",
                  "user": f"나는 {HANDS[mine]}… 졌다! 한 판 더?"}[outcome]
        self._apply("rps")
        self.s["affection"] = min(100, self.s["affection"] + 1)
        self._hold(face)
        self.engine.feel(event, source="가위바위보", speech=speech)
        return self._result(True, speech, robot=mine, outcome=outcome)

    def _do_come(self):
        if self.s["level"] < UNLOCK["come"]:
            return self._result(False, f"이리 와는 Lv{UNLOCK['come']}에 열려요")
        if self.s["energy"] < TIRED:
            return self._refuse_tired()
        if not self.home.info()["registered"]:
            self.engine.feel("lonely", source="앱", speech="어디로 가야 할지 모르겠어. 카메라 화면에서 집을 알려 줘!")
            return self._result(False, "카메라 화면에서 집을 먼저 등록해 주세요", need_home=True)
        self.home.go()
        self._apply("come")
        return self._result(True, "지금 갈게!")

    def _do_scan(self):
        if self.s["energy"] < TIRED:
            return self._refuse_tired()
        self.room.scan()
        self._apply("scan")
        return self._result(True, "방을 둘러볼게!")

    def _do_goto(self, x, y):
        if self.s["energy"] < TIRED:
            return self._refuse_tired()
        self.room.go_to(x, y)
        self._apply("goto")
        return self._result(True, "거기로 갈게!")

    def _do_play(self, game):
        """로봇 놀이 시작 (끝나면 robotgames 가 minigame 으로 결과를 넘긴다)"""
        if game not in GAMES:
            raise ValueError("모르는 놀이")
        if self.s["energy"] < TIRED:
            return self._refuse_tired()
        self.robotgames.start(game)
        return self._result(True, None)

    def _do_minigame(self, game, score, max_score):
        if game not in GAMES:
            raise ValueError("모르는 게임")
        if self.s["energy"] < TIRED:
            return self._refuse_tired()
        ratio = max(0.0, min(1.0, float(score) / max(1, float(max_score))))
        plays = self.s["game_plays"].get(game, 0)
        rewarded = plays < GAME_REWARDS_PER_DAY
        self.s["game_plays"][game] = plays + 1
        new_best = score > self.s["best"].get(game, 0)
        if new_best:
            self.s["best"][game] = score
        gain = round(1 + 5 * ratio) if rewarded else 0
        before = title_of(self.s["affection"])["tier"]
        self.s["affection"] = min(100, self.s["affection"] + gain)
        self._apply("minigame", scale=0.4 + 0.6 * ratio)
        if ratio >= 0.8:
            event, face, speech = "game_great", "love", "최고야! 우리 진짜 잘 맞는다 💕"
        elif ratio >= 0.4:
            event, face, speech = "game_good", "happy", "재밌었다! 또 하자!"
        else:
            event, face, speech = "game_try", "smile", "괜찮아, 같이 해서 즐거웠어!"
        if gain:
            speech += f" (호감도 +{gain})"
        self._hold(face)
        self.engine.feel(event, source=GAMES[game], speech=speech)
        after = title_of(self.s["affection"])
        if after["tier"] > before:
            self.engine.feel("affection_up", source="호감도", speech=f"우리 이제 {iya(after['title'])}! 💖")
        return self._result(True, speech, gain=gain, rewarded=rewarded, new_best=new_best,
                            title_up=after["title"] if after["tier"] > before else None)

    def _do_hello(self):
        """앱을 열면 부른다. 10분에 한 번 인사하고, 그날 첫 방문이면 호감도 +2."""
        now = time.time()
        if self.s["sleeping"] or now - self.last_hello < HELLO_EVERY:
            return self._result(True, None)
        self.last_hello = now
        first = self.s.get("hello_day") != date.today().isoformat()
        speech = HELLO[title_of(self.s["affection"])["title"]]
        if first:
            self.s["hello_day"] = date.today().isoformat()
            self.s["affection"] = min(100, self.s["affection"] + 2)
            speech += " (오늘 첫 방문 호감도 +2)"
        self._hold("love" if self.s["affection"] >= 55 else "happy")
        self.engine.feel("hello", source="앱", speech=speech)
        return self._result(True, speech)

    def _do_equip(self, slot, item):
        lv = item_level(slot, item)
        if lv is None:
            raise ValueError("없는 아이템")
        if self.s["level"] < lv:
            return self._result(False, f"Lv{lv}에 열려요")
        self.s["look"][slot] = item
        self.s["new_items"] = [k for k in self.s["new_items"] if k != f"{slot}:{item}"]
        self._hold("love")
        name = next(n for i, n, _ in ITEMS[slot] if i == item)
        self.engine.feel("dress_up", source="꾸미기", speech="어때? 잘 어울려? 💕" if item not in ("none", "default") else "원래대로!")
        return self._result(True, None, item=name)

    def _do_seen_items(self):
        self.s["new_items"] = []
        return self._result(True, None)

    def _do_rename(self, name):
        name = str(name).strip()[:10]
        if not name:
            raise ValueError("이름을 입력해 주세요")
        self.s["name"] = name
        self._hold("love")
        self.engine.feel("thumbs_up", source="앱", speech=f"내 이름은 {name}! 마음에 들어 💕")
        return self._result(True, None)

    def _do_gesture(self, name):
        """손짓 인식 코드에서 부른다. 가위바위보 대기 중이면 그 손으로 승부한다."""
        self.last_gesture = name
        if name in HANDS and time.time() < self.rps_open_until:
            return self._do_rps(hand=name)
        if name in GESTURES and not self.s["sleeping"]:
            self._apply("gesture")
            self._hold("happy")
            self.engine.feel(GESTURES[name], source="손짓")
        return self._result(True, None)

    # ---------- 시간 흐름 ----------
    def tick(self, dt):
        changed = False
        with self.lock:
            s = self.s
            acc = self._acc
            if s["sleeping"]:
                acc["energy"] += dt / SLEEP_RECOVER_EVERY
                if s["energy"] >= 100:
                    s["energy"] = 100
                    self._do_wake()
                    changed = True
            else:
                acc["energy"] -= dt / ENERGY_DECAY_EVERY
            acc["happy"] -= dt / HAPPY_DECAY_EVERY
            for k in ("happy", "energy"):
                if abs(acc[k]) >= 1:
                    step = int(acc[k])
                    s[k] = max(0, min(100, s[k] + step))
                    acc[k] -= step
                    changed = True
            # 오래 안 놀아 주면 가끔 칭얼댄다
            if s["happy"] < 30 and not s["sleeping"] and time.time() - self.last_lonely > 120:
                self.last_lonely = time.time()
                self.engine.feel("lonely", source="혼자")
            if changed:
                self._save()
        return self.snapshot()

    # ---------- 내부 ----------
    def _apply(self, action, scale=1.0):
        dh, de, xp = EFFECTS[action]
        s = self.s
        s["happy"] = max(0, min(100, s["happy"] + round(dh * scale)))
        s["energy"] = max(0, min(100, s["energy"] + de))
        s["xp"] += round(xp * scale) * self.xp_boost
        while s["xp"] >= xp_to_next(s["level"]):
            s["xp"] -= xp_to_next(s["level"])
            s["level"] += 1
            opened = [k for k, lv in UNLOCK.items() if lv == s["level"]]
            name = {"rps": "가위바위보", "come": "이리 와"}
            extra = f" {name[opened[0]]}가 열렸어!" if opened else ""
            gifts = [(slot, i, n) for slot, items in ITEMS.items() for i, n, lv in items if lv == s["level"]]
            s["new_items"] += [f"{slot}:{i}" for slot, i, _ in gifts]
            if gifts:
                extra += f" 선물로 {', '.join(n for _, _, n in gifts)}도 받았어 🎁"
            self.engine.feel("level_up", source="게임", speech=f"레벨 업! 이제 Lv{s['level']}이야!{extra}")

    def _refuse_tired(self):
        self._hold("tired")
        self.engine.feel("too_tired", source="앱")
        return self._result(False, "에너지가 부족해요. 먼저 재워 주세요")

    def _hold(self, face):
        self.face_override = (face, time.time() + FACE_HOLD)

    def _face(self):
        if self.s["sleeping"]:
            return "sleep"
        if self.face_override and time.time() < self.face_override[1]:
            return self.face_override[0]
        st = self.engine.state()
        if st["asleep"]:
            return "sleep"
        if self.s["energy"] < TIRED:
            return "tired"
        face = FACE_FROM_MOOD.get(st["face"], "normal")
        if face == "normal" and self.s["happy"] >= 80:
            return "smile"
        if face == "normal" and self.s["happy"] < 30:
            return "sad"
        return face

    def _new_day(self):
        today = date.today().isoformat()
        if self.s["day"] != today:
            self.s["day"] = today
            self.s["snacks_today"] = 0
            self.s["game_plays"] = {}

    def _result(self, ok, message, **extra):
        return {"ok": ok, "message": message, **extra}

    def _load(self):
        base = {"name": "오리", "level": 1, "xp": 0, "happy": 70, "energy": 80, "sleeping": False,
                "day": date.today().isoformat(), "snacks_today": 0, "saved_at": time.time(),
                "affection": 5, "game_plays": {}, "best": {}, "hello_day": None,
                "look": dict(DEFAULT_LOOK), "new_items": []}
        try:
            saved = json.loads(SAVE_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return base
        base.update(saved)
        base["look"] = {**DEFAULT_LOOK, **base.get("look", {})}
        # 서버가 꺼져 있던 동안의 시간도 반영 (너무 많이 깎이지 않게 최대 30)
        away = max(0, time.time() - base["saved_at"])
        base["happy"] = max(0, base["happy"] - min(30, away / HAPPY_DECAY_EVERY))
        if base["sleeping"]:
            base["energy"] = min(100, base["energy"] + away / SLEEP_RECOVER_EVERY)
        return base

    def _save(self):
        self.s["saved_at"] = time.time()
        try:
            SAVE_FILE.write_text(json.dumps(self.s, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
