import { Flashlight, Keyboard, ScanLine } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BarcodeStabilizer, captureFrame, createBarcodeReader } from '../lib/barcode'
import { isValidBarcode, normalizeBarcode } from '../lib/openfoodfacts'
import { Button, FieldError, Modal } from './ui'

type ScannerState = 'starting' | 'scanning' | 'denied' | 'unsupported' | 'failed'

const SCAN_INTERVAL_MS = 120

// The torch capability is widely implemented but not yet in the DOM lib types.
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean }
type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean }

function supportsTorch(track: MediaStreamTrack | undefined) {
  const capabilities = track?.getCapabilities?.() as TorchCapabilities | undefined
  return Boolean(capabilities?.torch)
}

/**
 * Reads a barcode from the rear camera. Frames are decoded on the device and are
 * never uploaded, and the panel always offers manual entry as a fallback.
 */
export function BarcodeScannerModal({
  open,
  onClose,
  onDetected,
}: {
  open: boolean
  onClose: () => void
  onDetected: (barcode: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [state, setState] = useState<ScannerState>('starting')
  const [message, setMessage] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [manualError, setManualError] = useState('')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    if (!open) {
      stop()
      return
    }
    let cancelled = false
    let timer: number | null = null
    const stabilizer = new BarcodeStabilizer()

    async function run() {
      setState('starting')
      setMessage('')
      setTorchOn(false)
      setTorchAvailable(false)
      if (!navigator.mediaDevices?.getUserMedia) {
        setState('unsupported')
        setMessage('This browser cannot open the camera. Enter the barcode instead.')
        setManualOpen(true)
        return
      }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
      } catch (error) {
        if (cancelled) return
        const name = error instanceof DOMException ? error.name : ''
        setState(name === 'NotAllowedError' ? 'denied' : 'failed')
        setMessage(
          name === 'NotAllowedError'
            ? 'Camera access was declined. Allow it in your browser settings, or enter the barcode by hand.'
            : 'The camera could not be started. Enter the barcode by hand instead.',
        )
        setManualOpen(true)
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => undefined)
      }
      setTorchAvailable(supportsTorch(stream.getVideoTracks()[0]))

      let reader
      try {
        reader = await createBarcodeReader()
      } catch (error) {
        if (cancelled) return
        setState('failed')
        setMessage(error instanceof Error ? error.message : 'The barcode decoder is unavailable.')
        setManualOpen(true)
        return
      }
      if (cancelled) return
      setState('scanning')
      canvasRef.current ??= document.createElement('canvas')

      const tick = async () => {
        if (cancelled) return
        const element = videoRef.current
        const canvas = canvasRef.current
        if (element && canvas && element.readyState >= 2) {
          const frame = captureFrame(element, canvas)
          if (frame) {
            try {
              const found = stabilizer.push(await reader.scan(frame))
              if (found && !cancelled) {
                stop()
                onDetected(normalizeBarcode(found))
                return
              }
            } catch {
              // A single unreadable frame is expected; keep scanning.
            }
          }
        }
        if (!cancelled) timer = window.setTimeout(() => void tick(), SCAN_INTERVAL_MS)
      }
      void tick()
    }

    void run()
    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      stop()
    }
  }, [open, onDetected, stop])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraint] })
      setTorchOn(next)
    } catch {
      setTorchAvailable(false)
    }
  }

  function submitManual(event: React.FormEvent) {
    event.preventDefault()
    const value = normalizeBarcode(manualValue)
    if (!/^\d{6,14}$/.test(value)) {
      setManualError('Enter the 8 to 13 digits printed under the barcode.')
      return
    }
    if (!isValidBarcode(value)) {
      setManualError('That barcode’s check digit does not match. Please read it again.')
      return
    }
    setManualError('')
    setManualValue('')
    stop()
    setTorchOn(false)
    onDetected(value)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Scan a barcode"
      description="Hold the barcode inside the frame. Decoding happens on this device."
    >
      <div className="scanner">
        <div className={`scanner-viewport scanner-${state}`}>
          <video ref={videoRef} playsInline muted autoPlay aria-label="Camera preview" />
          <div className="scanner-reticle" aria-hidden="true"><span /><span /><span /><span /></div>
          {state === 'starting' ? <p className="scanner-overlay">Starting the camera…</p> : null}
          {state !== 'scanning' && state !== 'starting' ? (
            <p className="scanner-overlay">{message}</p>
          ) : null}
        </div>
        <div className="scanner-tools">
          {torchAvailable ? (
            <Button type="button" variant="secondary" onClick={() => void toggleTorch()}>
              <Flashlight size={17} /> {torchOn ? 'Light off' : 'Light on'}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => setManualOpen((value) => !value)}>
            <Keyboard size={17} /> Enter digits
          </Button>
        </div>
        {manualOpen ? (
          <form className="scanner-manual" onSubmit={submitManual}>
            <label className="field">
              <span>Barcode number</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 3017624010701"
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
              />
              <FieldError message={manualError} />
            </label>
            <Button type="submit"><ScanLine size={17} /> Look up</Button>
          </form>
        ) : null}
      </div>
    </Modal>
  )
}
