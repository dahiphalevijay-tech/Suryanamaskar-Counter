// Draws the shareable summary card (1080 x 1920, the size WhatsApp status and other stories use) and shares it.

const font = (px, weight = 700) => `${weight} ${px}px system-ui, "Noto Sans Devanagari", sans-serif`;
function fit(c, text, maxW, px, weight = 700) {
  let s = px;
  do { c.font = font(s, weight); s -= 2; } while (c.measureText(text).width > maxW && s > 22);
}

// d: { app, date, count, label, stats: [{value, label}], streakText }.  photo: the sunrise picture, if loaded.
export function drawShareCard(canvas, d, photo) {
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const DARK = '#1F0D06';
  c.fillStyle = DARK; c.fillRect(0, 0, W, H);

  if (photo && photo.complete && photo.naturalWidth) {
    const side = 1200;                                   // the square photo, slightly enlarged, centred
    c.drawImage(photo, (W - side) / 2, 0, side, side);
  } else {
    const sky = c.createLinearGradient(0, 0, 0, 1200);
    sky.addColorStop(0, '#E9B79C'); sky.addColorStop(0.5, '#F29B45'); sky.addColorStop(1, '#B8430F');
    c.fillStyle = sky; c.fillRect(0, 0, W, 1200);
  }
  // fade the picture into the dark lower half
  const fade = c.createLinearGradient(0, 930, 0, 1215);
  fade.addColorStop(0, 'rgba(31,13,6,0)'); fade.addColorStop(1, DARK);
  c.fillStyle = fade; c.fillRect(0, 930, W, 290);
  // a soft shade behind the title
  const top = c.createLinearGradient(0, 0, 0, 220);
  top.addColorStop(0, 'rgba(31,13,6,.45)'); top.addColorStop(1, 'rgba(31,13,6,0)');
  c.fillStyle = top; c.fillRect(0, 0, W, 220);

  c.fillStyle = '#FFF4E0';
  c.textAlign = 'left'; c.font = font(54, 800); c.fillText(d.app, 64, 112);
  c.textAlign = 'right'; c.font = font(38, 600); c.fillText(d.date, W - 64, 108);

  c.textAlign = 'center';
  c.fillStyle = '#FFF4E0'; c.font = font(320, 800); c.fillText(String(d.count), W / 2, 1470);
  c.fillStyle = '#FFD98A'; fit(c, d.label, W - 160, 62); c.fillText(d.label, W / 2, 1560);

  const stats = d.stats.slice(0, 3);
  const colW = W / Math.max(1, stats.length);
  stats.forEach((st, i) => {
    const x = colW * (i + 0.5);
    c.fillStyle = '#FFF4E0'; fit(c, st.value, colW - 50, 66); c.fillText(st.value, x, 1690);
    c.fillStyle = '#C9A27F'; fit(c, st.label, colW - 40, 34, 500); c.fillText(st.label, x, 1742);
  });

  if (d.streakText) {
    c.font = font(42, 800);
    const w = Math.max(360, c.measureText(d.streakText).width + 110);
    c.fillStyle = '#F7A93B'; c.beginPath(); c.roundRect((W - w) / 2, 1796, w, 84, 42); c.fill();
    c.fillStyle = DARK; c.fillText(d.streakText, W / 2, 1853);
  }
}

// Hands the card to the phone's share sheet (WhatsApp status, Instagram and so on).
export async function shareCard(canvas, text) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  try {
    if (window.AndroidBridge && window.AndroidBridge.shareImage) {
      window.AndroidBridge.shareImage(dataUrl.split(',')[1], text);
      return 'app';
    }
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    const file = new File([blob], 'suryanamaskar.jpg', { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return 'web';
    }
    const a = document.createElement('a');
    a.href = dataUrl; a.download = 'suryanamaskar.jpg';
    document.body.append(a); a.click(); a.remove();
    return 'download';
  } catch (e) {
    console.error(e);
    return 'failed';
  }
}
