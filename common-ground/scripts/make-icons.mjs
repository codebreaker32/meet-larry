// Makes the app icons and Larry's web avatars from the mascot artwork, with Chromium's canvas
// (Playwright is already a dev dependency, so no image library is needed).
//   node scripts/make-icons.mjs [path/to/larry-avatar.png]
// Writes public/icons/*.png, public/larry-96.png, public/larry-192.png, public/larry-512.png (+ .webp),
// public/larry-face-96.png, public/larry-face-192.png (+ .webp) and src/app/favicon.ico.
// The 512 full mascot is for the landing hero (up to 320px on desktop, sharp on 2x screens) and big
// Larry moments; the 192 face is the header logo and chat avatar on 2x and 3x screens.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2] ?? join(root, "..", "brand", "larry-avatar.png");
const TABLE = [0xf4, 0xf1, 0xff]; // --table in globals.css

/**
 * Each output: size in px, how much of the canvas the mascot fills (the rest is table lilac), and
 * an optional square crop of the source (x, y, side) for tiny sizes where only the face reads.
 */
const outputs = [
  { file: "public/icons/icon-192.png", size: 192, scale: 0.9 },
  { file: "public/icons/icon-512.png", size: 512, scale: 0.9 },
  // Maskable: everything that matters stays inside the central 80% circle (the safe zone).
  { file: "public/icons/icon-maskable-512.png", size: 512, scale: 0.68 },
  { file: "public/icons/apple-touch-icon.png", size: 180, scale: 0.9 },
  { file: "public/larry-96.png", size: 96, scale: 1 },
  { file: "public/larry-192.png", size: 192, scale: 1 },
  { file: "public/larry-512.png", size: 512, scale: 1 },
  { file: "public/larry-512.webp", size: 512, scale: 1, type: "image/webp" },
  // Chat avatar (36-40px on screen): head, antenna and a little of the cards.
  { file: "public/larry-face-96.png", size: 96, scale: 1, crop: [190, 20, 880] },
  { file: "public/larry-face-192.png", size: 192, scale: 1, crop: [190, 20, 880] },
  { file: "public/larry-face-192.webp", size: 192, scale: 1, crop: [190, 20, 880], type: "image/webp" },
  // Favicons: the face and antenna only.
  { file: "ico-16", size: 16, scale: 1, crop: [270, 40, 760] },
  { file: "ico-32", size: 32, scale: 1, crop: [270, 40, 760] },
  { file: "ico-48", size: 48, scale: 1, crop: [270, 40, 760] },
];

const src = `data:image/png;base64,${readFileSync(source).toString("base64")}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const pngs = await page.evaluate(
    async ({ src, outputs, table }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      // The artwork sits on a flat lilac close to the table colour: move that lilac (and the
      // anti-aliased edge around it) onto the table colour exactly, so icons have no visible seam.
      const full = document.createElement("canvas");
      full.width = img.width;
      full.height = img.height;
      const fx = full.getContext("2d");
      fx.drawImage(img, 0, 0);
      const data = fx.getImageData(0, 0, full.width, full.height);
      const d = data.data;
      // The lilac is the median of the border pixels; pixels close to it become the table colour,
      // and a soft band around them blends, so the outline of the art stays crisp.
      const border = [];
      const w = full.width;
      for (let i = 0; i < w; i += 7) border.push(i * 4, ((w - 1) * w + i) * 4, (i * w) * 4, (i * w + w - 1) * 4);
      const median = (k) => border.map((o) => d[o + k]).sort((a, b) => a - b)[border.length >> 1];
      const bg = [median(0), median(1), median(2)];
      for (let i = 0; i < d.length; i += 4) {
        const diff = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));
        if (diff >= 20) continue;
        const t = diff <= 8 ? 1 : (20 - diff) / 12;
        for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k] + (table[k] - d[i + k]) * t);
      }
      fx.putImageData(data, 0, 0);

      const out = {};
      for (const o of outputs) {
        const [sx, sy, side] = o.crop ?? [0, 0, img.width];
        // Big steps lose detail in one drawImage, so halve down to near the target first.
        let cur = document.createElement("canvas");
        cur.width = cur.height = side;
        cur.getContext("2d").drawImage(full, sx, sy, side, side, 0, 0, side, side);
        const target = Math.round(o.size * o.scale);
        while (cur.width / 2 >= target) {
          const next = document.createElement("canvas");
          next.width = next.height = Math.round(cur.width / 2);
          const nx = next.getContext("2d");
          nx.imageSmoothingQuality = "high";
          nx.drawImage(cur, 0, 0, next.width, next.height);
          cur = next;
        }
        const c = document.createElement("canvas");
        c.width = c.height = o.size;
        const x = c.getContext("2d");
        x.fillStyle = `rgb(${table.join(",")})`;
        x.fillRect(0, 0, o.size, o.size);
        x.imageSmoothingQuality = "high";
        const off = Math.round((o.size - target) / 2);
        x.drawImage(cur, off, off, target, target);
        out[o.file] = c.toDataURL(o.type ?? "image/png", 0.9).split(",")[1];
      }
      return out;
    },
    { src, outputs, table: TABLE },
  );

  const ico = [];
  for (const [file, b64] of Object.entries(pngs)) {
    const buf = Buffer.from(b64, "base64");
    if (file.startsWith("ico-")) ico.push({ size: Number(file.slice(4)), buf });
    else {
      writeFileSync(join(root, file), buf);
      console.log(`${file} ${buf.length} bytes`);
    }
  }

  // favicon.ico holding PNG images (supported by every current browser).
  const header = Buffer.alloc(6 + 16 * ico.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(ico.length, 4);
  let offset = header.length;
  ico.forEach(({ size, buf }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size, e);
    header.writeUInt8(size, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(buf.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });
  const favicon = Buffer.concat([header, ...ico.map((x) => x.buf)]);
  writeFileSync(join(root, "src/app/favicon.ico"), favicon);
  console.log(`src/app/favicon.ico ${favicon.length} bytes`);
} finally {
  await browser.close();
}
