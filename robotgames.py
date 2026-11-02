"""라즈봇이 직접 하는 놀이 3가지. 앱은 리모컨·점수판이고, 게임은 로봇 몸으로 한다.

  무궁화 꽃이 피었습니다  로봇이 술래. 고개를 돌리고 부저로 "무궁화…"를 부른 뒤 돌아보며
                          카메라로 움직임을 잡는다. 들키지 않고 로봇 앞까지 오면(초음파) 승리.
  따라 춤추기            로봇이 바퀴·고개·불빛으로 춤 동작을 차례로 보여 주고, 사람이 같은 순서로
                          앱 버튼(또는 손짓)을 누른다. 맞히면 로봇이 그 동작을 따라 춘다.
  공 찾아오기            등록한 색 공을 아무 데나 굴려 두면, 로봇이 돌며 찾아가 공 앞에 선다. 빠를수록 고득점.

결과는 on_finish(game, score, max_score)로 키우기 게임에 넘겨 호감도·경험치를 받는다.
카메라나 로봇이 없으면(노트북) 할 수 있는 만큼 흉내 낸다.
"""
import random
import threading
import time

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None

HEAD_FRONT = (90, 25)
HEAD_AWAY = (0, 25)        # 무궁화: 고개를 옆으로 완전히 돌린다 (짐벌 좌우 0°)
CHANT = "무궁화꽃이피었습니다"
MOTION_RATIO = 0.025       # 화면의 이 비율 이상이 바뀌면 '움직였다'
TOUCH_CM = 15              # 초음파가 이만큼 가까우면 '터치'
MUGUNGHWA_LIMIT = 90       # 이 시간(초) 안에 터치 못 하면 끝

MOVES = {   # 따라 춤추기 동작: 이름, 불빛, 삑 횟수
    "left":    ("왼쪽 돌기", (40, 120, 255), 1),
    "right":   ("오른쪽 돌기", (255, 200, 0), 2),
    "forward": ("앞으로", (0, 220, 90), 1),
    "back":    ("뒤로", (255, 60, 60), 2),
    "nod":     ("끄덕끄덕", (255, 90, 160), 3),
}
GESTURE_MOVES = {"left": "left", "point_left": "left", "right": "right", "point_right": "right",
                 "forward": "forward", "up": "forward", "back": "back", "down": "back",
                 "nod": "nod", "thumbs_up": "nod"}

GAMES = {"mugunghwa": 10, "dance": 8, "fetch": 10}   # 게임 → 만점


class Stop(Exception):
    pass


class RobotGames:
    def __init__(self, body, camera, ball, on_status, on_finish):
        self.body = body
        self.camera = camera
        self.ball = ball                  # 공 찾기용 색 추적기 (home.HomeFinder)
        self.on_status = on_status
        self.on_finish = on_finish
        self.status = {"game": None, "phase": "idle"}
        self._cancel = threading.Event()
        self._inputs = []                 # 앱·손짓에서 들어온 입력
        self._input_ev = threading.Event()
        self._thread = None
        self.simulated = body.bot is None

    # ---------- 앱에서 부르는 함수 ----------
    def busy(self):
        return self._thread is not None and self._thread.is_alive()

    def start(self, game):
        if game not in GAMES:
            raise ValueError("모르는 놀이")
        if self.busy() or self.body.wheels_busy:
            raise ValueError("지금 다른 걸 하는 중이에요")
        if game == "fetch" and self.ball.home is None:
            raise ValueError("먼저 카메라로 공 색을 등록해 주세요")
        self._cancel = threading.Event()
        self._inputs.clear()
        self._thread = threading.Thread(target=self._run, args=(game,), daemon=True)
        self._thread.start()

    def input(self, **data):
        """앱 버튼·손짓 입력: move=left… (춤), touch=True (무궁화)"""
        if not self.busy():
            return False
        self._inputs.append(data)
        self._input_ev.set()
        return True

    def gesture(self, name):
        if self.status.get("game") == "dance" and name in GESTURE_MOVES:
            return self.input(move=GESTURE_MOVES[name])
        return False

    def cancel(self):
        self._cancel.set()
        self._input_ev.set()
        self.ball.cancel()

    # ---------- 공통 ----------
    def _run(self, game):
        self.body.wheels_busy = True
        self._set(game=game, phase="ready", message="준비!", score=0, max=GAMES[game], round=0,
                  done=False, result=None, simulated=self.simulated)
        score = 0
        try:
            score = {"mugunghwa": self._mugunghwa, "dance": self._dance, "fetch": self._fetch}[game]()
        except Stop:
            self.body.stop()
            self.body._led(0, 0, 0)
            self._set(phase="cancelled", message="놀이를 멈췄어요", done=True)
            return
        finally:
            self.body.stop()
            self.body.look(*HEAD_FRONT)
            self.body.wheels_busy = False
        result = self.on_finish(game, score, GAMES[game])
        self._set(phase="done", score=score, done=True, result=result)

    def _set(self, **kw):
        self.status = {**self.status, **kw}
        self.on_status(dict(self.status))

    def _sleep(self, secs):
        if self._cancel.wait(secs):
            raise Stop

    def _take_input(self, timeout):
        """입력 하나를 기다린다. 시간 안에 없으면 None."""
        end = time.time() + timeout
        while not self._inputs:
            if self._cancel.is_set():
                raise Stop
            left = end - time.time()
            if left <= 0:
                return None
            self._input_ev.clear()
            self._input_ev.wait(min(left, 0.2))
        return self._inputs.pop(0)

    def _beeps(self, n, on=0.07, off=0.08):
        for _ in range(n):
            self.body._beep(on, off, 1)

    # =================================================================
    # 1. 무궁화 꽃이 피었습니다
    # =================================================================
    def _mugunghwa(self):
        self._set(phase="ready", message="로봇에게서 멀리 떨어져 서세요. 곧 시작해요!", robot="front")
        self.body.look(*HEAD_FRONT)
        self.body._led(255, 255, 255)
        for n in (3, 2, 1):
            self._set(countdown=n)
            self._beeps(1, 0.05, 0)
            self._sleep(0.9)
        self._set(countdown=None)
        t0, survived = time.time(), 0
        while time.time() - t0 < MUGUNGHWA_LIMIT:
            # --- 노래 부르기: 고개를 돌리고 부저로 10박자. 이때 다가간다 ---
            self.body.look(*HEAD_AWAY)
            self.body._led(0, 220, 90)
            total = random.uniform(1.8, 4.5)        # 빠르게 부를 때도, 느리게 부를 때도 있다
            for k in range(len(CHANT)):
                self._set(phase="chant", robot="away", chant=CHANT[:k + 1],
                          message="지금이야! 살금살금 다가가세요")
                self.body._beep(0.04, 0, 1)
                if self._touched():
                    return self._mugunghwa_win(survived)
                self._sleep(total / len(CHANT) - 0.04)
            # --- 돌아보기: 카메라로 움직임을 본다 ---
            self.body.look(*HEAD_FRONT)
            self.body._led(255, 40, 40)
            self._set(phase="look", robot="front", message="멈춰! 👀 움직이면 들켜요")
            self._sleep(0.5)                        # 고개가 멈출 때까지
            ref = self._gray()
            watch_end = time.time() + random.uniform(2.0, 3.2)
            while time.time() < watch_end:
                if self._touched():
                    return self._mugunghwa_win(survived)
                if self._moved(ref):
                    self.body._beep(0.6, 0, 1)
                    self._set(phase="caught", message="움직였다! 잡았다~ 😝", chant="")
                    self._sleep(1.5)
                    return min(8, survived * 2)
                self._sleep(0.12)
            survived += 1
            self._set(round=survived)
        self._set(phase="caught", message="시간 끝! 다음엔 더 빨리 와 줘")
        self._sleep(1.2)
        return min(8, survived * 2)

    def _mugunghwa_win(self, survived):
        self.body.look(*HEAD_FRONT)
        self._set(phase="won", message="앗, 잡혔다! 네가 이겼어 🎉", robot="front", chant="")
        for color in ((255, 90, 160), (255, 200, 0), (40, 120, 255), (0, 220, 90)):
            self.body._led(*color)
            self.body._beep(0.06, 0.04, 1)
        self.body.drive(-120, 120)
        self._sleep(0.6)
        self.body.stop()
        return 10 if survived <= 2 else 9

    def _touched(self):
        """초음파로 사람이 바로 앞까지 왔는지, 또는 앱의 '터치!' 버튼"""
        if any(i.get("touch") for i in self._inputs):
            self._inputs.clear()
            return True
        d = self.body.distance_cm()
        return d is not None and d < TOUCH_CM

    def _gray(self):
        frame = self.camera.read() if cv2 is not None else None
        if frame is None:
            return None
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return cv2.GaussianBlur(g, (21, 21), 0)

    def _moved(self, ref):
        if ref is None:                             # 카메라가 없으면 가끔 들킨 걸로 흉내
            return random.random() < 0.02
        cur = self._gray()
        if cur is None:
            return False
        diff = cv2.absdiff(ref, cur)
        changed = np.count_nonzero(diff > 28) / diff.size
        return changed > MOTION_RATIO

    # =================================================================
    # 2. 따라 춤추기
    # =================================================================
    def _dance(self):
        seq, cleared = [], 0
        self.body.look(*HEAD_FRONT)
        self._set(phase="ready", message="로봇이 추는 춤을 잘 보세요!", seq_len=0, shown=[])
        self._sleep(1.5)
        for rnd in range(8):
            seq.append(random.choice(list(MOVES)))
            if rnd == 0:
                seq.append(random.choice(list(MOVES)))
            self._set(phase="watch", round=rnd + 1, seq_len=len(seq), shown=[], entered=0,
                      message="잘 보세요… 👀")
            self._sleep(0.6)
            pace = max(0.15, 0.45 - rnd * 0.04)
            for k, mv in enumerate(seq):
                # 흉내 모드(로봇이 안 보일 때)는 앱에 동작을 보여 준다
                self._set(shown=seq[:k + 1] if self.simulated else [], current=mv if self.simulated else None)
                self._do_move(mv)
                self._sleep(pace)
            self._set(phase="input", current=None, message="따라 해 보세요! 👆", shown=[])
            self._inputs.clear()
            for k, want in enumerate(seq):
                got = self._take_input(12)
                mv = got and got.get("move")
                if mv != want:
                    self._wrong()
                    self._set(phase="wrong", message=f"땡! {MOVES[want][0]}였어요" if mv else "시간이 지났어요",
                              answer=seq)
                    self._sleep(1.8)
                    return cleared
                self._set(entered=k + 1)
                self._do_move(mv, quick=True)       # 맞히면 로봇이 그 동작을 따라 춘다
            cleared += 1
            self._set(phase="good", score=cleared, message="딩동댕! 🎶")
            self._beeps(2, 0.05, 0.05)
            self._sleep(0.8)
        self._set(phase="good", message="완벽해! 우리 춤 최고야 🕺")
        self._celebrate()
        return cleared

    def _do_move(self, mv, quick=False):
        _, color, beeps = MOVES[mv]
        self.body._led(*color)
        t = 0.2 if quick else 0.32
        if mv == "left":
            self.body.drive(-130, 130); self._sleep(t); self.body.stop()
            self.body.drive(130, -130); self._sleep(t); self.body.stop()   # 제자리로
        elif mv == "right":
            self.body.drive(130, -130); self._sleep(t); self.body.stop()
            self.body.drive(-130, 130); self._sleep(t); self.body.stop()
        elif mv == "forward":
            self.body.drive(120, 120); self._sleep(t); self.body.stop()
            self.body.drive(-120, -120); self._sleep(t); self.body.stop()
        elif mv == "back":
            self.body.drive(-120, -120); self._sleep(t); self.body.stop()
            self.body.drive(120, 120); self._sleep(t); self.body.stop()
        elif mv == "nod":
            for _ in range(2):
                self.body.look(90, 60); self._sleep(t / 2)
                self.body.look(90, 5); self._sleep(t / 2)
            self.body.look(*HEAD_FRONT)
        self._beeps(beeps, 0.04, 0.04)
        self.body._led(0, 0, 0)

    def _wrong(self):
        self.body._led(255, 0, 0)
        for pan in (60, 120, 60, 120, 90):          # 고개 도리도리
            self.body.look(pan, 25)
            self._sleep(0.12)
        self.body._beep(0.5, 0, 1)

    def _celebrate(self):
        for color in ((255, 90, 160), (255, 200, 0), (40, 120, 255), (0, 220, 90)):
            self.body._led(*color)
            self.body.drive(150, -150)
            self._sleep(0.25)
        self.body.stop()

    # =================================================================
    # 3. 공 찾아오기
    # =================================================================
    def _fetch(self):
        self._set(phase="ready", message="공을 아무 데나 굴려 두세요! 3초 뒤에 찾으러 가요", countdown=3)
        self.body.look(*HEAD_FRONT)
        for n in (3, 2, 1):
            self._set(countdown=n)
            self.body._beep(0.05, 0, 1)
            self._sleep(1)
        self._set(countdown=None, phase="search", message="공 찾는 중… 🔍")
        self.body.wheels_busy = False               # 공 찾기 기능이 바퀴를 쓴다
        t0 = time.time()
        self.ball.go()
        while True:
            self._sleep(0.2)
            st = self.ball.status["state"]
            elapsed = time.time() - t0
            self._set(elapsed=round(elapsed, 1), message=self.ball.status["message"], progress=self.ball.status["progress"])
            if st == "arrived":
                self.body.wheels_busy = True
                self._celebrate()
                score = 10 if elapsed <= 10 else max(3, round(10 - (elapsed - 10) / 3))
                self._set(phase="found", message=f"찾았다! {elapsed:.1f}초 걸렸어 ⚽")
                return score
            if st in ("failed", "cancelled"):
                self.body.wheels_busy = True
                self._set(phase="lost", message="공을 못 찾았어… 보이는 곳에 굴려 줄래?")
                self._sleep(1.2)
                return 1
