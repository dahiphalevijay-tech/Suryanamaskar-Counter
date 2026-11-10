# Suryanamaskar Counter

A camera-based suryanamaskar counter. The phone watches you through the camera, detects your body position on the device, and counts each full 12-step suryanamaskar aloud. Nothing is recorded or uploaded.

- **Practice**: camera counter with voice count, target and manual +1 / −1 correction
- **Learn**: animated guide to the 12 poses with names and breathing cues
- **Progress**: daily count, streak and 14-day history
- Languages: English, Marathi, Hindi

## How it is built

| Folder | What it is |
|---|---|
| `web/` | The app itself (HTML and JavaScript). `counter.js` holds the counting rules. |
| `android/` | A thin Android shell that shows `web/` and provides camera access and speech. |
| `tests/` | Automated checks for the counting rules. |
| `.github/workflows/build.yml` | Builds everything on every push. |

Every push to `main` runs the tests, publishes a browser test link (GitHub Pages), and builds a test APK that appears under **Releases → Test build**.

## One-time setup

In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Tuning the counter

Turn on **Progress → Show tuning numbers** to see `h` (shoulder height) and `k` (hip height) while practising. The thresholds are at the top of `web/counter.js`.
