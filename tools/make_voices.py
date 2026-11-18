"""Record every spoken sentence with Sarvam Bulbul and store the clips in web/audio/.

Runs in GitHub Actions (workflow "Make voices"); the key comes from the SARVAM_API_KEY secret.
Input: voice-lines.json from tools/voice_lines.mjs. Clips that already exist are skipped,
so running it again only pays for new or changed sentences.
Each clip is saved as web/audio/<voice>/<key>.ogg (Opus, mono), where key matches clipKey() in web/voice.js.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

KEY = os.environ["SARVAM_API_KEY"]
VOICES = {"vijay": "vijay_ta_narration", "ritu": "ritu_hi_sales"}
OUT = "web/audio"
MAX_CHARS = 40000  # safety limit per run (about ₹80 at ₹20 per 10,000 characters)


def clip_key(lang, text):
    h = 0x811C9DC5
    for b in f"{lang}|{text}".encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def speak(text, lang, speaker, pace):
    body = json.dumps({
        "text": text,
        "target_language_code": lang,
        "speaker": speaker,
        "model": "bulbul:v4-flash",
        "pace": pace,
        "speech_sample_rate": 24000,
        "output_audio_codec": "mp3",
        "enable_preprocessing": True,
    }).encode()
    req = urllib.request.Request(
        "https://api.sarvam.ai/text-to-speech", data=body,
        headers={"api-subscription-key": KEY, "Content-Type": "application/json"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            return b"".join(base64.b64decode(a) for a in data["audios"])
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {e.code}: {msg}")
        except (urllib.error.URLError, TimeoutError):
            if attempt < 5:
                time.sleep(3 * (attempt + 1))
                continue
            raise


def to_opus(mp3, path):
    with tempfile.NamedTemporaryFile(suffix=".mp3") as f:
        f.write(mp3)
        f.flush()
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f.name, "-ac", "1", "-c:a", "libopus",
                        "-b:a", "24k", "-application", "voip", path], check=True)


def main():
    lines = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "voice-lines.json", encoding="utf-8"))
    todo = []
    for voice in VOICES:
        os.makedirs(f"{OUT}/{voice}", exist_ok=True)
        for ln in lines:
            path = f"{OUT}/{voice}/{clip_key(ln['lang'], ln['text'])}.ogg"
            if not os.path.exists(path):
                todo.append((voice, ln, path))
    chars = sum(len(ln["say"]) for _, ln, _ in todo)
    print(f"{len(todo)} clips to make, {chars} characters")
    if chars > MAX_CHARS:
        sys.exit(f"Stopping: {chars} characters is over the safety limit of {MAX_CHARS}")

    failed = []
    for i, (voice, ln, path) in enumerate(todo, 1):
        try:
            to_opus(speak(ln["say"], ln["synthLang"], VOICES[voice], ln["pace"]), path)
        except Exception as e:  # keep going; a later run retries anything missing
            failed.append(f"{voice} {ln['lang']} {ln['text']}: {e}")
            if len(failed) >= 15:
                print("Too many failures, stopping early")
                break
        if i % 50 == 0:
            print(f"  {i}/{len(todo)}")
        time.sleep(0.2)

    # the manifest lists the clips the app can use (only ones that exist)
    wanted = {clip_key(ln["lang"], ln["text"]) for ln in lines}
    manifest = {}
    for voice in VOICES:
        have = {f[:-4] for f in os.listdir(f"{OUT}/{voice}") if f.endswith(".ogg")}
        manifest[voice] = sorted(have & wanted)
    json.dump(manifest, open(f"{OUT}/manifest.json", "w"), separators=(",", ":"))
    print({v: len(k) for v, k in manifest.items()}, "clips in the app")
    if failed:
        print("Failed:")
        print("\n".join(failed))


if __name__ == "__main__":
    main()
