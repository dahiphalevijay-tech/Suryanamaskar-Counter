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

VOICES = {"vipul": "vipul_hi_social", "ritu": "ritu_hi_sales"}

# (file name, language, text, pace)
LINES = [
    ("1_english_085", "en-IN", "Raise your arms. Breathe in slowly.", 0.85),
    ("2_marathi_075", "mr-IN", "हात वर करा. हळू श्वास घ्या.", 0.75),
    ("3_marathi_085", "mr-IN", "हात वर करा. हळू श्वास घ्या.", 0.85),
    ("4_marathi_100", "mr-IN", "हात वर करा. हळू श्वास घ्या.", 1.0),
    ("5_hindi_085", "hi-IN", "हाथ ऊपर उठाइए. धीरे से साँस लीजिए.", 0.85),
    ("6_om_A_085", "hi-IN", "ओम् मित्राय नमः", 0.85),
    ("7_om_B_085", "hi-IN", "ओम मित्राय नमः", 0.85),
    ("8_om_C_085", "hi-IN", "ओम मित्राय नमह", 0.85),
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
