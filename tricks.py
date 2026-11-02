"""개인기 훈련: 로봇이 개인기를 해 보고, 사람이 👍 엄지 척으로 칭찬하면 배운다.

  연습   로봇이 개인기를 해 본다. 처음엔 어설프게 하다 멈추기도 하고, 칭찬받을수록 잘한다.
         끝나면 6초 동안 칭찬을 기다린다 (카메라 엄지 척 손짓 또는 앱의 👍 버튼).
         제대로 했을 때 칭찬받기를 3번 하면 배운다. 어설펐는데 칭찬하면 헷갈려 한다.
  보여 줘  배운 개인기를 한 번 해 보인다.
  나만의 개인기  동작(삐, 꾸벅, 빙글, 앞뒤, 왼쪽·오른쪽 돌기, 흔들기)을 최대 6개 담아 만든다.

결과는 on_result(trick_id, mode, praised, clumsy)로 키우기 게임에 넘긴다.
"""
import random
import threading
import time

PRAISE_SECS = 6
NEED = 3            # 배우는 데 필요한 칭찬 수
MAX_CUSTOM = 6

# 동작: 이름, 아이콘
MOVES = {
    "beep": ("삐!", "🔔"), "bow": ("꾸벅", "🙇"), "spin": ("빙글", "🌀"), "back": ("뒤로", "⬇️"),
    "forward": ("앞으로", "⬆️"), "left": ("왼쪽 돌기", "⬅️"), "right": ("오른쪽 돌기", "➡️"), "wiggle": ("흔들기", "〰️"),
}
# 정해진 개인기: 이름, 아이콘, 동작 순서
TRICKS = {
    "bow":    ("꾸벅 인사", "🙇", ["bow", "beep"]),
    "spin":   ("빙글 돌기", "🌀", ["spin", "beep"]),
    "dance":  ("신나는 춤", "💃", ["left", "right", "wiggle", "bow", "beep"]),
    "wiggle": ("엉덩이 흔들기", "🐕", ["wiggle", "wiggle", "beep"]),
}
LED = {"beep": (255, 200, 0), "bow": (255, 90, 160), "spin": (40, 120, 255), "back": (255, 60, 60),
       "forward": (0, 220, 90), "left": (40, 120, 255), "right": (255, 200, 0), "wiggle": (138, 108, 240)}
HEAD = (90, 25)


class TrickTrainer:
    def __init__(self, body, on_status, on_result):
        self.body = body
        self.on_status = on_status
        self.on_result = on_result
        self.simulated = body.bot is None
        self.status = {"active": None, "mode": None, "phase": "idle", "message": "", "left": 0}
        self._praised = threading.Event()
        self._cancel = threading.Event()
        self._thread = None

    def busy(self):
        return self._thread is not None and self._thread.is_alive()

    def start(self, trick_id, name, moves, mode, success_chance=1.0):
        if self.busy() or self.body.wheels_busy:
            raise ValueError("지금 다른 걸 하는 중이에요")
        if not moves:
            raise ValueError("먼저 동작을 담아 주세요")
        self._praised.clear()
        self._cancel.clear()
        clumsy = mode == "practice" and random.random() > success_chance
        self._thread = threading.Thread(target=self._run, args=(trick_id, name, moves, mode, clumsy), daemon=True)
        self._thread.start()

    def praise(self):
        if self.status["phase"] != "judge":
            return False
        self._praised.set()
        return True

    def cancel(self):
        self._cancel.set()
        self._praised.set()

    # ---------- 실행 ----------
    def _set(self, **kw):
        self.status = {**self.status, **kw}
        self.on_status(dict(self.status))

    def _run(self, trick_id, name, moves, mode, clumsy):
        self.body.wheels_busy = True
        try:
            self._set(active=trick_id, mode=mode, phase="doing", left=0,
                      message=f"{name} 해 볼게요! 로봇을 보세요 👀" if mode == "practice" else f"{name}! 짠~")
            todo = moves[:max(1, len(moves) // 2)] if clumsy else moves
            for mv in todo:
                if self._cancel.is_set():
                    return
                self._move(mv)
            if clumsy:                               # 어설프게 하다 멈춘다: 고개 갸웃
                for pan in (70, 110, 90):
                    self.body.look(pan, 35)
                    time.sleep(0.25)
            self.body.stop()
            self.body.look(*HEAD)
            self.body._led(0, 0, 0)
        finally:
            self.body.stop()
            self.body.wheels_busy = False
        if mode == "show":
            self._set(active=None, phase="idle", message="")
            self.on_result(trick_id, mode, False, False)
            return
        # 흉내 모드(로봇이 안 보일 때)는 어떻게 했는지 앱에 알려 준다
        hint = ("(어설프게 하다 멈췄어요 🤔)" if clumsy else "(제대로 했어요 ✨)") if self.simulated else ""
        end = time.time() + PRAISE_SECS
        self._set(phase="judge", left=PRAISE_SECS, message=f"잘했으면 👍 엄지 척! {hint}".strip())
        while time.time() < end and not self._praised.is_set():
            self._praised.wait(0.5)
            self._set(left=max(0, round(end - time.time())))
        praised = self._praised.is_set() and not self._cancel.is_set()
        self._set(active=None, phase="idle", message="", left=0)
        if not self._cancel.is_set():
            self.on_result(trick_id, mode, praised, clumsy)

    def _move(self, mv):
        b = self.body
        b._led(*LED.get(mv, (255, 255, 255)))
        if mv == "beep":
            b._beep(0.12, 0.08, 2)
        elif mv == "bow":
            b.look(90, 60); time.sleep(0.25)
            b.look(90, 0); time.sleep(0.6)
            b.look(*HEAD); time.sleep(0.2)
        elif mv == "spin":
            b.drive(-150, 150); time.sleep(1.2); b.stop()
        elif mv in ("forward", "back"):
            sp = 120 if mv == "forward" else -120
            b.drive(sp, sp); time.sleep(0.4); b.stop()
        elif mv in ("left", "right"):
            sp = 140 if mv == "right" else -140
            b.drive(sp, -sp); time.sleep(0.45); b.stop()
        elif mv == "wiggle":
            for _ in range(3):
                b.drive(130, -130); time.sleep(0.14)
                b.drive(-130, 130); time.sleep(0.14)
            b.stop()
        time.sleep(0.15)
