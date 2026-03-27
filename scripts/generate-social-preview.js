#!/usr/bin/env node
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const W = 1280, H = 640;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// ═══ DOOM-STYLE BACKGROUND ═══

// Sky gradient
const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.45);
skyGrad.addColorStop(0, '#0d0521');
skyGrad.addColorStop(1, '#1a0a2e');
ctx.fillStyle = skyGrad;
ctx.fillRect(0, 0, W, H * 0.45);

// Floor gradient
const floorGrad = ctx.createLinearGradient(0, H * 0.55, 0, H);
floorGrad.addColorStop(0, '#2a1a0a');
floorGrad.addColorStop(1, '#0a0500');
ctx.fillStyle = floorGrad;
ctx.fillRect(0, H * 0.55, W, H * 0.45);

// Horizon lava glow
const lavaGrad = ctx.createLinearGradient(0, H * 0.42, 0, H * 0.58);
lavaGrad.addColorStop(0, 'rgba(255,68,0,0)');
lavaGrad.addColorStop(0.4, 'rgba(255,68,0,0.15)');
lavaGrad.addColorStop(0.5, 'rgba(255,68,0,0.3)');
lavaGrad.addColorStop(0.6, 'rgba(255,68,0,0.15)');
lavaGrad.addColorStop(1, 'rgba(255,68,0,0)');
ctx.fillStyle = lavaGrad;
ctx.fillRect(0, H * 0.42, W, H * 0.16);

// Pixelated wall helper
function drawWall(x, y, w, h, color, darkColor) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = darkColor;
  for (let py = y; py < y + h; py += 8) {
    for (let px = x; px < x + w; px += 8) {
      if (Math.random() > 0.6) {
        ctx.fillRect(px, py, 4, 4);
      }
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x + w - 4, y, 4, h);
}

// Corridor walls
drawWall(0, 80, 180, 400, '#4a3520', '#352818');
drawWall(180, 120, 120, 320, '#5a4530', '#4a3520');
drawWall(1100, 80, 180, 400, '#4a3520', '#352818');
drawWall(980, 120, 120, 320, '#5a4530', '#4a3520');

// Pillars
drawWall(340, 140, 50, 300, '#3a3a3a', '#2a2a2a');
drawWall(890, 140, 50, 300, '#3a3a3a', '#2a2a2a');

// Green armor glow
ctx.fillStyle = 'rgba(0, 255, 0, 0.08)';
ctx.beginPath();
ctx.arc(640, 420, 80, 0, Math.PI * 2);
ctx.fill();
ctx.fillStyle = '#1a4a1a';
ctx.fillRect(620, 400, 40, 40);

// Health pack
ctx.fillStyle = '#cc0000';
ctx.fillRect(450, 430, 24, 24);
ctx.fillStyle = '#ffffff';
ctx.fillRect(458, 432, 8, 20);
ctx.fillRect(452, 438, 20, 8);

// Blood splatters
function drawBlood(x, y, size) {
  ctx.fillStyle = '#8b0000';
  ctx.fillRect(x, y, size, size);
  ctx.fillRect(x - 4, y + 4, size/2, size/2);
  ctx.fillRect(x + size, y - 2, size/3, size/3);
}
drawBlood(500, 380, 12);
drawBlood(750, 400, 8);
drawBlood(850, 420, 10);

// ═══ HUD BAR ═══
ctx.fillStyle = '#1a1a1a';
ctx.fillRect(0, H - 70, W, 70);
ctx.fillStyle = '#333';
ctx.fillRect(0, H - 70, W, 2);

// HUD face
const faceX = 610, faceY = H - 58;
ctx.fillStyle = '#c8a070';
ctx.fillRect(faceX, faceY, 40, 40);
ctx.fillStyle = '#fff';
ctx.fillRect(faceX + 8, faceY + 10, 8, 8);
ctx.fillRect(faceX + 24, faceY + 10, 8, 8);
ctx.fillStyle = '#000';
ctx.fillRect(faceX + 10, faceY + 12, 4, 4);
ctx.fillRect(faceX + 26, faceY + 12, 4, 4);
ctx.fillStyle = '#8b0000';
ctx.fillRect(faceX + 14, faceY + 26, 12, 6);

// HUD numbers
ctx.fillStyle = '#cc0000';
ctx.font = 'bold 32px "Courier New", monospace';
ctx.fillText('100%', 80, H - 24);
ctx.fillStyle = '#cccc00';
ctx.fillText('50', 1080, H - 24);
ctx.fillStyle = '#4488ff';
ctx.fillText('2', 1180, H - 24);
ctx.fillStyle = '#888';
ctx.font = '14px "Courier New", monospace';
ctx.fillText('HEALTH', 80, H - 52);
ctx.fillText('AMMO', 1080, H - 52);
ctx.fillText('ARMS', 1180, H - 52);

// ═══ PIXEL TEXT RENDERER ═══
const PIXEL_CHARS = {
  'D': [[1,1,1,0],[1,0,0,1],[1,0,0,1],[1,0,0,1],[1,1,1,0]],
  'O': [[0,1,1,0],[1,0,0,1],[1,0,0,1],[1,0,0,1],[0,1,1,0]],
  'M': [[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'L': [[1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,1,1]],
  'B': [[1,1,1,0],[1,0,0,1],[1,1,1,0],[1,0,0,1],[1,1,1,0]],
  'Y': [[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
};

function drawPixelText(text, startX, startY, pixSize, color, shadowColor) {
  // Shadow pass
  if (shadowColor) {
    let x = startX + 3;
    for (const ch of text) {
      const grid = PIXEL_CHARS[ch];
      if (!grid) { x += pixSize * 2; continue; }
      ctx.fillStyle = shadowColor;
      for (let row = 0; row < grid.length; row++) {
        for (let col = 0; col < grid[row].length; col++) {
          if (grid[row][col]) {
            ctx.fillRect(x + col * pixSize, startY + 3 + row * pixSize, pixSize, pixSize);
          }
        }
      }
      x += (grid[0].length + 1) * pixSize;
    }
  }

  // Main pass
  let x = startX;
  for (const ch of text) {
    const grid = PIXEL_CHARS[ch];
    if (!grid) { x += pixSize * 2; continue; }
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        if (grid[row][col]) {
          ctx.fillStyle = color;
          ctx.fillRect(x + col * pixSize, startY + row * pixSize, pixSize, pixSize);
          // Highlight on top edge
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.fillRect(x + col * pixSize, startY + row * pixSize, pixSize, 2);
        }
      }
    }
    x += (grid[0].length + 1) * pixSize;
  }
}

// Calculate text widths for centering
function textPixelWidth(text, pixSize) {
  let w = 0;
  for (const ch of text) {
    const grid = PIXEL_CHARS[ch];
    if (!grid) { w += pixSize * 2; continue; }
    w += (grid[0].length + 1) * pixSize;
  }
  return w - pixSize; // remove trailing gap
}

// "DOOM" — big
const pxSize = 18;
const doomW = textPixelWidth('DOOM', pxSize);
const doomX = (W - doomW) / 2;
const titleY = 90;
drawPixelText('DOOM', doomX, titleY, pxSize, '#cc0000', '#330000');

// "LOBBY" — slightly smaller, orange
const pxSize2 = 14;
const lobbyW = textPixelWidth('LOBBY', pxSize2);
const lobbyX = (W - lobbyW) / 2;
const subY = titleY + 5 * pxSize + 24;
drawPixelText('LOBBY', lobbyX, subY, pxSize2, '#ff6600', '#331100');

// Tagline
ctx.fillStyle = '#888';
ctx.font = '20px "Courier New", monospace';
ctx.textAlign = 'center';
ctx.fillText('click link. play doom. kill friends.', W / 2, subY + 5 * pxSize2 + 36);

// ═══ POST-PROCESSING ═══

// Scanlines
ctx.fillStyle = 'rgba(0,0,0,0.06)';
for (let y = 0; y < H; y += 4) {
  ctx.fillRect(0, y, W, 2);
}

// Vignette
const vigGrad = ctx.createRadialGradient(W/2, H/2, W*0.3, W/2, H/2, W*0.7);
vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
vigGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
ctx.fillStyle = vigGrad;
ctx.fillRect(0, 0, W, H);

// ═══ SAVE ═══
const out = path.join(__dirname, '..', 'public', 'social-preview.png');
const buf = canvas.toBuffer('image/png');
fs.writeFileSync(out, buf);
console.log(`Saved ${out} (${(buf.length / 1024).toFixed(0)} KB)`);

// Also copy to Desktop for GitHub upload
const desktop = path.join(process.env.HOME, 'Desktop', 'doom-lobby-social.png');
fs.writeFileSync(desktop, buf);
console.log(`Copied to ${desktop}`);
