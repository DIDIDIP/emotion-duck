"""라즈봇2(Yahboom Raspbot V2) 몸 제어 + 감정별 반응 동작.

반응 동작은 '키프레임 목록'으로 적는다. 한 줄이 한 동작이고, 위에서부터 차례로 실행한다.
  ("drive", 왼쪽속도, 오른쪽속도, 초)  속도 -255~255, 음수는 후진
  ("head", 좌우각도, 상하각도)         카메라 짐벌 서보 (좌우 0~180, 상하 0~110)
  ("led", R, G, B)                     불빛 색
  ("beep", 켜는초, 끄는초, 횟수)        부저 (마이크로덕의 '꽥' 소리 대신)
  ("wait", 초)
새 반응이 들어오면 하던 반응은 멈추고 새 반응을 시작한다.

라즈봇2 라이브러리(Raspbot_Lib)가 없으면(노트북 등) 자동으로 '흉내 모드'로 돌아가
콘솔에 동작만 출력한다. 함수 이름은 Yahboom 공식 예제 기준이며, 키트 버전에 따라 다를 수 있다.
"""
import threading
import time

try:
    from Raspbot_Lib import Raspbot   # 라즈봇2 이미지에 기본 설치된 라이브러리
except ImportError:
    Raspbot = None

HEAD_CENTER = (90, 25)

REACTIONS = {
    "celebrate": [   # 골·홈런: 고개 번쩍, 무지개 불빛, 제자리 빙글, 꽥꽥꽥
        ("head", 90, 80), ("led", 255, 200, 0), ("beep", 0.08, 0.06, 3),
        ("drive", 180, -180, 0.6), ("led", 0, 255, 120),
        ("drive", -180, 180, 0.6), ("led", 255, 0, 200),
        ("head", 60, 80), ("wait", 0.15), ("head", 120, 80), ("wait", 0.15),
        ("head", 90, 60), ("led", 255, 200, 0),
    ],
    "excited": [
        ("led", 255, 140, 0), ("head", 70, 60), ("wait", 0.12), ("head", 110, 60),
        ("wait", 0.12), ("head", 70, 60), ("wait", 0.12), ("head", 90, 50), ("beep", 0.05, 0.05, 2),
    ],
    "proud": [
        ("led", 255, 220, 0), ("head", 90, 90), ("beep", 0.2, 0, 1), ("wait", 0.8), ("head", 90, 40),
    ],
    "greet": [   # 고개를 끄덕이며 인사
        ("led", 120, 255, 120), ("head", 90, 60), ("wait", 0.2), ("head", 90, 15),
        ("wait", 0.2), ("head", 90, 50), ("beep", 0.1, 0.1, 2),
    ],
    "content": [  # 쓰다듬기: 고개를 살짝 기울이고 따뜻한 색
        ("led", 255, 120, 160), ("head", 110, 35), ("wait", 1.0), ("head", 90, 30),
    ],
    "comfort": [  # 사용자가 슬플 때: 천천히 다가가 고개를 숙이고 은은한 불빛
        ("led", 80, 120, 255), ("head", 90, 10), ("drive", 70, 70, 0.4),
        ("wait", 0.6), ("head", 90, 35), ("led", 150, 160, 255),
    ],
    "frustrated": [
        ("led", 255, 80, 0), ("head", 70, 20), ("wait", 0.15), ("head", 110, 20),
        ("wait", 0.15), ("head", 90, 25), ("beep", 0.3, 0, 1),
    ],
    "sad": [      # 실점·패배: 고개 떨구고 살짝 뒤로
        ("led", 0, 40, 160), ("head", 90, 0), ("drive", -60, -60, 0.4), ("beep", 0.4, 0, 1),
    ],
    "flinch": [   # 혼남: 움찔 뒤로
        ("led", 160, 0, 60), ("drive", -150, -150, 0.25), ("head", 70, 5), ("wait", 0.8), ("head", 90, 15),
    ],
    "startle": [
        ("led", 255, 255, 255), ("head", 90, 100), ("drive", -120, -120, 0.15), ("wait", 0.5), ("head", 90, 40),
    ],
    "sleep": [
        ("head", 90, 0), ("led", 10, 10, 40),
    ],
}

# 표정(감정 이름) → 평소 불빛. 반응이 끝나면 이 색으로 돌아간다.
MOOD_COLORS = {
    "joy": (255, 180, 0), "content": (255, 120, 160), "surprised": (255, 255, 255),
    "angry": (255, 40, 0), "sad": (0, 60, 200), "sleepy": (10, 10, 40), "neutral": (60, 200, 120),
}


class RobotBody:
    def __init__(self, allow_drive=True):
        self.bot = Raspbot() if Raspbot else None
        self.allow_drive = allow_drive   # 책상 위 시연 등에서 바퀴를 끄고 싶을 때 False
        self.wheels_busy = False         # 집 찾기가 바퀴를 쓰는 동안 반응 동작은 바퀴를 건드리지 않는다
        self._cancel = threading.Event()
        self._thread = None
        self._lock = threading.Lock()
        print("[robot] " + ("라즈봇2 연결됨" if self.bot else "흉내 모드 (Raspbot_Lib 없음)"))

    # ---------- 반응 실행 ----------
    def react(self, name, mood_face="neutral"):
        steps = REACTIONS.get(name)
        if not steps:
            return
        with self._lock:
            if self._thread and self._thread.is_alive():
                self._cancel.set()
                self._thread.join(timeout=1)
            self._cancel = threading.Event()
            self._thread = threading.Thread(target=self._run, args=(steps, mood_face, self._cancel), daemon=True)
            self._thread.start()

    def _run(self, steps, mood_face, cancel):
        for step in steps:
            if cancel.is_set():
                break
            kind, *args = step
            getattr(self, "_" + kind)(*args, cancel=cancel)
        if not self.wheels_busy:
            self._stop()
        self._led(*MOOD_COLORS.get(mood_face, MOOD_COLORS["neutral"]))
        if mood_face != "sleepy":
            self._head(*HEAD_CENTER)

    def show_mood(self, face):
        """반응 중이 아닐 때만 평소 불빛을 기분 색으로 바꾼다."""
        if not (self._thread and self._thread.is_alive()):
            self._led(*MOOD_COLORS.get(face, MOOD_COLORS["neutral"]))

    # ---------- 기본 동작 ----------
    def _drive(self, left, right, secs, cancel=None):
        if self.wheels_busy:
            return
        if self.allow_drive:
            self._motors(left, right)
        self._wait(secs, cancel=cancel)
        self._stop()

    # ---------- 집 찾기에서 쓰는 바퀴·고개 제어 ----------
    def drive(self, left, right):
        if self.allow_drive:
            self._motors(left, right)

    def stop(self):
        self._stop()

    def look(self, pan, tilt):
        self._head(pan, tilt)

    def distance_cm(self):
        """앞쪽 초음파 센서로 잰 거리(cm). 센서가 없거나 읽기 실패면 None.
        Yahboom 예제 기준: 0x1b(상위)·0x1a(하위) 레지스터에 mm 단위로 들어 있다."""
        if not self.bot:
            return None
        try:
            if not getattr(self, "_sonar_on", False):
                self.bot.Ctrl_Ulatist_Switch(1)
                self._sonar_on = True
                time.sleep(0.05)
            hi = self.bot.read_data_array(0x1b, 1)[0]
            lo = self.bot.read_data_array(0x1a, 1)[0]
            mm = hi << 8 | lo
            return mm / 10 if 20 < mm < 4000 else None
        except Exception:
            return None

    def _motors(self, left, right):
        if not self.bot:
            print(f"[robot] 바퀴 L={left} R={right}")
            return
        # Ctrl_Car(모터번호 0~3, 방향 0=전진/1=후진, 속도 0~255). 0,1=왼쪽 / 2,3=오른쪽
        for mid, speed in ((0, left), (1, left), (2, right), (3, right)):
            self.bot.Ctrl_Car(mid, 0 if speed >= 0 else 1, min(255, abs(int(speed))))

    def _stop(self, cancel=None):
        if self.bot:
            for mid in range(4):
                self.bot.Ctrl_Car(mid, 0, 0)

    def _head(self, pan, tilt, cancel=None):
        if self.bot:
            self.bot.Ctrl_Servo(1, int(pan))
            self.bot.Ctrl_Servo(2, int(tilt))
        else:
            print(f"[robot] 고개 좌우={pan} 상하={tilt}")

    def _led(self, r, g, b, cancel=None):
        if self.bot:
            self.bot.Ctrl_WQ2812_brightness_ALL(int(r), int(g), int(b))
        else:
            print(f"[robot] 불빛 RGB({r},{g},{b})")

    def _beep(self, on, off, times, cancel=None):
        for _ in range(times):
            if cancel and cancel.is_set():
                break
            if self.bot:
                self.bot.Ctrl_BEEP_Switch(1)
            else:
                print("[robot] 꽥!")
            time.sleep(on)
            if self.bot:
                self.bot.Ctrl_BEEP_Switch(0)
            time.sleep(off)

    def _wait(self, secs, cancel=None):
        if cancel:
            cancel.wait(secs)
        else:
            time.sleep(secs)

    def shutdown(self):
        self._cancel.set()
        self._stop()
        if self.bot:
            self.bot.Ctrl_BEEP_Switch(0)
            self.bot.Ctrl_WQ2812_ALL(0, 0)
            if getattr(self, "_sonar_on", False):
                self.bot.Ctrl_Ulatist_Switch(0)
