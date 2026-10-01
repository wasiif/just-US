export interface ProcessedVideo {
  blob: Blob
  width: number
  height: number
  duration: number
}

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024

export async function validateVideo(file: File, maxBytes = MAX_MEDIA_BYTES): Promise<ProcessedVideo> {
  if (file.size > maxBytes) throw new Error(`Media is larger than the ${Math.round(maxBytes / 1024 / 1024)}MB limit`)
  const video = document.createElement("video")
  video.preload = "metadata"
  video.src = URL.createObjectURL(file)
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error("Unable to read video metadata"))
  })
  URL.revokeObjectURL(video.src)
  return { blob: file, width: video.videoWidth, height: video.videoHeight, duration: video.duration }
}

export async function generateVideoThumbnail(file: File, maxDimension = 320): Promise<Blob> {
  if (file.size > MAX_MEDIA_BYTES) throw new Error("Media is larger than the 50MB limit")
  const video = document.createElement("video")
  video.preload = "metadata"
  video.muted = true
  video.src = URL.createObjectURL(file)
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error("Unable to read video metadata"))
  })
  video.currentTime = Math.min(1, Math.max(0, video.duration))
  await new Promise<void>((resolve, reject) => {
    video.onseeked = () => resolve()
    video.onerror = () => reject(new Error("Unable to seek video"))
  })
  const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas 2D context is unavailable")
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(video.src)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Video thumbnail export failed")), "image/webp", 0.9)
  })
}
