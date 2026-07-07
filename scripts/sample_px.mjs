import sharp from 'sharp'
const { data, info } = await sharp('public/enemies/republican/cowboy.jpg').raw().toBuffer({ resolveWithObject: true })
const px = (x, y) => { const o = (y * info.width + x) * 3; return [data[o], data[o+1], data[o+2]] }
console.log('size', info.width, info.height)
for (const [x, y] of [[5,5],[30,5],[60,5],[90,5],[5,30],[30,30],[60,30],[120,60],[10,500],[10,530],[900,60],[980,500]]) {
  const [r,g,b] = px(x,y); console.log(`(${x},${y}) rgb(${r},${g},${b}) sat=${Math.max(r,g,b)-Math.min(r,g,b)} min=${Math.min(r,g,b)}`)
}
