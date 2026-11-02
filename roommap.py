"""방 지도: 한 바퀴 돌며 방을 스캔하고, 지도에서 고른 위치로 이동한다.

스캔
  제자리에서 약 30°씩 돌며 매번 카메라 사진 한 장 + 초음파 거리 하나를 잰다.
  실제로 몇 도 돌았는지는 앞뒤 사진의 특징점(ORB)이 옆으로 밀린 정도로 계산한다.
  (라즈봇2에는 바퀴 회전 센서가 없어 시간만으로는 각도가 부정확하기 때문)
  → 사진 띠(파노라마) + 위에서 본 지도(벽까지 거리)를 만든다.

이동
  지도 좌표: 스캔한 자리가 (0, 0), 처음 바라본 방향이 위쪽(+y), 단위 cm.
  목표 방향으로 돌고 → 그 방향에서 찍었던 사진과 지금 화면을 비교해 방향을 보정하고
  → 거리만큼 앞으로 간다. 가는 중 초음파가 가까운 장애물을 보면 멈춘다.

로봇이 없으면(노트북) 가상의 방에서 흉내 낸다.
"""
import math
import threading
import time

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None

# ---- 로봇·카메라 값 (실제 키트에 맞춰 조정) ----
CAM_HFOV = 62.0          # 카메라 가로 화각(도)
CAM_VFOV = 48.0          # 카메라 세로 화각(도)
CAM_HEIGHT = 11.0        # 바닥에서 카메라까지 높이(cm)
CAM_TILT_DOWN = 12.0     # 스캔할 때 카메라가 수평보다 아래로 숙인 각도(도)
SCAN_HEAD = (90, 20)     # 스캔할 때 짐벌 각도 (좌우, 상하)
STEP_DEG = 30            # 한 번에 돌 각도
TURN_SPEED = 90          # 회전 속도
TURN_DEG_PER_SEC = 120.0 # 처음 추정값. 스캔하면서 사진으로 다시 잰다
FORWARD = 80             # 직진 속도
CM_PER_SEC = 25.0        # FORWARD 속도로 1초에 가는 거리(cm). 줄자로 재서 맞추기
STOP_CM = 18             # 초음파가 이보다 가까우면 멈춤
WALL_MARGIN = 20         # 벽에서 이만큼 떨어진 곳까지만 간다
MAX_RANGE = 300          # 이보다 먼 거리는 '트인 곳'으로 본다


def wrap(deg):
    return (deg + 180) % 360 - 180


class RoomMap:
    def __init__(self, body, camera, on_event, on_status):
        self.body = body
        self.camera = camera
        self.on_event = on_event
        self.on_status = on_status
        self.simulated = body.bot is None
        self.frames = []          # [{heading, dist, open, jpg}]
        self.pose = {"x": 0.0, "y": 0.0, "heading": 0.0}
        self.target = None
        self.status = {"state": "empty", "message": "아직 방을 스캔하지 않았어요", "progress": 0.0}
        self.turn_rate = TURN_DEG_PER_SEC
        self._leg_start = None
        self.scanned_at = 0
        self._cancel = threading.Event()
        self._thread = None
        self.lock = threading.Lock()

    # ---------- 앱에 보내는 정보 ----------
    def info(self):
        return {
            **self.status,
            "simulated": self.simulated,
            "pose": {k: round(v, 1) for k, v in self.pose.items()},
            "target": self.target,
            "frames": [{"i": i, "heading": round(f["heading"], 1), "dist": f["dist"] and round(f["dist"]),
                        "open": f["open"], "photo": f["jpg"] is not None} for i, f in enumerate(self.frames)],
            "camera": {"hfov": CAM_HFOV, "vfov": CAM_VFOV, "height": CAM_HEIGHT, "tilt": CAM_TILT_DOWN},
            "max_range": MAX_RANGE, "margin": WALL_MARGIN, "scanned_at": self.scanned_at,
        }

    def busy(self):
        return self._thread is not None and self._thread.is_alive()

    def photo(self, i):
        try:
            return self.frames[i]["jpg"]
        except (IndexError, TypeError):
            return None

    # ---------- 명령 ----------
    def scan(self):
        self._start(self._sim_scan if self.simulated else self._scan)

    def go_to(self, x, y):
        if not self.frames:
            raise ValueError("먼저 방을 스캔해 주세요")
        self.target = {"x": round(float(x)), "y": round(float(y))}
        self._start(self._sim_go if self.simulated else self._go)

    def cancel(self):
        self._cancel.set()

    def _start(self, fn):
        if self.busy() or self.body.wheels_busy:
            raise ValueError("지금 다른 곳으로 움직이는 중이에요")
        self._cancel = threading.Event()
        self._thread = threading.Thread(target=self._guard, args=(fn, self._cancel), daemon=True)
        self._thread.start()

    def _guard(self, fn, cancel):
        self.body.wheels_busy = True
        try:
            fn(cancel)
        finally:
            self.body.stop()
            self.body.wheels_busy = False

    # ---------- 실제 스캔 ----------
    def _scan(self, cancel):
        self.on_event("map_scan")
        self.body.look(*SCAN_HEAD)
        time.sleep(0.4)
        frames, heading, rates = [], 0.0, []
        prev = self._grab()
        while heading < 360 - STEP_DEG / 2 and len(frames) < 18:
            if cancel.is_set():
                return self._set("ready" if self.frames else "empty", "스캔을 멈췄어요")
            frames.append(self._sample(heading, prev))
            self._set("scanning", f"방 둘러보는 중… {int(heading)}°", heading / 360)
            secs = STEP_DEG / self.turn_rate
            self._turn_secs(+1, secs)
            cur = self._grab()
            moved = self._visual_turn(prev, cur)
            if moved is not None and 5 < moved < 80:
                rates.append(moved / secs)
                self.turn_rate = sum(rates) / len(rates)   # 사진으로 잰 회전 속도로 갱신
            heading += moved if moved is not None and 5 < moved < 80 else STEP_DEG
            prev = cur
        self.frames = frames
        self.scanned_at = int(time.time())
        self.pose = {"x": 0.0, "y": 0.0, "heading": wrap(heading)}
        self.target = None
        self._set("ready", f"스캔 완료! 사진 {len(frames)}장 · 지도를 눌러 갈 곳을 고르세요", 1.0)
        self.on_event("map_scanned")

    def _sample(self, heading, frame):
        dists = [d for d in (self.body.distance_cm() for _ in range(3)) if d]
        dist = sorted(dists)[len(dists) // 2] if dists else None
        is_open = dist is None or dist > MAX_RANGE
        jpg = None
        if frame is not None:
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            jpg = buf.tobytes() if ok else None
        return {"heading": heading, "dist": None if is_open else dist, "open": is_open,
                "jpg": jpg, "gray": None if frame is None else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)}

    # ---------- 실제 이동 ----------
    def _go(self, cancel):
        p, t = self.pose, self.target
        dx, dy = t["x"] - p["x"], t["y"] - p["y"]
        dist = math.hypot(dx, dy)
        bearing = math.degrees(math.atan2(-dx, dy))
        self.on_event("map_go")
        self._set("turning", "방향 맞추는 중", 0.1)
        self._turn_to(bearing, cancel)
        if cancel.is_set():
            return self._set("ready", "멈췄어요")
        travelled, t0 = 0.0, time.time()
        self.body.drive(FORWARD, FORWARD)
        while travelled < dist:
            if cancel.is_set():
                break
            d = self.body.distance_cm()
            if d is not None and d < STOP_CM:
                self.body.stop()
                self._move(bearing, travelled)
                self.on_event("map_blocked")
                return self._set("blocked", "앞에 뭔가 있어서 멈췄어요", travelled / dist)
            time.sleep(0.05)
            travelled = (time.time() - t0) * CM_PER_SEC
            self._move(bearing, min(travelled, dist), commit=False)
            self._set("moving", f"가는 중… {int(dist - min(travelled, dist))}cm 남음", 0.2 + 0.8 * min(1, travelled / dist))
        self.body.stop()
        self._move(bearing, min(travelled, dist))
        if cancel.is_set():
            return self._set("ready", "멈췄어요")
        self._set("arrived", "도착했어요!", 1.0)
        self.on_event("map_arrived")

    def _turn_to(self, bearing, cancel):
        """시간으로 대강 돈 뒤, 그 방향에서 찍었던 사진과 비교해 최대 3번 보정한다."""
        diff = wrap(bearing - self.pose["heading"])
        self._turn_deg(diff)
        self.pose["heading"] = bearing
        ref = min(self.frames, key=lambda f: abs(wrap(f["heading"] - bearing)), default=None)
        if ref is None or ref["gray"] is None or abs(wrap(ref["heading"] - bearing)) > STEP_DEG / 2:
            return
        for _ in range(3):
            if cancel.is_set():
                return
            cur = self._grab()
            seen = self._visual_turn(ref["gray"], cur, already_gray=True)
            if seen is None:
                return
            # seen = 사진 속 방향에서 얼마나 더 왼쪽으로 돌아가 있나. 목표는 (bearing - ref)
            error = wrap((bearing - ref["heading"]) - seen)
            if abs(error) < 4:
                return
            self._turn_deg(error)

    def _move(self, bearing, cm, commit=True):
        """이번 직진 구간 시작점에서 bearing 방향으로 cm 만큼 간 위치로 pose를 옮긴다."""
        base = self._leg_start or dict(self.pose)
        self._leg_start = None if commit else base
        rad = math.radians(bearing)
        self.pose["x"] = base["x"] - cm * math.sin(rad)
        self.pose["y"] = base["y"] + cm * math.cos(rad)

    # ---------- 회전 ----------
    def _turn_deg(self, deg):
        self._turn_secs(1 if deg > 0 else -1, abs(deg) / self.turn_rate)

    def _turn_secs(self, direction, secs):
        """direction +1 = 왼쪽(반시계), -1 = 오른쪽"""
        self.body.drive(-TURN_SPEED * direction, TURN_SPEED * direction)
        time.sleep(secs)
        self.body.stop()
        time.sleep(0.25)    # 흔들림이 멈춘 뒤 사진 찍기

    def _grab(self):
        return self.camera.read()

    def _visual_turn(self, a, b, already_gray=False):
        """사진 a → b 사이에 로봇이 왼쪽으로 몇 도 돌았는지. 못 재면 None."""
        if cv2 is None or a is None or b is None:
            return None
        ga = a if already_gray else cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
        gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY) if b.ndim == 3 else b
        orb = cv2.ORB_create(600)
        ka, da = orb.detectAndCompute(ga, None)
        kb, db = orb.detectAndCompute(gb, None)
        if da is None or db is None:
            return None
        matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(da, db)
        matches = sorted(matches, key=lambda m: m.distance)[:80]
        if len(matches) < 12:
            return None
        shifts = [kb[m.trainIdx].pt[0] - ka[m.queryIdx].pt[0] for m in matches]
        dx = float(np.median(shifts))
        # 왼쪽으로 돌면 화면 속 물체는 오른쪽으로 밀린다
        return dx / ga.shape[1] * CAM_HFOV

    # ---------- 흉내 모드: 가로 4m × 세로 3m 가상의 방 ----------
    SIM_ROOM = (-150, 250, -100, 200)   # 왼쪽, 오른쪽, 아래, 위 벽 (cm, 로봇 기준)
    SIM_FURNITURE = [((120, 120), 40, "소파", (90, 120, 200)), ((-110, 160), 30, "책상", (60, 140, 90)),
                     ((180, -60), 25, "화분", (40, 160, 60))]

    def _sim_hits(self, x, y, bearing):
        """(벽까지 거리, 가구까지 거리 또는 None, 가구 색)"""
        l, r, b, t = self.SIM_ROOM
        dx, dy = -math.sin(math.radians(bearing)), math.cos(math.radians(bearing))
        wall = 1e9
        for w, axis in ((l, "x"), (r, "x"), (b, "y"), (t, "y")):
            d = dx if axis == "x" else dy
            if abs(d) > 1e-6:
                k = (w - (x if axis == "x" else y)) / d
                if k > 0:
                    wall = min(wall, k)
        furn, color = None, None
        for (cx, cy), rad, _, col in self.SIM_FURNITURE:
            fx, fy = cx - x, cy - y
            proj = fx * dx + fy * dy
            perp = abs(fx * dy - fy * dx)
            if proj > 0 and perp < rad:
                k = proj - math.sqrt(rad * rad - perp * perp)
                if k < wall and (furn is None or k < furn):
                    furn, color = k, col
        return wall, furn, color

    def _sim_ray(self, x, y, bearing):
        wall, furn, _ = self._sim_hits(x, y, bearing)
        return furn if furn is not None else wall

    def _sim_photo(self, heading):
        """가상의 방을 카메라 높이·화각에 맞춰 그린다 (사진 속 바닥을 누르는 계산과 맞도록)."""
        if cv2 is None:
            return None
        W, H = 320, 240
        img = np.zeros((H, W, 3), np.uint8)

        def row(angle_down):     # 수평보다 angle_down 도 아래 → 사진의 몇 번째 줄
            return int((0.5 + (angle_down - CAM_TILT_DOWN) / CAM_VFOV) * H)

        for c in range(0, W, 2):
            bearing = heading - ((c + 1) / W - 0.5) * CAM_HFOV
            wall, furn, color = self._sim_hits(0, 0, bearing)
            base = row(math.degrees(math.atan(CAM_HEIGHT / wall)))
            shade = max(0.55, 1 - wall / 900)
            img[:, c:c + 2] = (int(215 * shade), int(228 * shade), int(240 * shade))     # 벽 (BGR)
            for y in range(max(0, base), H):                                              # 바닥: 가까울수록 진하게
                f = (y - base) / max(1, H - base)
                img[y, c:c + 2] = (int(120 + 40 * f), int(150 + 30 * f), int(185 + 25 * f))
            if furn is not None:
                top = row(-math.degrees(math.atan((70 - CAM_HEIGHT) / furn)))
                bottom = row(math.degrees(math.atan(CAM_HEIGHT / furn)))
                k = max(0.6, 1 - furn / 600)
                img[max(0, top):max(0, min(H, bottom)), c:c + 2] = tuple(int(v * k) for v in color)
        cv2.putText(img, f"{int(wrap(heading))} deg", (8, 18), cv2.FONT_HERSHEY_SIMPLEX, .45, (70, 70, 70), 1)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buf.tobytes() if ok else None

    def _sim_scan(self, cancel):
        self.on_event("map_scan")
        frames = []
        for k in range(12):
            if cancel.wait(0.35):
                return self._set("ready" if self.frames else "empty", "스캔을 멈췄어요")
            h = k * 30.0
            d = self._sim_ray(0, 0, h)
            frames.append({"heading": h, "dist": None if d > MAX_RANGE else round(d), "open": d > MAX_RANGE,
                           "jpg": self._sim_photo(h), "gray": None})
            self._set("scanning", f"방 둘러보는 중… {int(h)}° (흉내 모드)", h / 360)
        self.frames = frames
        self.scanned_at = int(time.time())
        self.pose = {"x": 0.0, "y": 0.0, "heading": 0.0}
        self.target = None
        self._set("ready", f"스캔 완료! 사진 {len(frames)}장 · 지도를 눌러 갈 곳을 고르세요", 1.0)
        self.on_event("map_scanned")

    def _sim_go(self, cancel):
        p, t = self.pose, self.target
        bearing = math.degrees(math.atan2(-(t["x"] - p["x"]), t["y"] - p["y"]))
        dist = math.hypot(t["x"] - p["x"], t["y"] - p["y"])
        self.on_event("map_go")
        start = p["heading"]
        diff = wrap(bearing - start)
        for k in range(1, 9):
            if cancel.wait(0.08):
                return self._set("ready", "멈췄어요")
            p["heading"] = wrap(start + diff * k / 8)
            self._set("turning", "방향 맞추는 중", 0.1)
        x0, y0, travelled = p["x"], p["y"], 0.0
        while travelled < dist:
            if cancel.wait(0.1):
                return self._set("ready", "멈췄어요")
            travelled = min(dist, travelled + CM_PER_SEC * 0.1 * 2)   # 흉내 모드는 2배속
            if self._sim_ray(p["x"], p["y"], bearing) < STOP_CM:
                self.on_event("map_blocked")
                return self._set("blocked", "앞에 뭔가 있어서 멈췄어요", travelled / dist)
            p["x"] = x0 - travelled * math.sin(math.radians(bearing))
            p["y"] = y0 + travelled * math.cos(math.radians(bearing))
            self._set("moving", f"가는 중… {int(dist - travelled)}cm 남음 (흉내 모드)", 0.2 + 0.8 * travelled / dist)
        self._set("arrived", "도착했어요!", 1.0)
        self.on_event("map_arrived")

    def _set(self, state, message, progress=None):
        self.status = {"state": state, "message": message,
                       "progress": round(self.status["progress"] if progress is None else progress, 2)}
        self.on_status(self.info())
