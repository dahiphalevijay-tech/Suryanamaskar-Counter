// Recorded voice clips. Every sentence the app speaks was made once with Sarvam Bulbul
// (tools/make_voices.py) and is stored inside the app, so practice stays fully offline.
// A clip is found by a short hash of its language and text; anything without a clip
// falls back to the phone's own voice.

export const VOICE_IDS = { ritu: 'ritu_hi_sales' };

// FNV-1a over the UTF-8 bytes of "lang|text", as 8 hex digits (same in tools/make_voices.py).
export function clipKey(lang, text) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(`${lang}|${text}`)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export class ClipPlayer {
  constructor(base = 'audio') {
    this.base = base;
    this.have = {};          // voice -> Set of clip keys
    this.queue = [];
    this.audio = null;
    this.busy = false;
  }

  async load() {
    try {
      const r = await fetch(`${this.base}/manifest.json`);
      const m = await r.json();
      for (const [voice, keys] of Object.entries(m)) this.have[voice] = new Set(keys);
    } catch { /* no clips in this build: the phone voice is used */ }
  }

  // parts: [{ lang, text }]. Returns the clip keys, or null if any part has no clip.
  keys(voice, parts) {
    const set = this.have[voice];
    if (!set) return null;
    const out = [];
    for (const p of parts) {
      const k = clipKey(p.lang, String(p.text));
      if (!set.has(k)) return null;
      out.push(k);
    }
    return out;
  }

  // flush = stop what is playing and say this now; otherwise it waits its turn.
  play(voice, keys, flush = true) {
    const urls = keys.map((k) => `${this.base}/${voice}/${k}.ogg`);
    if (flush) { this.stop(); this.queue = urls; } else this.queue.push(...urls);
    if (!this.busy) this.next();
  }

  next() {
    const url = this.queue.shift();
    if (!url) { this.busy = false; return; }
    this.busy = true;
    const a = new Audio(url);
    this.audio = a;
    const done = () => { if (this.audio === a) this.next(); };
    a.onended = done;
    a.onerror = done;
    a.play().catch(done);
  }

  stop() {
    this.queue = [];
    if (this.audio) { const a = this.audio; this.audio = null; a.onended = a.onerror = null; try { a.pause(); } catch { /* ignore */ } }
    this.busy = false;
  }
}
