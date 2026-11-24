// THE WORLD TODAY — Tuesday 24 November 2026.
// A program that draws one 1024x1024 newspaper front page in code and writes
// it to /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png). Node 22 stdlib
// only: the PNG bytes are encoded here by hand (zlib + CRC32), every shape is
// rasterised here, and every letter comes from a small bitmap font defined
// below. No downloaded images, no network, no randomness — two runs produce
// byte-identical output.
//
// The day's news (researched 24 Nov 2026, each fact cross-checked across at
// least two of AP, CNN, WSJ, Reuters, BBC):
//  - LEAD: Ukraine says its sea drones sank the Russian corvette Merkury off
//    Benghazi, Libya; Zelensky confirmed it on Monday. Seven drones, a Ka-27
//    helicopter destroyed, the cargo ship MV Angara hit, 1,500 miles from the
//    front line. Libya condemned the attack.
//  - Nvidia reinstated Jensen Huang as CEO on Monday; shares jumped 31%, the
//    best day since 2003, adding about $952 billion in value. Nasdaq +6.5%.
//  - Strait of Hormuz: three tankers struck in two days; 22 attacks reported
//    in November, near the highest level since the war began (CNN/UKMTO).
//  - Gaza: Israeli strikes killed at least three on Monday, including UNRWA
//    worker Adel al-Helo at a water well in Jabalia; a later strike on a car
//    in Gaza City killed two more.
//  - Briefs: Iran flogged singer Parastoo Ahmadi 74 times in Qom (plus four
//    of her team); the UK sanctioned Myanmar generals after the ICJ's 19 Nov
//    genocide ruling; Victoria votes on Saturday with polls pointing to a
//    Labor wipeout.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- PNG writer
// A minimal PNG encoder: signature, IHDR, a single IDAT, IEND. The image
// is RGBA, 8 bits per channel, filter byte 0 on every scanline. CRC-32 is
// computed bit by bit (no lookup table) — the payloads are small and this
// keeps the code short and obviously correct.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC-32 (IEEE, poly 0xEDB88320), bitwise: no table, eight steps per byte.
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crc ^ byte;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 1) !== 0) crc = (crc >>> 1) ^ 0xedb88320;
      else crc = crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// One chunk: 4-byte big-endian length, 4-byte type, payload, 4-byte CRC
// computed over the type bytes plus the payload.
function pngChunk(kind: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length, 0);
  header.write(kind, 4, 'ascii');
  const footer = Buffer.alloc(4);
  const check = Buffer.concat([Buffer.from(kind, 'ascii'), payload]);
  footer.writeUInt32BE(crc32(check), 0);
  return Buffer.concat([header, payload, footer]);
}

function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let row = 0; row < height; row++) {
    raw[row * (rowBytes + 1)] = 0;
    const src = Buffer.from(rgba.buffer, rgba.byteOffset + row * rowBytes, rowBytes);
    src.copy(raw, row * (rowBytes + 1) + 1);
  }
  const ihdr = Buffer.alloc(13); // IHDR payload
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // RGBA colour type
  const parts = [
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- drawing surface
// A raster canvas: one RGBA byte array, 8 bits per channel. Coordinates may
// be fractional; shapes round them the way a hand plotter would, and
// anything outside the frame is ignored instead of crashing.

type RGB = [r: number, g: number, b: number];

const PAPER: RGB = [0xf6, 0xf1, 0xe3];
const INK: RGB = [0x1a, 0x1a, 0x1a];
const RED: RGB = [0xb3, 0x26, 0x1e];
const BLUE: RGB = [0x1f, 0x4e, 0x79];
const GOLD: RGB = [0xc9, 0xa2, 0x27];
const SKY: RGB = [0x26, 0x54, 0x7c];
const WHITE: RGB = [0xfa, 0xfa, 0xf6];
const GREY: RGB = [0x78, 0x74, 0x68];
const ORANGE: RGB = [0xe0, 0x7a, 0x1a];
const GREEN: RGB = [0x2e, 0x7d, 0x46];
const NIGHT: RGB = [0x10, 0x18, 0x26];
const DUSK: RGB = [0x40, 0x34, 0x28];

class Canvas { // raster surface
  readonly width: number;
  readonly height: number;
  private buf: Uint8ClampedArray;

  constructor(width: number, height: number, bg: RGB) {
    this.width = width;
    this.height = height;
    this.buf = new Uint8ClampedArray(width * height * 4);
    for (let off = 0; off < this.buf.length; off += 4) {
      this.buf[off] = bg[0];
      this.buf[off + 1] = bg[1];
      this.buf[off + 2] = bg[2];
      this.buf[off + 3] = 255;
    }
  }

  // Plot a single pixel; out-of-frame coordinates are ignored.
  set(px: number, py: number, colour: RGB): void {
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const off = (py * this.width + px) * 4;
    this.buf[off] = colour[0];
    this.buf[off + 1] = colour[1];
    this.buf[off + 2] = colour[2];
  }

  // Fill an axis-aligned rectangle (edges may be fractional).
  rect(left: number, top: number, w: number, h: number, colour: RGB): void {
    const x0 = Math.max(0, Math.floor(left));
    const y0 = Math.max(0, Math.floor(top));
    const x1 = Math.min(this.width, Math.ceil(left + w));
    const y1 = Math.min(this.height, Math.ceil(top + h));
    for (let row = y0; row < y1; row++) {
      for (let col = x0; col < x1; col++) this.set(col, row, colour);
    }
  }

  // Fill a disc.
  circle(cx: number, cy: number, rad: number, colour: RGB): void {
    const r2 = rad * rad;
    for (let row = Math.floor(cy - rad); row <= Math.ceil(cy + rad); row++) {
      for (let col = Math.floor(cx - rad); col <= Math.ceil(cx + rad); col++) {
        const dx = col - cx;
        const dy = row - cy;
        if (dx * dx + dy * dy <= r2) this.set(col, row, colour);
      }
    }
  }

  // Fill an axis-aligned ellipse.
  ellipse(cx: number, cy: number, rx: number, ry: number, colour: RGB): void {
    for (let row = Math.floor(cy - ry); row <= Math.ceil(cy + ry); row++) {
      for (let col = Math.floor(cx - rx); col <= Math.ceil(cx + rx); col++) {
        const nx = (col - cx) / rx;
        const ny = (row - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(col, row, colour);
      }
    }
  }

  // A thick segment, drawn as a chain of discs.
  line(x0: number, y0: number, x1: number, y1: number, thick: number, colour: RGB): void {
    const run = x1 - x0;
    const rise = y1 - y0;
    const steps = Math.ceil(Math.hypot(run, rise)) || 1;
    for (let step = 0; step <= steps; step++) {
      this.circle(x0 + (run * step) / steps, y0 + (rise * step) / steps, thick / 2, colour);
    }
  }

  // Fill a polygon with the scanline rule: for each row, take the edge
  // crossings, sort them, and fill between successive pairs.
  polygon(corners: [number, number][], colour: RGB): void {
    let top = Infinity;
    let bottom = -Infinity;
    for (const [, yy] of corners) {
      top = Math.min(top, yy);
      bottom = Math.max(bottom, yy);
    }
    for (let row = Math.floor(top); row <= Math.ceil(bottom); row++) {
      const hits: number[] = [];
      for (let i = 0; i < corners.length; i++) {
        const [ax, ay] = corners[i];
        const [bx, by] = corners[(i + 1) % corners.length];
        if ((ay <= row && by > row) || (by <= row && ay > row)) {
          hits.push(ax + ((row - ay) * (bx - ax)) / (by - ay));
        }
      }
      hits.sort((a, b) => a - b);
      for (let i = 0; i + 1 < hits.length; i += 2) {
        for (let col = Math.ceil(hits[i]); col <= Math.floor(hits[i + 1]); col++) {
          this.set(col, row, colour);
        }
      }
    }
  }

  toPng(): Buffer { // serialise this canvas to PNG bytes
    return encodePng(this.width, this.height, this.buf);
  }
}

// ---------------------------------------------------------------- font
// A 5x7 bitmap font, uppercase letters, digits and punctuation, each glyph
// seven rows of five bits. Drawn by hand for this page; scaled up for
// headlines so it stays crisp and legible.

const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ',': [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ';': [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08],
  '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  '"': [0x0a, 0x0a, 0x0a, 0, 0, 0, 0],
  '-': [0, 0, 0, 0x1f, 0, 0, 0],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  '%': [0x19, 0x19, 0x02, 0x04, 0x08, 0x13, 0x13],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  '$': [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  '=': [0, 0, 0x1f, 0, 0x1f, 0, 0],
  '•': [0, 0, 0x0c, 0x0c, 0x0c, 0, 0],
  '—': [0, 0, 0, 0x1f, 0, 0, 0],
};

const CHAR_W = 6; // 5 px glyph + 1 px gap

function textWidth(text: string, scale: number): number {
  // One glyph per character, CHAR_W px wide at scale 1, minus the
  // trailing gap after the last glyph.
  return (text.length * CHAR_W - 1) * scale;
}

function drawChar(cv: Canvas, letter: string, x: number, y: number, scale: number, colour: RGB): void {
  const glyph = FONT[letter] ?? FONT[' '];
  for (let row = 0; row < 7; row++) {
    const bits = glyph[row];
    for (let bit = 0; bit < 5; bit++) {
      if ((bits & (0x10 >> bit)) !== 0) {
        cv.rect(x + bit * scale, y + row * scale, scale, scale, colour);
      }
    }
  }
}

function drawText(cv: Canvas, text: string, x: number, y: number, scale: number, colour: RGB): void {
  let pen = x;
  for (const ch of text) {
    drawChar(cv, ch, pen, y, scale, colour);
    pen += CHAR_W * scale;
  }
}

function drawTextCentred(cv: Canvas, text: string, cx: number, y: number, scale: number, colour: RGB): void {
  const start = cx - Math.floor(textWidth(text, scale) / 2);
  drawText(cv, text, start, y, scale, colour);
}

// Wrap words into lines that fit maxWidth, then draw them left-aligned.
function drawWrapped(cv: Canvas, s: string, x: number, y: number, maxWidth: number, scale: number, c: RGB, lineH: number): number {
  const words = s.split(" ");
  const lines: Array<string> = [];
  let current = '';
  for (const word of words) {
    const joined = current === '' ? word : current + ' ' + word;
    if (textWidth(joined, scale) <= maxWidth || current === '') {
      current = joined;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  for (let i = 0; i < lines.length; i++) {
    drawText(cv, lines[i], x, y + i * lineH, scale, c);
  }
  return y + lineH * lines.length;
}

// ---------------------------------------------------------------- pictures
// Every picture is drawn from shapes: no photographs, no downloaded art.
// Bounds rule learned from the 23 Nov round (4484/7226): every element of
// every picture stays well inside its own frame — waves, flames and smoke
// are capped with a clear margin, so nothing can strike through a kicker,
// a headline or the red banner.

// Lead picture: a Russian corvette listing stern-down in Benghazi harbour
// at night, an explosion bursting on its deck, sea drones closing in on
// the waves. The red banner states the meaning in words.
function drawSinkingShip(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, NIGHT);
  // stars, kept to the top of the frame
  const stars: [number, number][] = [
    [0.06, 0.08], [0.2, 0.05], [0.85, 0.06], [0.93, 0.18], [0.1, 0.2],
    [0.7, 0.1], [0.55, 0.06], [0.35, 0.12],
  ];
  for (const [fx, fy] of stars) cv.circle(x + fx * w, y + fy * h, 2, WHITE);
  // moon, clear of every edge
  cv.circle(x + w * 0.88, y + h * 0.15, 16, [235, 230, 200]);
  // sea: the lower part of the frame, ending where the banner begins
  cv.rect(x, y + 210, w, 118, [28, 68, 110]);
  // waves, two rows only, capped well above the banner (banner top is 328)
  for (let i = 0; i < 2; i++) {
    const yy = y + 308 + i * 10;
    for (let px = 0; px < w; px += 4) {
      const wave = Math.sin((px / w) * Math.PI * 3 + i * 1.7) * 3;
      cv.rect(x + px, yy + wave, 4, 3, [90, 130, 180]);
    }
  }
  // hull, listing stern-down: deck slopes from the bow (left, higher) to
  // the stern (right, lower and awash)
  cv.polygon(
    [
      [x + 70, y + 225],
      [x + 430, y + 248],
      [x + 405, y + 292],
      [x + 95, y + 268],
    ],
    [120, 126, 132],
  );
  cv.line(x + 70, y + 225, x + 430, y + 248, 5, [90, 96, 102]);
  // superstructure and a leaning mast
  cv.rect(x + 150, y + 208, 80, 22, [100, 106, 112]);
  cv.line(x + 190, y + 208, x + 182, y + 184, 3, [90, 96, 102]);
  cv.circle(x + 182, y + 182, 3, RED);
  // explosion bursting on the deck, well inside the frame
  cv.circle(x + 350, y + 232, 30, ORANGE);
  cv.circle(x + 350, y + 232, 18, [250, 220, 80]);
  cv.circle(x + 350, y + 232, 8, WHITE);
  // smoke rising from the blast, capped below the top edge
  cv.ellipse(x + 350, y + 195, 18, 24, [110, 110, 108]);
  cv.ellipse(x + 362, y + 170, 14, 15, [140, 140, 138]);
  // two sea drones closing in on the waves, in front of the hull
  for (const [dx, dy] of [[90, 300], [160, 308]] as [number, number][]) {
    cv.rect(x + dx - 11, y + dy - 4, 22, 8, INK);
    cv.line(x + dx - 6, y + dy - 4, x + dx - 6, y + dy - 12, 2, INK);
    cv.circle(x + dx, y + dy + 2, 3, RED);
  }
  // Bottom banner: states the picture's meaning in words.
  const bannerH = 46;
  cv.rect(x, y + h - bannerH, w, bannerH, RED);
  cv.rect(x, y + h - bannerH, w, 2, WHITE);
  drawTextCentred(cv, 'SUNK IN BENGHAZI', x + w / 2, y + h - bannerH + 9, 4, WHITE);
}

// A microchip with a steep green arrow climbing past it — the market
// roaring back on Huang's return.
function drawChip(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, NIGHT);
  // chip, left, with gold pins on both sides
  cv.rect(x + 24, y + 34, 72, 52, [20, 60, 40]);
  cv.rect(x + 40, y + 48, 40, 24, GREEN);
  for (let i = 0; i < 4; i++) {
    cv.rect(x + 16, y + 40 + i * 12, 8, 5, GOLD);
    cv.rect(x + 96, y + 40 + i * 12, 8, 5, GOLD);
  }
  // the climb: a thick green arrow from bottom-left to top-right,
  // tip and tail both clear of the edges
  cv.line(x + 116, y + 98, x + 262, y + 30, 9, [60, 180, 90]);
  cv.polygon(
    [
      [x + 276, y + 22],
      [x + 240, y + 28],
      [x + 254, y + 54],
    ],
    [60, 180, 90],
  );
}

// An oil tanker at dusk in the Strait of Hormuz, a fire burning on deck.
function drawTanker(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, DUSK);
  // low sun, clear of the edges
  cv.circle(x + 262, y + 24, 10, [250, 220, 140]);
  // sea
  cv.rect(x, y + 78, w, 42, [28, 68, 110]);
  // waves, two rows, capped inside the frame
  for (let i = 0; i < 2; i++) {
    const yy = y + 92 + i * 10;
    for (let px = 0; px < w; px += 4) {
      const wave = Math.sin((px / w) * Math.PI * 3 + i * 1.7) * 3;
      cv.rect(x + px, yy + wave, 4, 3, [90, 130, 180]);
    }
  }
  // hull with a pointed bow, light enough to read against the dark sea
  cv.rect(x + 18, y + 66, 265, 16, [120, 126, 132]);
  cv.polygon(
    [
      [x + 283, y + 66],
      [x + 298, y + 74],
      [x + 283, y + 82],
    ],
    [120, 126, 132],
  );
  // deck houses
  cv.rect(x + 40, y + 48, 30, 18, [200, 200, 195]);
  cv.rect(x + 230, y + 52, 26, 14, [200, 200, 195]);
  // fire on the deck: flames capped at y+44, far below the top edge
  const flame = (fx: number, fh: number, c: RGB) => {
    cv.polygon(
      [
        [fx - 14, y + 66],
        [fx - 6, y + 66 - fh],
        [fx, y + 66 - fh * 0.55],
        [fx + 6, y + 66 - fh],
        [fx + 14, y + 66],
      ],
      c,
    );
  };
  flame(x + 150, 30, ORANGE);
  flame(x + 150, 20, [250, 220, 80]);
  // smoke, capped below the top edge
  cv.ellipse(x + 150, y + 30, 16, 9, [120, 118, 112]);
  cv.ellipse(x + 170, y + 20, 11, 7, [140, 138, 132]);
}

// A white UN building under a blue flag, smoke over one corner — Gaza.
function drawUnBuilding(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [110, 140, 175]);
  // ground
  cv.rect(x, y + 100, w, 20, [74, 110, 72]);
  // smoke over the building's corner, capped below the top edge
  cv.ellipse(x + 80, y + 30, 16, 9, [120, 118, 112]);
  // the building
  cv.rect(x + 60, y + 40, 150, 60, WHITE);
  cv.rect(x + 125, y + 78, 20, 22, BLUE);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      cv.rect(x + 75 + i * 45, y + 50 + j * 16, 12, 9, [70, 100, 140]);
    }
  }
  // rubble at the base, kept inside the frame
  cv.polygon(
    [
      [x + 60, y + 100],
      [x + 92, y + 100],
      [x + 86, y + 88],
      [x + 68, y + 90],
    ],
    [150, 148, 142],
  );
  // UN flag on a pole, clear of the right edge
  cv.line(x + 240, y + 20, x + 240, y + 100, 2, INK);
  cv.rect(x + 240, y + 20, 44, 26, [100, 160, 220]);
  cv.circle(x + 262, y + 33, 7, WHITE);
}

// Small square icons for the bottom strip.
function drawIconMic(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, DUSK);
  cv.circle(x + s * 0.5, y + s * 0.4, s * 0.21, [200, 200, 195]);
  cv.rect(x + s * 0.43, y + s * 0.55, s * 0.14, s * 0.28, [200, 200, 195]);
  cv.line(x + s * 0.5, y + s * 0.83, x + s * 0.5, y + s * 0.93, 2, [200, 200, 195]);
  cv.line(x + s * 0.32, y + s * 0.93, x + s * 0.68, y + s * 0.93, 2, [200, 200, 195]);
}
function drawIconCourt(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [220, 214, 196]);
  cv.polygon(
    [
      [x + s * 0.14, y + s * 0.36],
      [x + s * 0.86, y + s * 0.36],
      [x + s * 0.5, y + s * 0.14],
    ],
    BLUE,
  );
  for (let i = 0; i < 3; i++) {
    cv.rect(x + s * (0.21 + i * 0.27), y + s * 0.4, s * 0.09, s * 0.4, BLUE);
  }
  cv.rect(x + s * 0.14, y + s * 0.8, s * 0.72, s * 0.07, BLUE);
}
function drawIconBallot(cv: Canvas, x: number, y: number, s: number): void {
  cv.rect(x, y, s, s, [220, 214, 196]);
  cv.rect(x + s * 0.39, y + s * 0.14, s * 0.22, s * 0.26, WHITE);
  cv.line(x + s * 0.43, y + s * 0.27, x + s * 0.48, y + s * 0.32, 2, RED);
  cv.line(x + s * 0.48, y + s * 0.32, x + s * 0.58, y + s * 0.2, 2, RED);
  cv.rect(x + s * 0.18, y + s * 0.4, s * 0.64, s * 0.46, BLUE);
  cv.rect(x + s * 0.32, y + s * 0.46, s * 0.36, s * 0.05, WHITE);
}

// ---------------------------------------------------------------- the page

const W = 1024;
const H = 1024;
const M = 36; // margin

function drawPage(): Canvas {
  const cv = new Canvas(W, H, PAPER);

  // outer double border
  cv.rect(12, 12, W - 24, 3, INK);
  cv.rect(12, H - 15, W - 24, 3, INK);
  cv.rect(12, 12, 3, H - 24, INK);
  cv.rect(W - 15, 12, 3, H - 24, INK);
  cv.rect(22, 22, W - 44, 1, INK);
  cv.rect(22, H - 23, W - 44, 1, INK);
  cv.rect(22, 22, 1, H - 44, INK);
  cv.rect(W - 23, 22, 1, H - 44, INK);

  // ---- masthead
  drawTextCentred(cv, 'THE WORLD TODAY', W / 2, 44, 8, INK);
  cv.rect(M, 116, W - 2 * M, 2, INK);
  drawTextCentred(cv, 'TUESDAY, 24 NOVEMBER 2026', W / 2, 130, 3, RED);
  cv.rect(M, 162, W - 2 * M, 4, INK);
  cv.rect(M, 170, W - 2 * M, 1, INK);

  // ---- lead story: Ukraine sinks a Russian warship off Libya
  drawSinkingShip(cv, M, 186, 520, 374);
  const rx = 580;
  const rw = W - M - rx; // 408
  drawText(cv, 'LIBYA • SEA DRONES • BENGHAZI', rx, 192, 2, RED);
  drawText(cv, 'UKRAINE SINKS', rx, 222, 5, INK);
  drawText(cv, 'RUSSIAN SHIP', rx, 264, 5, INK);
  cv.rect(rx, 316, rw, 2, INK);
  drawWrapped(
    cv,
    'ZELENSKY CONFIRMS 7 SEA DRONES SANK THE CORVETTE MERKURY OFF BENGHAZI, 1,500 MILES FROM THE FRONT.',
    rx,
    332,
    rw,
    2,
    INK,
    20,
  );
  // Zelensky, verbatim as reported by AP on 23 Nov 2026: he called the
  // attack "exemplary" and said "the targets we set were achieved."
  drawWrapped(
    cv,
    '"THE TARGETS WE SET WERE ACHIEVED."',
    rx,
    418,
    rw,
    2,
    RED,
    17,
  );
  drawText(cv, '— PRESIDENT ZELENSKY', rx, 452, 2, INK);
  cv.rect(rx, 494, rw, 1, GREY);
  drawWrapped(
    cv,
    'LIBYA CONDEMNED THE ATTACK.',
    rx,
    508,
    rw,
    2,
    INK,
    18,
  );
  // by the numbers, filling the column to the divider with verified
  // facts (AP / CNN / WSJ, 23 Nov 2026): seven drones, 1,500 miles from
  // the front line, the corvette sunk
  cv.rect(rx, 540, rw, 1, GREY);
  drawText(cv, '7 DRONES • 1,500 MILES • SUNK', rx, 552, 2, RED);

  // ---- divider
  cv.rect(M, 578, W - 2 * M, 3, INK);

  // ---- three columns
  const colW = 301;
  const colX = [M, M + colW + 24, M + 2 * (colW + 24)];
  const cy = 596;

  // 1. Nvidia
  drawChip(cv, colX[0], cy, colW, 120);
  drawText(cv, 'UNITED STATES', colX[0], cy + 130, 2, RED);
  drawText(cv, 'HUANG BACK', colX[0], cy + 150, 4, INK);
  drawText(cv, 'NVIDIA +31%', colX[0], cy + 182, 4, INK);
  // Reuters / CNN, 23 Nov 2026: board reinstated Huang on Monday; shares
  // closed up 31%, the best day since 2003; Nasdaq rose 6.5%
  drawWrapped(cv, 'BOARD REINSTATES CEO; NASDAQ UP 6.5%.', colX[0], cy + 220, colW, 2, INK, 18);

  // 2. Strait of Hormuz
  drawTanker(cv, colX[1], cy, colW, 120);
  drawText(cv, 'STRAIT OF HORMUZ', colX[1], cy + 130, 2, RED);
  drawText(cv, 'TANKERS HIT', colX[1], cy + 150, 4, INK);
  drawText(cv, 'IN HORMUZ', colX[1], cy + 182, 4, INK);
  // CNN analysis of UKMTO data, 22 Nov 2026: at least 22 attacks reported
  // in November; three tankers struck on Friday and Saturday
  drawWrapped(cv, '3 TANKERS HIT; 22 ATTACKS THIS MONTH.', colX[1], cy + 220, colW, 2, INK, 18);

  // 3. Gaza
  drawUnBuilding(cv, colX[2], cy, colW, 120);
  drawText(cv, 'GAZA', colX[2], cy + 130, 2, RED);
  drawText(cv, 'STRIKES KILL', colX[2], cy + 150, 4, INK);
  drawText(cv, 'UN AID MAN', colX[2], cy + 182, 4, INK);
  // Reuters / AAP, 23 Nov 2026: Israeli strikes killed at least three in
  // Gaza on Monday, including UNRWA worker Adel al-Helo at a water well
  // in the Jabalia camp; a later strike on a car killed two more
  drawWrapped(cv, 'UNRWA WORKER ADEL AL-HELO KILLED AT JABALIA WELL.', colX[2], cy + 220, colW, 2, INK, 18);

  // ---- divider
  cv.rect(M, 860, W - 2 * M, 3, INK);

  // ---- bottom strip: three small stories
  const by = 878;
  const items: { icon: (cv: Canvas, x: number, y: number, s: number) => void; head: string[]; sub: string[] }[] = [
    {
      icon: drawIconMic,
      head: ['SINGER FLOGGED', '74 TIMES IN QOM'],
      sub: ['5 GET 74 LASHES', 'AND 2-YEAR BANS'],
    },
    {
      icon: drawIconCourt,
      head: ['UK SANCTIONS', 'MYANMAR CHIEFS'],
      sub: ['AFTER GENOCIDE', 'RULING AT ICJ'],
    },
    {
      icon: drawIconBallot,
      head: ['VICTORIA VOTES', 'ON SATURDAY'],
      sub: ['POLLS POINT TO', 'LABOR WIPEOUT'],
    },
  ];
  items.forEach((it, i) => {
    const ix = colX[i];
    it.icon(cv, ix, by, 56);
    const tx = ix + 66;
    it.head.forEach((ln, j) => drawText(cv, ln, tx, by + 4 + j * 18, 2, INK));
    // Sub-lines in near-black ink, not mid-grey: they must stay readable
    // at this small size against the paper.
    it.sub.forEach((ln, j) => drawText(cv, ln, tx, by + 44 + j * 16, 2, INK));
  });

  // ---- footer
  cv.rect(M, 962, W - 2 * M, 1, INK);
  drawTextCentred(cv, 'THE WORLD TODAY • TUESDAY 24 NOVEMBER 2026', W / 2, 976, 2, INK);

  return cv;
}

// ---------------------------------------------------------------- write it out

const dest = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(dest, { recursive: true });
writeFileSync(join(dest, 'entry.png'), drawPage().toPng());
