/**
 * Client-only: MediaPipe BlazeFace via @mediapipe/tasks-vision.
 * Ensures one reasonably prominent face before profile photo upload.
 */

export type ProfilePhotoFaceCheckResult = { ok: true } | { ok: false; message: string }

const MP_VERSION = '0.10.17'
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.task'

const MIN_CATEGORY_SCORE = 0.5
/** Min share of image area covered by face bbox (rejects tiny background faces). */
const MIN_FACE_AREA_RATIO = 0.02

type FaceDetectorType = import('@mediapipe/tasks-vision').FaceDetector

let detectorPromise: Promise<FaceDetectorType> | null = null

async function getFaceDetector(): Promise<FaceDetectorType> {
  if (typeof window === 'undefined') {
    throw new Error('Face check must run in the browser')
  }
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE)
      return FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: FACE_MODEL,
          delegate: 'CPU',
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: MIN_CATEGORY_SCORE,
        minSuppressionThreshold: 0.3,
      })
    })()
  }
  return detectorPromise
}

export async function checkProfilePhotoSingleFace(file: File): Promise<ProfilePhotoFaceCheckResult> {
  if (typeof window === 'undefined') {
    return { ok: false, message: 'Photo check is only available in the browser.' }
  }

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return {
      ok: false,
      message: "We couldn't read this image. Try JPEG or PNG.",
    }
  }

  const w = bitmap.width
  const h = bitmap.height
  const imageArea = w * h

  try {
    const detector = await getFaceDetector()
    const { detections } = detector.detect(bitmap)

    const valid = detections.filter((d) => {
      const score = d.categories[0]?.score ?? 0
      if (score < MIN_CATEGORY_SCORE) return false
      const box = d.boundingBox
      if (!box || imageArea <= 0) return true
      const faceArea = Math.max(0, box.width) * Math.max(0, box.height)
      return faceArea / imageArea >= MIN_FACE_AREA_RATIO
    })

    if (valid.length === 0) {
      return {
        ok: false,
        message:
          "We couldn't detect a clear face. Use a well-lit photo where your face fills a good part of the frame.",
      }
    }
    if (valid.length > 1) {
      return {
        ok: false,
        message: 'Please use a photo with only one face.',
      }
    }
    return { ok: true }
  } catch (err) {
    console.error('avatar-face-check', err)
    return {
      ok: false,
      message:
        "We couldn't verify this photo. Check your connection and try again, or use another image.",
    }
  } finally {
    bitmap.close()
  }
}
