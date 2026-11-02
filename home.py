"""집 찾기: 카메라로 '집 표시'를 알아보고 그쪽으로 돌아온다.

집 표시는 눈에 잘 띄는 색깔 물건(빨간 상자, 파란 색종이 등)이면 된다.
  1) register(): 로봇 카메라 정면에 집 표시를 두고 부르면, 화면 가운데 색을 '우리 집 색'으로 기억한다.
  2) go():       제자리에서 조금씩 돌며 그 색을 찾고, 찾으면 가운데로 맞추며 다가간다.
                 화면에서 집 표시가 충분히 커지면(가까워지면) 도착.

카메라나 OpenCV가 없으면(노트북 등) 흉내 모드로 단계만 차례로 보여준다.
"""
import json
import threading
import time
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None

SAVE_FILE = Path(__file__).parent / "home.json"
LOOK_AHEAD = (90, 20)     # 집 찾을 때 고개 각도 (정면, 살짝 아래)
TURN_SPEED = 90           # 찾을 때 제자리 회전 속도
TURN_PULSE = 0.12         # 한 번에 도는 시간(초). 돌고 → 멈추고 → 보기를 반복
MAX_PULSES = 70           # 이만큼 돌아도 못 찾으면 포기 (약 두 바퀴)
FORWARD = 80              # 다가갈 때 기본 속도
STEER = 60                # 좌우 보정 세기
ARRIVE_WIDTH = 0.45       # 집 표시가 화면 폭의 이만큼 차면 도착
MIN_AREA = 0.003          # 화면의 0.3%보다 작은 색 덩어리는 무시 (잡음)


class Camera:
    """카메라 하나를 여러 곳(집 찾기, 앱 미리보기)이 나눠 쓴다."""

    def __init__(self, index=0):
        self.index = index
        self.cap = None
        self.lock = threading.Lock()

    def read(self):
        if cv2 is None:
            return None
        with self.lock:
            if self.cap is None:
                self.cap = cv2.VideoCapture(self.index)
                self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
                self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if not self.cap.isOpened():
                self.cap = None
                return None
            self.cap.grab()            # 쌓여 있던 옛 화면 버리기
            ok, frame = self.cap.read()
            return frame if ok else None

    def available(self):
        return self.read() is not None


class HomeFinder:
    def __init__(self, body, camera, on_event, on_status, name="home", label="집", arrive=ARRIVE_WIDTH):
        """name: 저장 파일·사건 이름 (home → home.json, home_found …), label: 화면에 쓰는 이름"""
        self.name, self.label, self.arrive = name, label, arrive
        self.save_file = Path(__file__).parent / f"{name}.json"
        self.body = body
        self.camera = camera
        self.on_event = on_event      # 감정 엔진에 사건 알리기: on_event("home_found")
        self.on_status = on_status    # 앱에 진행 상황 알리기: on_status(dict)
        self.home = self._load()
        self.status = {"state": "idle", "message": "대기 중", "progress": 0.0}
        self.last_box = None          # 미리보기에 그릴 집 표시 위치
        self._cancel = threading.Event()
        self._thread = None
        self.simulated = not self.camera.available()

    # ---------- 앱에서 부르는 함수 ----------
    def info(self):
        return {**self.status, "registered": self.home is not None,
                "color": self.home and self.home["hex"], "simulated": self.simulated}

    def register(self):
        if self.simulated:
            self.home = {"hsv": [0, 200, 200], "hex": "#e34948"}
        else:
            frame = self.camera.read()
            if frame is None:
                raise ValueError("카메라 화면을 가져오지 못했어요")
            h, w = frame.shape[:2]
            center = frame[h * 2 // 5:h * 3 // 5, w * 2 // 5:w * 3 // 5]
            hsv = cv2.cvtColor(center, cv2.COLOR_BGR2HSV).reshape(-1, 3)
            hue, sat, val = (int(x) for x in np.median(hsv, axis=0))
            if sat < 70:
                raise ValueError("색이 너무 옅어요. 빨강·파랑·초록처럼 진한 색 물건을 가운데에 두세요")
            b, g, r = (int(x) for x in np.median(center.reshape(-1, 3), axis=0))
            self.home = {"hsv": [hue, sat, val], "hex": f"#{r:02x}{g:02x}{b:02x}"}
        self.save_file.write_text(json.dumps(self.home), encoding="utf-8")
        self._set("idle", f"{self.label}을(를) 기억했어요")
        return self.info()

    def go(self):
        if self.home is None:
            raise ValueError(f"먼저 {self.label}을(를) 등록해 주세요")
        if self._thread and self._thread.is_alive():
            return self.info()
        if self.body.wheels_busy:
            raise ValueError("지금 다른 곳으로 움직이는 중이에요")
        self._cancel = threading.Event()
        target = self._simulate if self.simulated else self._run
        self._thread = threading.Thread(target=target, args=(self._cancel,), daemon=True)
        self._thread.start()
        return self.info()

    def cancel(self):
        self._cancel.set()
        return self.info()

    def snapshot_jpeg(self):
        """앱 미리보기용 카메라 화면. 집 표시를 찾았으면 상자를 그려준다."""
        frame = self.camera.read()
        if frame is None:
            return None
        h, w = frame.shape[:2]
        if self.last_box and time.time() - self.last_box[4] < 1.0:
            x, y, bw, bh, _ = self.last_box
            cv2.rectangle(frame, (x, y), (x + bw, y + bh), (0, 255, 0), 2)
        if self.status["state"] in ("idle",):
            cv2.rectangle(frame, (w * 2 // 5, h * 2 // 5), (w * 3 // 5, h * 3 // 5), (255, 255, 255), 1)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        return buf.tobytes() if ok else None

    # ---------- 실제 집 찾기 ----------
    def _run(self, cancel):
        self.body.wheels_busy = True
        self.body.look(*LOOK_AHEAD)
        self.on_event(f"{self.name}_search")
        pulses, lost_since, found_once, announced = 0, None, False, False
        try:
            while not cancel.is_set():
                blob = self._find(self.camera.read())
                if blob is None:
                    if found_once and lost_since is None:
                        lost_since = time.time()
                    if found_once and time.time() - lost_since < 1.0:
                        self.body.stop()       # 잠깐 놓친 건 기다려 본다
                        time.sleep(0.1)
                        continue
                    found_once = False
                    pulses += 1
                    if pulses > MAX_PULSES:
                        self._set("failed", f"{self.label}을(를) 못 찾았어요. 보이는 곳에 두세요")
                        self.on_event(f"{self.name}_failed")
                        return
                    self._set("searching", f"두리번거리며 {self.label} 찾는 중", pulses / MAX_PULSES * 0.4)
                    self.body.drive(-TURN_SPEED, TURN_SPEED)
                    time.sleep(TURN_PULSE)
                    self.body.stop()
                    time.sleep(0.15)           # 멈춘 뒤 흔들림 없는 화면 보기
                    continue

                lost_since = None
                found_once = True
                if not announced:          # "찾았다!"는 한 번만
                    announced = True
                    self.on_event(f"{self.name}_found")
                cx, width = blob
                err = (cx - 0.5) * 2           # -1(왼쪽) ~ +1(오른쪽)
                if width >= self.arrive:
                    self.body.stop()
                    self._set("arrived", f"{self.label}에 도착했어요", 1.0)
                    self.on_event(f"{self.name}_arrived")
                    return
                self._set("approaching", f"{self.label}(으)로 가는 중", 0.4 + 0.6 * min(1, width / self.arrive))
                if abs(err) > 0.5:             # 많이 벗어나면 제자리에서 방향부터 맞춘다
                    turn = int(TURN_SPEED * (1 if err > 0 else -1))
                    self.body.drive(turn, -turn)
                else:
                    self.body.drive(FORWARD + STEER * err, FORWARD - STEER * err)
                time.sleep(0.1)
            self._set("cancelled", "멈췄어요")
        finally:
            self.body.stop()
            self.body.wheels_busy = False

    def _find(self, frame):
        """집 색 덩어리를 찾아 (가운데 x 비율, 폭 비율)을 돌려준다. 없으면 None."""
        if frame is None:
            return None
        h, w = frame.shape[:2]
        hue, sat, val = self.home["hsv"]
        hsv = cv2.cvtColor(cv2.GaussianBlur(frame, (5, 5), 0), cv2.COLOR_BGR2HSV)
        lo_s, lo_v = max(60, sat - 70), max(40, val - 90)
        lo, hi = hue - 10, hue + 10
        mask = cv2.inRange(hsv, (max(lo, 0), lo_s, lo_v), (min(hi, 179), 255, 255))
        if lo < 0:      # 빨강처럼 색상환 양 끝에 걸친 색
            mask |= cv2.inRange(hsv, (180 + lo, lo_s, lo_v), (179, 255, 255))
        if hi > 179:
            mask |= cv2.inRange(hsv, (0, lo_s, lo_v), (hi - 180, 255, 255))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None
        biggest = max(contours, key=cv2.contourArea)
        if cv2.contourArea(biggest) < MIN_AREA * w * h:
            return None
        x, y, bw, bh = cv2.boundingRect(biggest)
        self.last_box = (x, y, bw, bh, time.time())
        return (x + bw / 2) / w, bw / w

    # ---------- 흉내 모드 ----------
    def _simulate(self, cancel):
        self.on_event(f"{self.name}_search")
        steps = [("searching", f"두리번거리며 {self.label} 찾는 중", 0.1 * i) for i in range(1, 5)]
        steps += [("approaching", f"{self.label}(으)로 가는 중", 0.4 + 0.1 * i) for i in range(1, 6)]
        for i, (state, msg, p) in enumerate(steps):
            if cancel.wait(0.7):
                self._set("cancelled", "멈췄어요")
                return
            if i == 4:
                self.on_event(f"{self.name}_found")
            self._set(state, msg + " (흉내 모드)", p)
        self._set("arrived", f"{self.label}에 도착했어요 (흉내 모드)", 1.0)
        self.on_event(f"{self.name}_arrived")

    # ---------- 내부 ----------
    def _set(self, state, message, progress=None):
        self.status = {"state": state, "message": message,
                       "progress": round(self.status["progress"] if progress is None else progress, 2)}
        self.on_status(self.info())

    def _load(self):
        try:
            return json.loads(self.save_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
