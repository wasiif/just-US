import { useState } from "react"
import { uploadGalleryItem, uploadStory, type UploadProgress } from "./repository"

export function UploadButton({ coupleId, senderId, story = false }: { coupleId: string; senderId: string; story?: boolean }) {
  const [progress, setProgress] = useState<UploadProgress>()
  const [error, setError] = useState<string>()
  return <label>
    <span>{progress ? `Upload ${progress}...` : story ? "Add story" : "Upload memory"}</span>
    <input type="file" accept="image/*,video/*,audio/*" disabled={Boolean(progress)} onChange={(event) => {
      const file = event.target.files?.[0]
      if (!file) return
      setError(undefined)
      const upload = story ? uploadStory : uploadGalleryItem
      void upload(coupleId, senderId, file, setProgress)
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Upload failed"))
        .finally(() => setProgress(undefined))
    }} />
    {error && <p role="alert">{error}</p>}
  </label>
}
