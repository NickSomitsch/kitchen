import { isValidBarcode } from './openfoodfacts'

/**
 * Barcode decoding runs entirely on the device. Browsers that ship the native
 * BarcodeDetector use it; everything else lazily loads a self-hosted WebAssembly
 * decoder, so no camera frame ever leaves the phone.
 */
export type BarcodeEngine = 'native' | 'wasm'

export interface BarcodeReader {
  engine: BarcodeEngine
  scan(source: ImageData | Blob): Promise<string[]>
}

const READABLE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'] as const
const WASM_FORMATS = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128', 'ITF'] as const

interface NativeDetection {
  rawValue: string
}

interface NativeDetector {
  detect(source: ImageData | Blob): Promise<NativeDetection[]>
}

interface NativeDetectorConstructor {
  new (options?: { formats?: readonly string[] }): NativeDetector
  getSupportedFormats(): Promise<string[]>
}

function nativeConstructor(): NativeDetectorConstructor | null {
  const candidate = (globalThis as { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector
  return typeof candidate === 'function' ? candidate : null
}

async function createNativeReader(): Promise<BarcodeReader | null> {
  const Detector = nativeConstructor()
  if (!Detector) return null
  try {
    const supported = await Detector.getSupportedFormats()
    const formats = READABLE_FORMATS.filter((format) => supported.includes(format))
    if (!formats.includes('ean_13')) return null
    const detector = new Detector({ formats })
    return {
      engine: 'native',
      async scan(source) {
        const detections = await detector.detect(source)
        return detections.map((detection) => detection.rawValue)
      },
    }
  } catch {
    return null
  }
}

let wasmReader: Promise<BarcodeReader> | null = null

async function createWasmReader(): Promise<BarcodeReader> {
  wasmReader ??= (async () => {
    const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
      import('zxing-wasm/reader'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ])
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? wasmUrl : `${prefix}${path}`,
      },
    })
    return {
      engine: 'wasm' as const,
      async scan(source: ImageData | Blob) {
        const results = await readBarcodes(source, {
          formats: [...WASM_FORMATS],
          tryHarder: true,
          maxNumberOfSymbols: 4,
        })
        return results.filter((result) => result.isValid).map((result) => result.text)
      },
    }
  })().catch((error: unknown) => {
    wasmReader = null
    throw error instanceof Error
      ? new Error(`The barcode decoder could not be loaded. ${error.message}`)
      : new Error('The barcode decoder could not be loaded.')
  })
  return wasmReader
}

export async function createBarcodeReader(): Promise<BarcodeReader> {
  return (await createNativeReader()) ?? createWasmReader()
}

/** Downscales a camera frame so decoding stays fast on a phone held over a shelf. */
export function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxWidth = 960,
): ImageData | null {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return null
  const scale = Math.min(1, maxWidth / width)
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * A single frame is not enough evidence. A code is accepted once it decodes with a
 * valid check digit, or twice in a row when the symbology carries no check digit.
 */
export class BarcodeStabilizer {
  private counts = new Map<string, number>()

  constructor(private readonly required = 2) {}

  push(values: string[]): string | null {
    if (!values.length) return null
    for (const raw of values) {
      const value = raw.trim()
      if (!/^\d{6,14}$/.test(value)) continue
      if (isValidBarcode(value)) return value
      const seen = (this.counts.get(value) ?? 0) + 1
      this.counts.set(value, seen)
      if (seen >= this.required) return value
    }
    return null
  }

  reset() {
    this.counts.clear()
  }
}
