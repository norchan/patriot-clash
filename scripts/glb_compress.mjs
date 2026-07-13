// Shrink Meshy GLBs by resizing + re-encoding their textures only (geometry,
// skin, and animation are left untouched, so rigs/clips keep working).
// Usage: node scripts/glb_compress.mjs file1.glb [file2.glb ...]
import { NodeIO } from '@gltf-transform/core'
import { textureCompress } from '@gltf-transform/functions'
import sharp from 'sharp'

const io = new NodeIO()
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f)
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024] }),
  )
  await io.write(f, doc)
  console.log('compressed', f)
}
