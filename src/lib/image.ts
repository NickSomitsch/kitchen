/** Largest edge, in pixels, sent for recognition. Receipts need the extra detail. */
export const SCAN_MAX_EDGE = { product: 1400, receipt: 2000 } as const

export class ImageTooLargeError extends Error {
  constructor() {
    super('That photo is too large. Take a new one or choose a smaller file.')
    this.name = 'ImageTooLargeError'
  }
}

function loadImage(file: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image.'))
    }
    image.src = url
  })
}

/**
 * Downscales a captured photo and re-encodes it as JPEG. This keeps uploads small
 * and strips the original file's metadata, including any location it carried.
 */
export async function toScanDataUrl(
  file: File,
  maxEdge: number,
  quality = 0.82,
): Promise<string> {
  if (file.size > 25 * 1024 * 1024) throw new ImageTooLargeError()
  const image = await loadImage(file)
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot process the photo.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  for (const attempt of [quality, 0.7, 0.55, 0.4]) {
    const dataUrl = canvas.toDataURL('image/jpeg', attempt)
    // The function accepts roughly 4.5 MB of base64, so stop well inside that.
    if (dataUrl.length <= 3_000_000) return dataUrl
  }
  throw new ImageTooLargeError()
}
