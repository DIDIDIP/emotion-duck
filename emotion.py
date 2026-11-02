"""감정 엔진: 사건(event)을 받아 로봇의 기분을 계산한다.

기분은 두 축으로 표현한다 (심리학의 Russell 감정 원형 모델).
  - valence(쾌/불쾌): -1(싫음) ~ +1(좋음)
  - arousal(각성):    -1(졸림) ~ +1(흥분)
여기에 사용자와의 친밀도(bond, 0~1)를 더해 "누구와 함께 기뻐하는지"를 기억한다.
기분은 시간이 지나면 기본값으로 천천히 돌아오고, 오래 아무 일이 없으면 심심해하다 잠든다.
"""
import math
import threading
import time

# 사건 → (valence 변화, arousal 변화, bond 변화, 반응 동작 이름, 말풍선)
EVENTS = {
    # 스포츠 관전 (기존 골/홈런 감지 코드가 보내는 사건)
    "goal":          (+0.7, +0.8, +0.05, "celebrate", "골이다! 꽥꽥!"),
    "homerun":       (+0.8, +0.9, +0.05, "celebrate", "홈런! 넘어갔다!"),
    "chance_missed": (-0.3, +0.4, 0.0,   "frustrated", "아깝다…!"),
    "conceded":      (-0.6, +0.3, 0.0,   "sad", "실점했어… 괜찮아, 아직 시간 있어"),
    "win":           (+0.9, +0.6, +0.1,  "celebrate", "우리가 이겼어!"),
    "lose":          (-0.7, -0.3, +0.02, "sad", "졌다… 다음엔 이길 거야"),
    # 사람과의 상호작용
    "wave":          (+0.3, +0.3, +0.03, "greet", "안녕! 반가워"),
    "pet":           (+0.4, -0.2, +0.06, "content", "쓰담쓰담 💕"),
    "thumbs_up":     (+0.4, +0.3, +0.03, "proud", "칭찬 고마워!"),
    "scold":         (-0.5, +0.3, -0.04, "flinch", "앗… 미안해"),
    "play":          (+0.5, +0.6, +0.04, "excited", "놀자 놀자!"),
    "loud_noise":    (-0.2, +0.7, 0.0,   "startle", "깜짝이야!"),
    # 키우기 게임 (game.py가 보내는 사건)
    "snack":         (+0.5, +0.4, +0.04, "excited", "냠냠! 맛있다 🍪"),
    "sleep_now":     (0.0,  -0.8, +0.02, "sleep", "잘 자… Zzz"),
    "wake":          (+0.1, +0.3, 0.0,   "greet", "하암~ 잘 잤다!"),
    "rps_win":       (+0.5, +0.5, +0.02, "celebrate", "내가 이겼다!"),
    "rps_lose":      (-0.3, +0.3, +0.03, "frustrated", "으앗, 졌다! 한 판 더?"),
    "rps_draw":      (+0.1, +0.3, +0.02, "excited", "비겼다! 다시 해!"),
    "level_up":      (+0.7, +0.6, +0.05, "celebrate", "레벨 업!"),
    "game_great":    (+0.7, +0.5, +0.05, "celebrate", "최고야!"),
    "game_good":     (+0.4, +0.3, +0.03, "proud", "재밌었다!"),
    "game_try":      (+0.2, 0.0,  +0.02, "content", "괜찮아, 즐거웠어!"),
    "affection_up":  (+0.8, +0.5, +0.06, "celebrate", "우리 더 친해졌어!"),
    "hello":         (+0.3, +0.2, +0.02, "greet", "안녕!"),
    "trick_show":      (+0.5, +0.5, +0.02, "excited", "짠~ 개인기!"),
    "trick_praised":   (+0.5, +0.3, +0.03, "proud", "칭찬 받았다!"),
    "trick_learned":   (+0.8, +0.5, +0.06, "celebrate", "개인기를 배웠어!"),
    "trick_confused":  (-0.1, +0.4, 0.0,   None, "헷갈려…"),
    "trick_unpraised": (-0.2, -0.1, 0.0,   None, "다시 연습해 볼게"),
    "dress_up":      (+0.4, +0.3, +0.02, "proud", "어때? 잘 어울려?"),
    "too_tired":     (-0.1, -0.4, 0.0,   None, "너무 졸려… 재워 줘"),
    "lonely":        (-0.3, -0.1, 0.0,   "sad", "심심해… 놀아 줘"),
    # 방 지도 (roommap.py가 보내는 사건)
    "map_scan":      (+0.1, +0.4, 0.0,   None, "방을 한 바퀴 둘러볼게! 빙글빙글~"),
    "map_scanned":   (+0.4, +0.2, +0.02, "proud", "다 봤어! 지도에서 갈 곳을 골라 줘"),
    "map_go":        (+0.2, +0.4, 0.0,   None, "거기로 갈게!"),
    "map_arrived":   (+0.5, 0.0,  +0.03, "content", "도착! 여기 맞지?"),
    "map_blocked":   (-0.3, +0.5, 0.0,   "startle", "앗, 앞에 뭐가 있어!"),
    # 공 찾아오기 놀이 (home.py 의 색 추적기를 '공'으로 쓴다). 바퀴는 놀이가 쓰므로 반응 동작 없음
    "ball_search":   (+0.2, +0.5, 0.0,   None, "공 어디 있지? 킁킁"),
    "ball_found":    (+0.4, +0.5, 0.0,   None, "공 발견! 간다~"),
    "ball_arrived":  (+0.5, +0.3, +0.02, None, "잡았다! ⚽"),
    "ball_failed":   (-0.3, +0.2, 0.0,   None, "공을 못 찾겠어…"),
    # 집으로 오기 (home.py가 보내는 사건). 바퀴는 집 찾기가 쓰므로 고개·불빛 반응만 둔다
    "home_search":   (+0.1, +0.3, 0.0,   None, "집이 어디 있더라… 두리번두리번"),
    "home_found":    (+0.3, +0.3, 0.0,   None, "찾았다! 저기가 우리 집이야"),
    "home_arrived":  (+0.5, -0.3, +0.03, "content", "집에 도착! 역시 집이 최고야"),
    "home_failed":   (-0.4, +0.2, 0.0,   "frustrated", "집을 못 찾겠어… 도와줄래?"),
}

# 사용자의 기분 → 로봇이 공감하는 방식
# 더하기가 아니라 '목표 기분 쪽으로 맞춰가기'다. 신나 있다가도 사용자가 슬프다고 하면 차분해진다.
# 기쁨은 함께 기뻐하고(mirroring), 슬픔·화남에는 차분하게 위로한다(comforting).
# (목표 valence, 목표 arousal, bond 변화, 반응 동작, 말풍선)
USER_MOODS = {
    "happy":  (+0.8, +0.6, +0.03, "celebrate", "너도 기쁘구나! 나도 신나!"),
    "sad":    (-0.4, -0.4, +0.06, "comfort",   "많이 속상했지… 내가 옆에 있을게"),
    "angry":  (-0.2, -0.3, +0.03, "comfort",   "화날 만했어. 같이 숨 한번 크게 쉬자"),
    "tired":  (+0.2, -0.6, +0.03, "comfort",   "오늘 고생 많았어. 좀 쉬자"),
    "bored":  (+0.4, +0.6, +0.03, "excited",   "그럼 나랑 놀자!"),
}
EMPATHY = 0.85  # 사용자 기분 쪽으로 얼마나 맞춰갈지 (0~1)

# 기분 공간에서의 대표 감정 (valence, arousal, 표정 이름, 한국어)
LABELS = [
    (+0.8, +0.7, "joy",       "신남"),
    (+0.6, -0.4, "content",   "편안"),
    (+0.1, +0.8, "surprised", "놀람"),
    (-0.6, +0.6, "angry",     "속상"),
    (-0.7, -0.4, "sad",       "슬픔"),
    (0.0,  -0.8, "sleepy",    "졸림"),
    (0.0,  0.0,  "neutral",   "보통"),
]

BASELINE = (0.1, 0.0)      # 아무 일 없을 때 돌아가는 기분 (살짝 긍정)
HALF_LIFE = 20.0           # 감정이 절반으로 가라앉는 시간(초)
BORED_AFTER = 60.0         # 이만큼 아무 일이 없으면 심심해함
SLEEP_AFTER = 180.0        # 이만큼 아무 일이 없으면 잠듦


def _clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


class EmotionEngine:
    def __init__(self, on_change=None):
        self.valence, self.arousal = BASELINE
        self.bond = 0.3
        self.last_event_at = time.time()
        self.asleep = False
        self.on_change = on_change   # (state, reaction, speech) 를 받는 콜백
        self.history = []            # 최근 사건 기록
        self._lock = threading.Lock()

    # ---------- 바깥에서 부르는 함수 ----------
    def feel(self, event, source="app", speech=None):
        """사건 하나를 겪는다. speech를 주면 기본 말풍선 대신 쓴다. 알 수 없는 사건이면 ValueError."""
        is_mood = event.startswith("mood:")
        table = USER_MOODS if is_mood else EVENTS
        key = event.split(":", 1)[1] if is_mood else event
        if key not in table:
            raise ValueError(f"모르는 사건: {event}")
        dv, da, db, reaction, default_speech = table[key]
        speech = speech or default_speech

        with self._lock:
            woke = self.asleep
            self.asleep = False
            if is_mood:
                # 사용자 기분(dv, da = 목표 기분) 쪽으로 맞춰간다
                self.valence += (dv - self.valence) * EMPATHY
                self.arousal += (da - self.arousal) * EMPATHY
                dv = 0   # 아래의 '친할수록 기쁨 증폭'은 사건에만 적용
            else:
                # 이미 같은 방향 감정이 크면 덜 오르도록(포화) 남은 여유에 비례해 더한다
                self.valence = _clamp(self.valence + dv * (1 - abs(self.valence) * 0.5))
                self.arousal = _clamp(self.arousal + da * (1 - abs(self.arousal) * 0.5))
            self.bond = _clamp(self.bond + db, 0.0, 1.0)
            self.last_event_at = time.time()
            # 친한 사람과 함께라면 기쁨이 더 커진다
            if dv > 0:
                self.valence = _clamp(self.valence + 0.15 * self.bond * dv)
            if woke:
                speech = "하암… 깼다! " + speech
            self.history.append({"t": self.last_event_at, "event": event,
                                 "source": source, "speech": speech})
            self.history = self.history[-50:]
        self._emit(reaction, speech)
        return self.state()

    def tick(self, dt):
        """주기적으로 불러 감정을 기본값으로 되돌리고 심심함/졸림을 처리한다."""
        idle = time.time() - self.last_event_at
        k = math.exp(-math.log(2) * dt / HALF_LIFE)
        reaction = speech = None
        with self._lock:
            bv, ba = BASELINE
            if idle > BORED_AFTER:
                ba = -0.6   # 심심하면 점점 졸려진다
            self.valence = bv + (self.valence - bv) * k
            self.arousal = ba + (self.arousal - ba) * k
            if idle > SLEEP_AFTER and not self.asleep:
                self.asleep = True
                reaction, speech = "sleep", "Zzz…"
        if reaction:
            self._emit(reaction, speech)

    def state(self):
        with self._lock:
            face, ko = ("sleepy", "잠듦") if self.asleep else self._label()
            return {
                "valence": round(self.valence, 3),
                "arousal": round(self.arousal, 3),
                "bond": round(self.bond, 3),
                "face": face,
                "label": ko,
                "asleep": self.asleep,
                "history": self.history[-10:],
            }

    # ---------- 내부 ----------
    def _label(self):
        best = min(LABELS, key=lambda l: (l[0] - self.valence) ** 2 + (l[1] - self.arousal) ** 2)
        return best[2], best[3]

    def _emit(self, reaction, speech):
        if self.on_change:
            self.on_change(self.state(), reaction, speech)
