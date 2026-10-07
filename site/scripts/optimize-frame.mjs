// Builds public/phone-frame.webp (2x, 900x1840) from the design's 3x iPhone bezel PNG.
// The bezel is drawn with CSS border-image so the phone can be shortened on small
// screens, which next/image cannot do, so this one asset is optimized ahead of time.
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src/assets/source/phone-frame.png', import.meta.url))
const out = fileURLToPath(new URL('../public/phone-frame.webp', import.meta.url))

const meta = await sharp(src).metadata()
const { data } = await sharp(src).extract({ left: Math.floor(meta.width / 2), top: Math.floor(meta.height / 2), width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
console.log('source', meta.width, 'x', meta.height, 'center RGBA', [...data])
const info = await sharp(src).resize(900, 1840).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(out)
console.log('wrote', out, info.size, 'bytes')
