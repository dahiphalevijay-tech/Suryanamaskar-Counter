// Draws the shareable summary card (1080 x 1920, the size WhatsApp status and other stories use) and shares it.

export function drawShareCard(canvas, d) {
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const horizon = 860;
  const font = (px, weight = 700) => `${weight} ${px}px system-ui, "Noto Sans Devanagari", sans-serif`;
  c.fillStyle = '#B8430F'; c.fillRect(0, 0, W, H);

  // rising sun and rays
  c.fillStyle = '#FFC861';
  c.beginPath(); c.arc(W / 2, horizon, 300, Math.PI, 0); c.fill();
  c.strokeStyle = '#FFC861'; c.lineWidth = 26; c.lineCap = 'round';
  for (let i = 1; i < 12; i++) {
    const a = Math.PI + (i * Math.PI) / 12;
    c.beginPath(); c.moveTo(W / 2 + 350 * Math.cos(a), horizon + 350 * Math.sin(a));
    c.lineTo(W / 2 + 430 * Math.cos(a), horizon + 430 * Math.sin(a)); c.stroke();
  }
  c.fillStyle = '#7A2E0E'; c.fillRect(0, horizon, W, H - horizon);

  // figure with raised arms, standing on the horizon
  c.save();
  c.translate(W / 2, horizon + 14); c.scale(7.4, 7.4); c.translate(-54, -88);
  c.strokeStyle = '#FFF4E0'; c.fillStyle = '#FFF4E0'; c.lineCap = 'round'; c.lineJoin = 'round';
  const line = (w, draw) => { c.lineWidth = w; c.beginPath(); draw(); c.stroke(); };
  line(7, () => { c.moveTo(54, 52); c.lineTo(54, 71); });
  line(4.4, () => { c.moveTo(52, 71); c.lineTo(51.4, 88); c.moveTo(56, 71); c.lineTo(56.6, 88); });
  line(3.3, () => { c.moveTo(50.4, 54); c.quadraticCurveTo(42, 42, 53.2, 27); c.moveTo(57.6, 54); c.quadraticCurveTo(66, 42, 54.8, 27); });
  c.beginPath(); c.arc(54, 43.5, 4.9, 0, Math.PI * 2); c.fill();
  c.restore();

  c.textAlign = 'center';
  c.fillStyle = '#FFF4E0';
  c.font = font(300, 800); c.fillText(String(d.count), W / 2, horizon + 330);
  c.font = font(64, 700); c.fillText(d.label, W / 2, horizon + 430);
  c.fillStyle = '#FFC861';
  c.font = font(42, 500); c.fillText(d.date, W / 2, horizon + 505);

  const stats = d.stats.slice(0, 3);
  const colW = W / Math.max(1, stats.length);
  stats.forEach((st, i) => {
    const x = colW * (i + 0.5);
    c.fillStyle = '#FFF4E0'; c.font = font(68, 700); c.fillText(st.value, x, horizon + 690);
    c.fillStyle = '#FFC861'; c.font = font(36, 500); c.fillText(st.label, x, horizon + 745);
  });
  c.fillStyle = '#FFC861'; c.font = font(46, 700); c.fillText(d.footer, W / 2, H - 90);
}

// Hands the card to the phone's share sheet (WhatsApp status, Instagram and so on).
export async function shareCard(canvas, text) {
  const dataUrl = canvas.toDataURL('image/png');
  try {
    if (window.AndroidBridge && window.AndroidBridge.shareImage) {
      window.AndroidBridge.shareImage(dataUrl.split(',')[1], text);
      return 'app';
    }
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const file = new File([blob], 'suryanamaskar.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return 'web';
    }
    const a = document.createElement('a');
    a.href = dataUrl; a.download = 'suryanamaskar.png';
    document.body.append(a); a.click(); a.remove();
    return 'download';
  } catch (e) {
    console.error(e);
    return 'failed';
  }
}
