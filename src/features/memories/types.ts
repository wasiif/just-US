export type MediaKind = "photo" | "video" | "audio"

export interface GalleryItem {
  id: string
  senderId: string
  kind: MediaKind
  createdAt: number
  thumbnailUrl?: string
  fullUrl?: string
}

export interface StoryItem extends GalleryItem {
  expiresAt: number
}
