import { Buffer } from 'node:buffer'
import { imageDimensions } from './session.mjs'

export const MEDIA_LIMITS = Object.freeze({ image: 8 * 1024 * 1024, video: 25 * 1024 * 1024, total: 40 * 1024 * 1024, count: 6 })
const mediaTypes = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', mp4: 'video/mp4' })
const matchesSignature = (bytes, extension) => {
  if (extension === 'png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (extension === 'jpg' || extension === 'jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (extension === 'gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
  return extension === 'mp4' && bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
}
export async function parseMedia(files) {
  if (!Array.isArray(files) || files.length > MEDIA_LIMITS.count) throw new Error('mediaLimit')
  const accepted = []
  let total = 0
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || typeof file.size !== 'number' || typeof file.arrayBuffer !== 'function') throw new Error('invalidMedia')
    const rawName = file.name.normalize('NFC').replace(/[\\/\r\n\u0000-\u001f"<>]/g, '_').trim()
    const name = rawName.slice(0, 120)
    const extension = name.split('.').pop()?.toLowerCase()
    const kind = extension === 'mp4' ? 'video' : 'image'
    if (!Object.hasOwn(mediaTypes, extension) || !name || !file.size || file.size > MEDIA_LIMITS[kind]) throw new Error('invalidMedia')
    total += file.size
    if (total > MEDIA_LIMITS.total) throw new Error('mediaLimit')
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length !== file.size || !matchesSignature(bytes, extension)) throw new Error('invalidMedia')
    if (kind === 'image') {
      const dimensions = imageDimensions(bytes, mediaTypes[extension])
      if (!dimensions || dimensions.some(side => !side || side > 8192) || dimensions[0] * dimensions[1] > 40_000_000) throw new Error('invalidMedia')
    }
    accepted.push({ name, kind, type: mediaTypes[extension], bytes, size: bytes.length })
  }
  return accepted
}
export function imageReference(url, origin) {
  const parsed = new URL(url, origin)
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.hash || parsed.search ||
      !/^\/file-read-[1-9]\d*\.(?:png|jpe?g|gif)$/i.test(parsed.pathname)) throw new Error('invalidMediaResponse')
  return parsed.pathname
}
const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
export function imageMarkup(path, name) {
  if (!/^\/file-read-[1-9]\d*\.(?:png|jpe?g|gif)$/i.test(path)) throw new Error('invalidMediaResponse')
  return `<p><img src="${path}" alt="${escapeHtml(name)}"></p>`
}
export function videosSaved(bug, videos, previousIds = []) {
  const files = bug?.files && typeof bug.files === 'object' ? Object.values(bug.files) : []
  const old = new Set(previousIds.map(String)), used = new Set()
  return videos.every(video => {
    const file = files.find(item => {
      const id = String(item?.id || '')
      const title = String(item?.title || '')
      const extension = String(item?.extension || '').toLowerCase()
      return /^[1-9]\d*$/.test(id) && !old.has(id) && !used.has(id) && extension === 'mp4' &&
        (title === video.name || `${title}.mp4` === video.name) && Number(item?.size) === video.size
    })
    if (!file) return false
    used.add(String(file.id))
    return true
  })
}
