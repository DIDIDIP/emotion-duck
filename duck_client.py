"""이미 만든 골/홈런 감지 코드에서 감정 오리에게 사건을 알리는 도구.

사용법 (기존 코드에 두 줄만 추가):
    from duck_client import tell_duck
    tell_duck("goal")        # 골 감지했을 때
    tell_duck("homerun")     # 홈런 감지했을 때

명령줄에서 시험:
    python3 duck_client.py goal
    python3 duck_client.py mood:sad --host 192.168.0.23
"""
import json
import sys
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8000/rpc"


def tell_duck(event, source="sports-cam", url=DEFAULT_URL, timeout=1.0):
    """사건을 보내고 오리의 새 기분을 돌려준다. 서버가 꺼져 있어도 감지 코드는 멈추지 않는다."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "feel",
                       "params": {"event": event, "source": source}}).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            data = json.loads(res.read())
    except OSError as e:
        print(f"[duck] 서버에 연결하지 못함: {e}")
        return None
    if "error" in data:
        print(f"[duck] {data['error']['message']}")
        return None
    return data["result"]


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    host = sys.argv[sys.argv.index("--host") + 1] if "--host" in sys.argv else "127.0.0.1"
    print(tell_duck(sys.argv[1], source="cli", url=f"http://{host}:8000/rpc"))
