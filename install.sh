#!/usr/bin/env bash
# 라즈봇2에 감정 오리 설치: 필요한 패키지 확인 → 켜질 때 자동 실행(systemd) 등록
#   bash install.sh                 설치하고 자동 실행 등록
#   bash install.sh --no-service    자동 실행 없이 지금 한 번만 실행
#   PORT=8080 EXTRA="--no-drive" bash install.sh   포트·옵션 바꾸기
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8000}"
EXTRA="${EXTRA:-}"

echo "== 감정 오리 설치 ($DIR)"
if ! python3 -c "import cv2, numpy" 2>/dev/null; then
  echo "- OpenCV 설치 (이리 와, 방 지도, 무궁화, 공 찾아오기에 필요)"
  sudo apt-get update && sudo apt-get install -y python3-opencv python3-numpy
fi
if python3 -c "import Raspbot_Lib" 2>/dev/null; then
  echo "- 라즈봇2 라이브러리 확인"
else
  echo "! Raspbot_Lib 이 없어요. 바퀴·고개·불빛은 흉내 모드로 동작해요 (Yahboom 라즈봇2 이미지·튜토리얼 참고)"
fi

if [ "$1" = "--no-service" ]; then
  echo "== 바로 실행 (끄려면 Ctrl+C)"
  exec python3 "$DIR/server.py" --port "$PORT" $EXTRA
fi

sudo tee /etc/systemd/system/emotion-duck.service >/dev/null <<EOF
[Unit]
Description=Emotion Duck robot app
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR
ExecStart=/usr/bin/python3 $DIR/server.py --port $PORT $EXTRA
Restart=on-failure
RestartSec=3
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now emotion-duck
sleep 2

IP=$(hostname -I | awk '{print $1}')
echo "== 완료! 휴대폰·PC 브라우저에서 http://$IP:$PORT"
echo "   상태 보기   systemctl status emotion-duck"
echo "   기록 보기   journalctl -u emotion-duck -f"
echo "   업데이트    git pull && sudo systemctl restart emotion-duck"
echo "   자동 실행 끄기  sudo systemctl disable --now emotion-duck"
