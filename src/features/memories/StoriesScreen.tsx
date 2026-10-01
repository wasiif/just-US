import { useEffect, useState } from "react"
import { getStories } from "./repository"
import type { StoryItem } from "./types"

export function StoriesScreen({ coupleId }: { coupleId: string }) {
  const [stories, setStories] = useState<StoryItem[]>([])
  useEffect(() => { void getStories(coupleId).then(setStories) }, [coupleId])
  return <main><h1>Stories</h1><section aria-label="Stories">
    {stories.map((story) => <article key={story.id}>{story.thumbnailUrl ? <img src={story.thumbnailUrl} alt="" /> : <span>{story.kind}</span>}</article>)}
  </section></main>
}
