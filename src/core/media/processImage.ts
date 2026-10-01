export interface ProcessedImage {
  blob: Blob
  width: number
  height: number
}

function loadImage(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).then((bitmap) => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    }))
  }
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error("Unable to decode image"))
    image.src = URL.createObjectURL(file)
  })
}

export async function stripExifAndCompress(file: File, maxDimension: number): Promise<ProcessedImage> {
  return renderImage(file, maxDimension, "image/webp")
}

export async function generateThumbnail(file: File, maxDimension = 320): Promise<ProcessedImage> {
  return renderImage(file, maxDimension, "image/webp")
}

async function renderImage(file: Blob, maxDimension: number, mimeType: string): Promise<ProcessedImage> {
  if (!Number.isFinite(maxDimension) || maxDimension < 1) throw new RangeError("Image dimension must be positive")
  const image = await loadImage(file)
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas 2D context is unavailable")
  context.drawImage(image.source, 0, 0, width, height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Image export failed")), mimeType, 0.9)
  })
  image.close?.()
  return { blob, width, height }
}
