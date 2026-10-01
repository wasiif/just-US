import { v7 as uuidv7 } from "uuid"
import type { SupabaseClient } from "@supabase/supabase-js"
import { supabase as defaultSupabase } from "../../core/network/supabaseClient"
import { db, type LocalMediaAssetRow } from "../../core/data"
import { generateThumbnail, stripExifAndCompress, validateVideo, generateVideoThumbnail, MAX_MEDIA_BYTES } from "../../core/media"
import { decryptMediaFile, encryptMediaFile } from "./crypto"
import type { GalleryItem, MediaKind, StoryItem } from "./types"

export type UploadProgress = "processing" | "encrypting" | "uploading" | "saving"

function kindFor(file: File): MediaKind {
  if (file.type.startsWith("image/")) return "photo"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  throw new Error("Unsupported media type")
}

function rowToLocal(row: Record<string, unknown>, thumbnailBlob?: Blob): LocalMediaAssetRow {
  return {
    id: String(row.id),
    coupleId: String(row.couple_id),
    senderId: String(row.sender_id),
    kind: String(row.kind),
    createdAt: Date.parse(String(row.created_at)),
    storagePath: String(row.storage_path),
    thumbPath: row.thumb_path ? String(row.thumb_path) : undefined,
    sizeBytes: row.size_bytes ? Number(row.size_bytes) : undefined,
    thumbnailBlob,
    expiresAt: row.expires_at ? Date.parse(String(row.expires_at)) : undefined,
  }
}

function galleryItem(row: LocalMediaAssetRow): GalleryItem {
  return {
    id: row.id,
    senderId: row.senderId,
    kind: row.kind as MediaKind,
    createdAt: row.createdAt,
    thumbnailUrl: row.thumbnailBlob ? URL.createObjectURL(row.thumbnailBlob) : undefined,
  }
}

async function loadThumbnail(row: LocalMediaAssetRow, client: SupabaseClient): Promise<LocalMediaAssetRow> {
  if (!row.thumbPath || row.thumbnailBlob) return row
  const { data, error } = await client.storage.from("media").download(row.thumbPath)
  if (error) throw new Error(`Thumbnail download failed: ${error.message}`)
  const thumbnailBlob = await decryptMediaFile(
    new Uint8Array(await data.arrayBuffer()),
    row.coupleId,
    `${row.id}.thumb`,
    row.senderId,
    "image/webp",
  )
  const hydrated = { ...row, thumbnailBlob }
  await db.localMediaAssets.put(hydrated)
  return hydrated
}

async function processMedia(file: File): Promise<{ original: Blob; thumbnail?: Blob; kind: MediaKind; width?: number; height?: number }> {
  if (file.size > MAX_MEDIA_BYTES) throw new Error("Media is larger than the 50MB limit")
  const kind = kindFor(file)
  if (kind === "photo") {
    const original = await stripExifAndCompress(file, 2048)
    const thumbnail = await generateThumbnail(file)
    return { original: original.blob, thumbnail: thumbnail.blob, kind, width: original.width, height: original.height }
  }
  if (kind === "video") {
    const original = await validateVideo(file)
    const thumbnail = await generateVideoThumbnail(file)
    return { original: original.blob, thumbnail, kind, width: original.width, height: original.height }
  }
  return { original: file, kind }
}

async function uploadEncrypted(
  client: SupabaseClient,
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert: false })
  if (error) throw new Error(`Media upload failed for ${path}: ${error.message}`)
}

export async function uploadGalleryItem(
  coupleId: string,
  senderId: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
  client: SupabaseClient = defaultSupabase,
): Promise<string> {
  onProgress?.("processing")
  const processed = await processMedia(file)
  const assetId = uuidv7()
  onProgress?.("encrypting")
  const fullBytes = await encryptMediaFile(processed.original, coupleId, assetId, senderId)
  const thumbBytes = processed.thumbnail
    ? await encryptMediaFile(processed.thumbnail, coupleId, `${assetId}.thumb`, senderId)
    : undefined
  const storagePath = `${coupleId}/${assetId}.enc`
  const thumbPath = processed.thumbnail ? `${coupleId}/${assetId}.thumb.enc` : undefined
  onProgress?.("uploading")
  try {
    await uploadEncrypted(client, "media", storagePath, fullBytes, file.type || "application/octet-stream")
    if (thumbBytes && thumbPath) await uploadEncrypted(client, "media", thumbPath, thumbBytes, "image/webp")
    onProgress?.("saving")
    const { error } = await client.from("media_assets").insert({
      id: assetId,
      couple_id: coupleId,
      sender_id: senderId,
      kind: processed.kind,
      storage_path: storagePath,
      thumb_path: thumbPath ?? null,
      size_bytes: processed.original.size,
    })
    if (error) throw new Error(`Media metadata insert failed: ${error.message}`)
  } catch (error) {
    await client.storage.from("media").remove([storagePath, ...(thumbPath ? [thumbPath] : [])])
    throw error
  }
  return assetId
}

export async function uploadStory(
  coupleId: string,
  senderId: string,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
  client: SupabaseClient = defaultSupabase,
): Promise<string> {
  onProgress?.("processing")
  const processed = await processMedia(file)
  const storyId = uuidv7()
  onProgress?.("encrypting")
  const bytes = await encryptMediaFile(processed.original, coupleId, storyId, senderId, "stories")
  const path = `${coupleId}/stories/${storyId}.enc`
  onProgress?.("uploading")
  await uploadEncrypted(client, "media", path, bytes, file.type || "application/octet-stream")
  try {
    const { error } = await client.from("stories").insert({
      id: storyId,
      couple_id: coupleId,
      sender_id: senderId,
      storage_path: path,
    })
    if (error) throw new Error(`Story metadata insert failed: ${error.message}`)
  } catch (error) {
    await client.storage.from("media").remove([path])
    throw error
  }
  return storyId
}

export async function getGalleryItems(coupleId: string, limit: number, beforeId?: string, client: SupabaseClient = defaultSupabase): Promise<GalleryItem[]> {
  const cached = await db.localMediaAssets.where("coupleId").equals(coupleId).reverse().sortBy("createdAt")
  const visible = beforeId ? cached.filter((row) => row.id !== beforeId && row.createdAt < (cached.find((item) => item.id === beforeId)?.createdAt ?? Infinity)) : cached
  if (visible.length >= limit) {
    const rows = await Promise.all(visible.slice(0, limit).map((row) => loadThumbnail(row, client)))
    return rows.map(galleryItem)
  }
  const { data, error } = await client.from("media_assets").select("*").eq("couple_id", coupleId).order("created_at", { ascending: false }).limit(limit)
  if (error) throw new Error(`Gallery fetch failed: ${error.message}`)
  const rows = await Promise.all((data ?? []).map((row) => loadThumbnail(rowToLocal(row as Record<string, unknown>), client)))
  await db.localMediaAssets.bulkPut(rows)
  return rows.map(galleryItem)
}

export async function getStories(coupleId: string, client: SupabaseClient = defaultSupabase): Promise<StoryItem[]> {
  const now = Date.now()
  await db.localMediaAssets.where("coupleId").equals(coupleId).filter((row) => Boolean(row.expiresAt && row.expiresAt <= now)).delete()
  const { data, error } = await client.from("stories").select("*").eq("couple_id", coupleId).gt("expires_at", new Date(now).toISOString()).order("created_at", { ascending: false })
  if (error) throw new Error(`Stories fetch failed: ${error.message}`)
  const rows = (data ?? [])
    .map((row) => rowToLocal(row as Record<string, unknown>))
    .filter((row) => Boolean(row.expiresAt && row.expiresAt > now))
  await db.localMediaAssets.bulkPut(rows)
  return rows.map((row) => ({ ...galleryItem(row), expiresAt: row.expiresAt! }))
}

export async function openFullImage(assetId: string, client: SupabaseClient = defaultSupabase): Promise<string> {
  const row = await db.localMediaAssets.get(assetId)
  if (!row) throw new Error("Media asset is not cached")
  const { data, error } = await client.storage.from("media").download(row.storagePath)
  if (error) throw new Error(`Media download failed: ${error.message}`)
  const blob = await decryptMediaFile(await data.arrayBuffer().then((buffer) => new Uint8Array(buffer)), row.coupleId, row.id, row.senderId)
  return URL.createObjectURL(blob)
}

export function subscribeToGallery(
  coupleId: string,
  onItem: (item: GalleryItem) => void,
  client: SupabaseClient = defaultSupabase,
  onStatus?: (status: string) => void,
): () => void {
  const channel = client.channel(`media-assets-${coupleId}`).on("postgres_changes", {
    event: "INSERT", schema: "public", table: "media_assets", filter: `couple_id=eq.${coupleId}`,
  }, async (payload) => {
    const row = rowToLocal(payload.new as Record<string, unknown>)
    await db.localMediaAssets.put(row)
    onItem(galleryItem(row))
  }).subscribe((status) => onStatus?.(status))
  return () => { void client.removeChannel(channel) }
}

export function subscribeToStories(coupleId: string, onItem: (item: StoryItem) => void, client: SupabaseClient = defaultSupabase): () => void {
  const channel = client.channel(`stories-${coupleId}`).on("postgres_changes", {
    event: "INSERT", schema: "public", table: "stories", filter: `couple_id=eq.${coupleId}`,
  }, async (payload) => {
    const row = rowToLocal(payload.new as Record<string, unknown>)
    await db.localMediaAssets.put(row)
    onItem({ ...galleryItem(row), expiresAt: row.expiresAt! })
  }).subscribe()
  return () => { void client.removeChannel(channel) }
}
