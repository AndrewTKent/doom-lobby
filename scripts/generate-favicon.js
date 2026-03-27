#!/usr/bin/env node
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// 32x32 pixel art Doomguy face
const SIZE = 32;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// Transparent background
ctx.clearRect(0, 0, SIZE, SIZE);

// Color palette (DOOM status bar face colors)
const SKIN = '#c8a070';
const SKIN_DARK = '#a07848';
const SKIN_LIGHT = '#d8b888';
const HAIR = '#583820';
const EYE_WHITE = '#e8e8e8';
const PUPIL = '#181818';
const MOUTH = '#701818';
const MOUTH_DARK = '#501010';
const TEETH = '#d8d0c0';
const BG = '#1a1a1a';

function px(x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

// Background circle (dark)
ctx.fillStyle = BG;
ctx.beginPath();
ctx.arc(16, 16, 15, 0, Math.PI * 2);
ctx.fill();

// Hair / top of head
rect(10, 4, 12, 3, HAIR);
rect(9, 5, 14, 2, HAIR);
rect(8, 6, 16, 2, HAIR);

// Face shape
rect(9, 7, 14, 2, SKIN_LIGHT);  // forehead
rect(8, 9, 16, 2, SKIN);         // upper face
rect(8, 11, 16, 2, SKIN);        // mid face
rect(8, 13, 16, 4, SKIN);        // lower face
rect(9, 17, 14, 2, SKIN);        // chin
rect(10, 19, 12, 1, SKIN_DARK);  // jaw

// Brow ridge (darker)
rect(9, 9, 5, 1, SKIN_DARK);
rect(18, 9, 5, 1, SKIN_DARK);

// Eyes - white
rect(10, 10, 4, 3, EYE_WHITE);
rect(18, 10, 4, 3, EYE_WHITE);

// Pupils (looking forward)
rect(12, 11, 2, 2, PUPIL);
rect(20, 11, 2, 2, PUPIL);

// Nose
rect(15, 12, 2, 2, SKIN_DARK);
rect(15, 14, 2, 1, SKIN_DARK);

// Mouth - grimace
rect(11, 16, 10, 2, MOUTH);
rect(12, 16, 8, 1, MOUTH_DARK);

// Teeth (grimacing)
rect(12, 16, 2, 1, TEETH);
rect(15, 16, 2, 1, TEETH);
rect(18, 16, 2, 1, TEETH);

// Blood splatter (classic Doomguy)
px(7, 12, '#a01010');
px(7, 13, '#c01818');
px(8, 14, '#a01010');
px(24, 11, '#a01010');
px(24, 12, '#c01818');

// Side of face / ears
rect(7, 10, 1, 6, SKIN_DARK);
rect(24, 10, 1, 6, SKIN_DARK);

// Save as PNG first
const pngPath = path.join(__dirname, '..', 'public', 'favicon-32.png');
fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));

// Generate 16x16 version
const canvas16 = createCanvas(16, 16);
const ctx16 = canvas16.getContext('2d');
ctx16.imageSmoothingEnabled = false;
ctx16.drawImage(canvas, 0, 0, 16, 16);
const png16Path = path.join(__dirname, '..', 'public', 'favicon-16.png');
fs.writeFileSync(png16Path, canvas16.toBuffer('image/png'));

// Build ICO file (contains both 16x16 and 32x32)
function buildIco(images) {
  const count = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * count;

  let offset = headerSize + dirSize;
  const entries = [];
  const pngBuffers = [];

  for (const img of images) {
    const buf = img.toBuffer('image/png');
    pngBuffers.push(buf);
    entries.push({
      width: img.width === 256 ? 0 : img.width,
      height: img.height === 256 ? 0 : img.height,
      offset: offset,
      size: buf.length,
    });
    offset += buf.length;
  }

  const ico = Buffer.alloc(offset);
  // Header
  ico.writeUInt16LE(0, 0);      // reserved
  ico.writeUInt16LE(1, 2);      // type (1 = ICO)
  ico.writeUInt16LE(count, 4);  // count

  // Directory entries
  for (let i = 0; i < count; i++) {
    const e = entries[i];
    const pos = headerSize + i * dirEntrySize;
    ico.writeUInt8(e.width, pos);
    ico.writeUInt8(e.height, pos + 1);
    ico.writeUInt8(0, pos + 2);      // palette
    ico.writeUInt8(0, pos + 3);      // reserved
    ico.writeUInt16LE(1, pos + 4);   // color planes
    ico.writeUInt16LE(32, pos + 6);  // bits per pixel
    ico.writeUInt32LE(e.size, pos + 8);
    ico.writeUInt32LE(e.offset, pos + 12);
  }

  // Image data
  for (let i = 0; i < count; i++) {
    pngBuffers[i].copy(ico, entries[i].offset);
  }

  return ico;
}

const ico = buildIco([canvas16, canvas]);
const icoPath = path.join(__dirname, '..', 'public', 'favicon.ico');
fs.writeFileSync(icoPath, ico);

console.log(`Generated favicon.ico (${ico.length} bytes)`);
console.log(`Generated favicon-16.png and favicon-32.png`);
