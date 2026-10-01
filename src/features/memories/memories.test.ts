import { describe, expect, it, vi } from "vitest"
import "fake-indexeddb/auto"

vi.mock("../../core/keystore", () => ({
  getCDK: vi.fn().mockResolvedValue(new Uint8Array(32).fill(4)),
}))

import { decryptMediaFile, encryptMediaFile, MediaDecryptionError } from "./crypto"
import { generateThumbnail, stripExifAndCompress } from "../../core/media"

describe("media processing and encryption", () => {
  it("re-encodes a known EXIF GPS input through the canvas export path", async () => {
    const jpeg = Uint8Array.from(atob(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AYf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AYf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
    ), (character) => character.charCodeAt(0))
    const exifGps = new Uint8Array([
      0xff, 0xe1, 0x00, 0x30, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01,
      0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
      0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01,
      0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x4e, 0x00, 0x00, 0x00,
    ])
    const exifGpsJpeg = new Uint8Array(jpeg.length + exifGps.length)
    exifGpsJpeg.set(jpeg.slice(0, 2))
    exifGpsJpeg.set(exifGps, 2)
    exifGpsJpeg.set(jpeg.slice(2), exifGps.length + 2)
    expect(exifGpsJpeg[2]).toBe(0xff)
    expect(exifGpsJpeg[3]).toBe(0xe1)
    expect(exifGpsJpeg.includes(0x88)).toBe(true)
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({
      width: 4000,
      height: 2000,
      close: vi.fn(),
    }))
    const exported = new TextEncoder().encode("canvas-reencoded-pixels")
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: (blob: Blob) => void) => callback(new Blob([exported], { type: "image/webp" })),
      }),
    })
    const processed = await stripExifAndCompress(new File([exifGpsJpeg], "gps.jpg", { type: "image/jpeg" }), 2048)
    expect(processed.width).toBe(2048)
    expect(processed.height).toBe(1024)
    expect(new TextDecoder().decode(await processed.blob.arrayBuffer())).not.toContain("Exif")
  })

  it("creates correctly bounded thumbnails", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1000, height: 500, close: vi.fn() }))
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["thumb"], { type: "image/webp" })),
      }),
    })
    const thumbnail = await generateThumbnail(new File(["image"], "image.jpg", { type: "image/jpeg" }), 320)
    expect(thumbnail.width).toBe(320)
    expect(thumbnail.height).toBe(160)
  })

  it("round-trips and rejects tampered media", async () => {
    const source = new Blob(["media bytes"], { type: "image/webp" })
    const encrypted = await encryptMediaFile(source, "couple", "asset", "sender")
    await expect(decryptMediaFile(encrypted, "couple", "asset", "sender", source.type))
      .resolves.toEqual(source)
    encrypted[encrypted.length - 1] ^= 1
    await expect(decryptMediaFile(encrypted, "couple", "asset", "sender", source.type))
      .rejects.toBeInstanceOf(MediaDecryptionError)
  })
})
