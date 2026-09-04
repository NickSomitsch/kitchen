// Regenerates every app icon from public/kitchen-icon.svg, the single source of
// truth for the mark. Rasterising needs sharp, which is not a project dependency
// because icons change rarely:
//
//   npm install --no-save sharp && node scripts/generate-icons.mjs
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'

const svg = readFileSync('public/kitchen-icon.svg', 'utf8')
// Android masks the icon to its own shape, so the plate is square and the
// artwork sits inside the safe zone.
const maskable = svg
  .replace('rx="112"', '')
  .replace(/(<rect[^>]*\/>)/, '$1<g transform="translate(256,256) scale(0.68) translate(-256,-256)">')
  .replace('</svg>', '</g></svg>')

const render = (source, size) =>
  sharp(Buffer.from(source), { density: 1200 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

const targets = [
  ['public/pwa-64x64.png', svg, 64],
  ['public/pwa-192x192.png', svg, 192],
  ['public/pwa-512x512.png', svg, 512],
  ['public/apple-touch-icon-180x180.png', svg, 180],
  ['public/maskable-icon-512x512.png', maskable, 512],
]
for (const [path, source, size] of targets) {
  writeFileSync(path, await render(source, size))
  console.log(`${path.padEnd(38)} ${size}x${size}`)
}

// A .ico holding PNG frames, which every current browser reads.
const sizes = [16, 32, 48]
const frames = await Promise.all(sizes.map((s) => render(svg, s)))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const entries = sizes.map((size, i) => {
  const e = Buffer.alloc(16)
  e.writeUInt8(size === 256 ? 0 : size, 0)
  e.writeUInt8(size === 256 ? 0 : size, 1)
  e.writeUInt8(0, 2); e.writeUInt8(0, 3)
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(frames[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += frames[i].length
  return e
})
writeFileSync('public/favicon.ico', Buffer.concat([header, ...entries, ...frames]))
console.log(`${'public/favicon.ico'.padEnd(38)} ${sizes.join('/')}`)
