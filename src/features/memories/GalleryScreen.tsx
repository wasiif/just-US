import { useEffect, useState } from "react"
import { getGalleryItems, openFullImage } from "./repository"
import type { GalleryItem } from "./types"

export function GalleryScreen({ coupleId }: { coupleId: string }) {
  const [items, setItems] = useState<GalleryItem[]>([])
  const [openUrl, setOpenUrl] = useState<string>()
  useEffect(() => { void getGalleryItems(coupleId, 50).then(setItems) }, [coupleId])
  useEffect(() => () => { if (openUrl) URL.revokeObjectURL(openUrl) }, [openUrl])
  return <main><h1>Gallery</h1><section aria-label="Gallery">
    {items.map((item) => <button type="button" key={item.id} onClick={() => void openFullImage(item.id).then(setOpenUrl)}>
      {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span>{item.kind}</span>}
    </button>)}
    {openUrl && <img src={openUrl} alt="Opened memory" />}
  </section></main>
}
