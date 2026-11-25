"""Make a few sample clips with Sarvam Bulbul so we can choose spelling and pace.

Runs in GitHub Actions; the key comes from the SARVAM_API_KEY secret.
Writes mp3 files and a results.txt into voice-test/.
"""
import base64
import json
import os
import urllib.error
import urllib.request

KEY = os.environ["SARVAM_API_KEY"]
OUT = "voice-test"
os.makedirs(OUT, exist_ok=True)

VOICES = {"ritu": "ritu_hi_sales"}

# (file name, language, text, pace)
LINES = [
    ("c0_now_short", "en-IN", "Cobra pose", 0.95),
    ("c0_now_full", "en-IN", "Cobra pose, breathe in.", 0.95),
    ("c1_short", "en-IN", "Cobra pose", 1.0),
    ("c1_full", "en-IN", "Cobra pose, breathe in.", 1.0),
    ("c2_short", "en-IN", "Cobra.", 1.0),
    ("c2_full", "en-IN", "Cobra, breathe in.", 1.0),
    ("c3_short", "en-IN", "Cobra stretch", 1.0),
    ("c3_full", "en-IN", "Cobra stretch, breathe in.", 1.0),
    ("c4_short", "en-IN", "Bhujangasana", 1.0),
    ("c4_full", "en-IN", "Bhujangasana, breathe in.", 1.0),
]


def speak(text, lang, speaker, pace):
    body = json.dumps({
        "text": text,
        "target_language_code": lang,
        "speaker": speaker,
        "model": "bulbul:v4-flash",
        "pace": pace,
        "speech_sample_rate": 24000,
        "output_audio_codec": "mp3",
    }).encode()
    req = urllib.request.Request(
        "https://api.sarvam.ai/text-to-speech", data=body,
        headers={"api-subscription-key": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    return b"".join(base64.b64decode(a) for a in data["audios"])


log = []
chars = 0
for name, speaker in VOICES.items():
    for fname, lang, text, pace in LINES:
        path = f"{OUT}/{name}_{fname}.mp3"
        try:
            audio = speak(text, lang, speaker, pace)
            open(path, "wb").write(audio)
            chars += len(text)
            log.append(f"ok    {path}  ({len(audio)} bytes)")
        except urllib.error.HTTPError as e:
            log.append(f"FAIL  {path}  HTTP {e.code}: {e.read().decode()[:300]}")
        except Exception as e:  # keep going so one bad line doesn't stop the rest
            log.append(f"FAIL  {path}  {e}")

log.append(f"characters used: {chars}")
open(f"{OUT}/results.txt", "w").write("\n".join(log) + "\n")
print("\n".join(log))
