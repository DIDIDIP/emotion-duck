"""감정 오리 서버: 감정 엔진 + 라즈봇2 몸 + 집 찾기 + 휴대폰/PC 앱을 하나로 묶는다.

마이크로덕처럼 '모든 손님이 같은 호출을 쓴다'는 원칙을 따른다.
휴대폰 앱, 골/홈런 감지 코드, 손짓 인식 코드 모두 POST /rpc 로 같은 JSON-RPC 호출을 보낸다.

  {"jsonrpc":"2.0","id":1,"method":"feel","params":{"event":"goal","source":"soccer-cam"}}

메서드
  info            {}               연결 정보 (접속 주소, 실제 로봇인지, 카메라 유무)
  feel            {event, source?} 사건을 알린다 (emotion.EVENTS 이름 또는 "mood:sad")
  state           {}               지금 기분
  mood_history    {}               최근 5분 기분 기록 (그래프용)
  home_status     {}               집 찾기 상태
  home_register   {}               지금 카메라 가운데 보이는 색을 '집'으로 기억
  home_go         {}               집으로 오기 시작
  home_cancel     {}               집으로 오기 멈추기
  drive           {enabled}        바퀴 움직임 켜기/끄기
  game            {}               키우기 게임 상태 (레벨, 행복, 에너지, 표정 …)
  act             {action, ...}    행동: pet, snack, sleep, wake, rps{hand?}, come
  gesture         {name}           손짓 인식 결과: rock, scissors, paper, wave, thumbs_up, palm
  map             {}               방 지도 (스캔 사진 목록, 벽까지 거리, 로봇 위치)
  act scan / act goto{x,y}         방 스캔하기 / 지도 위치로 가기 (키우기 규칙 적용)
  map_cancel      {}               이동·스캔 멈추기
  act play        {game}           로봇 놀이 시작: mugunghwa, dance, fetch (결과는 자동으로 호감도에 반영)
  rgame           {}               놀이 진행 상황
  rgame_input     {move | touch}   놀이 입력: move=left/right/forward/back/nod (춤), touch=true (무궁화)
  rgame_cancel    {}               놀이 멈추기
  ball_register   {}               지금 카메라 가운데 보이는 색을 '공'으로 기억 (공 찾아오기)
  act hello       {}               앱을 열 때 인사 (그날 첫 방문 호감도 +2)
  cue             {color, beep?}   게임 신호: 로봇 불빛 색 + 삑

GET /stream      기분·집 찾기 상태를 실시간 전송 (Server-Sent Events)
GET /camera.jpg  로봇 카메라 화면 한 장
GET /scan/N.jpg  방 스캔 사진 N번

실행:  python3 server.py            (기본 포트 8000)
       python3 server.py --no-drive (바퀴 없이 고개·불빛·소리만)
       python3 server.py --boost 5  (발표 시연용: 경험치 5배)
"""
import argparse
import collections
import json
import mimetypes
import queue
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from emotion import EVENTS, USER_MOODS, EmotionEngine
from game import PetGame
from home import Camera, HomeFinder
from robotgames import RobotGames
from roommap import RoomMap
from robot import RobotBody

WEB_DIR = Path(__file__).parent / "web"
PORT = 8000

subscribers = set()
subscribers_lock = threading.Lock()
mood_samples = collections.deque(maxlen=300)   # 1초에 하나씩, 최근 5분


def broadcast(message):
    data = json.dumps(message, ensure_ascii=False)
    with subscribers_lock:
        for q in list(subscribers):
            try:
                q.put_nowait(data)
            except queue.Full:
                pass


def on_change(state, reaction, speech):
    if reaction:
        body.react(reaction, state["face"])
    msg = {"type": "feel", "state": state, "reaction": reaction, "speech": speech}
    if game:
        msg["pet"] = game.snapshot()
    broadcast(msg)


engine = EmotionEngine(on_change=on_change)
body = None   # main()에서 만든다
home = None
game = None
room = None
ball = None
rgames = None


def lan_addresses():
    """같은 와이파이의 휴대폰이 접속할 수 있는 이 컴퓨터의 주소."""
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))   # 실제로 보내지는 않고 나가는 길의 내 주소만 알아낸다
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    ips.discard("127.0.0.1")
    # 집·학교 와이파이 주소(192.168.x, 10.x, 172.16~31.x)를 앞에 둔다. 100.x 같은 VPN 주소는 뒤로
    def rank(ip):
        a, b = (int(x) for x in ip.split(".")[:2])
        private = a == 192 and b == 168 or a == 10 or a == 172 and 16 <= b <= 31
        return (not private, ip)
    return sorted(ips, key=rank)


def rpc(method, params):
    if method == "info":
        return {"name": socket.gethostname(), "robot": body.bot is not None,
                "camera": not home.simulated, "port": PORT,
                "urls": [f"http://{ip}:{PORT}" for ip in lan_addresses()]}
    if method == "feel":
        return engine.feel(params["event"], params.get("source", "app"))
    if method == "state":
        return engine.state()
    if method == "mood_history":
        return list(mood_samples)
    if method == "home_status":
        return home.info()
    if method == "home_register":
        return home.register()
    if method == "home_go":
        return home.go()
    if method == "home_cancel":
        return home.cancel()
    if method == "events":
        return {"events": list(EVENTS), "moods": ["mood:" + m for m in USER_MOODS]}
    if method == "cue":
        # 게임 신호: 로봇 불빛을 그 색으로 바꾸고 짧게 삑 (기다리지 않는다)
        rgb = {"red": (255, 40, 40), "yellow": (255, 200, 0), "green": (0, 220, 90), "blue": (40, 120, 255),
               "pink": (255, 90, 160), "off": (0, 0, 0)}.get(params.get("color"), (255, 255, 255))
        beep = bool(params.get("beep", True))
        threading.Thread(target=lambda: (body._led(*rgb), beep and body._beep(0.12, 0, 1)), daemon=True).start()
        return {"ok": True}
    if method == "map":
        return room.info()
    if method == "map_cancel":
        room.cancel()
        return room.info()
    if method == "game":
        return game.snapshot()
    if method == "act":
        params = dict(params)
        return game.act(params.pop("action"), **params)
    if method == "gesture":
        if rgames.gesture(params["name"]):        # 춤 놀이 중이면 손짓을 춤 입력으로
            return {"ok": True, "message": None}
        return game.act("gesture", name=params["name"])
    if method == "rgame":
        return rgames.status
    if method == "rgame_input":
        return {"ok": rgames.input(**{k: v for k, v in params.items() if k in ("move", "touch")})}
    if method == "rgame_cancel":
        rgames.cancel()
        return {"ok": True}
    if method == "ball_register":
        return ball.register()
    if method == "ball_status":
        return ball.info()
    if method == "drive":
        body.allow_drive = bool(params.get("enabled", True))
        return {"drive": body.allow_drive}
    raise LookupError(method)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body_bytes, ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body_bytes)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET")
        self.end_headers()

    def do_POST(self):
        if self.path != "/rpc":
            return self._send(404, b"{}")
        req_id = None
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            req_id = req.get("id")
            result = rpc(req.get("method"), req.get("params") or {})
            resp = {"jsonrpc": "2.0", "id": req_id, "result": result}
        except LookupError as e:
            resp = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": f"없는 메서드: {e}"}}
        except (ValueError, KeyError, TypeError) as e:
            resp = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32602, "message": str(e)}}
        self._send(200, json.dumps(resp, ensure_ascii=False).encode())

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/stream":
            return self._stream()
        if path.startswith("/scan/") and path.endswith(".jpg"):
            try:
                jpg = room.photo(int(path[6:-4]))
            except ValueError:
                jpg = None
            return self._send(200, jpg, "image/jpeg") if jpg else self._send(404, b"no photo", "text/plain")
        if path == "/camera.jpg":
            jpg = home.snapshot_jpeg()
            return self._send(200, jpg, "image/jpeg") if jpg else self._send(503, b"no camera", "text/plain")
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        file = (WEB_DIR / rel).resolve()
        if WEB_DIR.resolve() not in file.parents or not file.is_file():
            return self._send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, file.read_bytes(), ctype)

    def _stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        q = queue.Queue(maxsize=100)
        with subscribers_lock:
            subscribers.add(q)
        try:
            for first in ({"type": "state", "state": engine.state(), "pet": game.snapshot()},
                          {"type": "home", "home": home.info()}, {"type": "map", "map": room.info()},
                          {"type": "ball", "ball": ball.info()}, {"type": "rgame", "rgame": rgames.status}):
                self.wfile.write(f"data: {json.dumps(first, ensure_ascii=False)}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    data = q.get(timeout=15)
                    self.wfile.write(f"data: {data}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")   # 연결 유지
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        finally:
            with subscribers_lock:
                subscribers.discard(q)


def tick_loop():
    """1초마다 감정을 가라앉히고, 기분을 기록하고, 앱에 알린다."""
    last_face = None
    while True:
        time.sleep(1)
        engine.tick(1.0)
        pet = game.tick(1.0)
        state = engine.state()
        sample = {"t": round(time.time(), 1), "valence": state["valence"],
                  "arousal": state["arousal"], "bond": state["bond"]}
        mood_samples.append(sample)
        broadcast({"type": "state", "state": state, "sample": sample, "pet": pet})
        if state["face"] != last_face and last_face is not None:
            body.show_mood(state["face"])
        last_face = state["face"]


def main():
    global body, home, game, room, ball, rgames, PORT
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--camera", type=int, default=0, help="카메라 번호 (/dev/video0 이면 0)")
    ap.add_argument("--no-drive", action="store_true", help="바퀴는 움직이지 않기")
    ap.add_argument("--boost", type=int, default=1, help="경험치 배수 (발표 시연용)")
    args = ap.parse_args()
    PORT = args.port

    body = RobotBody(allow_drive=not args.no_drive)
    home = HomeFinder(body, Camera(args.camera),
                      on_event=lambda e: engine.feel(e, source="집 찾기"),
                      on_status=lambda info: broadcast({"type": "home", "home": info}))
    room = RoomMap(body, home.camera,
                   on_event=lambda e: engine.feel(e, source="방 지도"),
                   on_status=lambda info: broadcast({"type": "map", "map": info}))
    game = PetGame(engine, home, room, on_change=lambda pet: broadcast({"type": "pet", "pet": pet}),
                   xp_boost=args.boost)
    ball = HomeFinder(body, home.camera, name="ball", label="공", arrive=0.35,
                      on_event=lambda e: engine.feel(e, source="공 찾아오기"),
                      on_status=lambda info: broadcast({"type": "ball", "ball": info}))
    rgames = RobotGames(body, home.camera, ball,
                        on_status=lambda st: broadcast({"type": "rgame", "rgame": st}),
                        on_finish=lambda g, s, m: game.act("minigame", game=g, score=s, max_score=m))
    game.robotgames = rgames
    print("[home] " + ("흉내 모드 (카메라 또는 OpenCV 없음)" if home.simulated else "카메라 연결됨"))
    threading.Thread(target=tick_loop, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    for url in rpc("info", {})["urls"] or [f"http://127.0.0.1:{PORT}"]:
        print(f"[server] 휴대폰·PC 브라우저에서 {url} 접속")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        home.cancel()
        room.cancel()
        rgames.cancel()
        body.shutdown()


if __name__ == "__main__":
    main()
