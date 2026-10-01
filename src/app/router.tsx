import { Navigate, Route, Routes, Link } from "react-router-dom"
import { ChatScreen } from "../features/chat"
import { EnvelopeListScreen } from "../features/envelopes"
import { GalleryScreen, StoriesScreen } from "../features/memories"
import { CouponScreen, DailyQuestionScreen, MilestoneScreen, MoodPicker } from "../features/records"
import { useSession } from "./useSession"
import { AppShell } from "./AppShell"

function RecordsHub() {
  return <main><h1>Records</h1><nav>
    <Link to="/records/mood">Mood</Link>
    <Link to="/records/daily">Daily question</Link>
    <Link to="/records/coupons">Coupons</Link>
    <Link to="/records/milestones">Milestones</Link>
  </nav></main>
}

function Settings() {
  const { coupleId, userId } = useSession()
  return <main><h1>Settings</h1><p>Paired couple: {coupleId ?? "unknown"}</p><p>Device user: {userId ?? "signed out"}</p><label>Auto-lock timeout <select defaultValue="5"><option value="1">1 minute</option><option value="5">5 minutes</option><option value="15">15 minutes</option></select></label><p>Sharing Center and export/unpair are coming later.</p></main>
}

export function AppRouter() {
  const { coupleId, userId, loading } = useSession()
  if (loading) return <p>Loading session…</p>
  if (!coupleId || !userId) return <p>Pairing session is incomplete. Reload after pairing.</p>
  return <Routes>
    <Route element={<AppShell />}>
      <Route path="/chat" element={<ChatScreen coupleId={coupleId} senderId={userId} />} />
      <Route path="/records" element={<RecordsHub />} />
      <Route path="/records/mood" element={<MoodPicker coupleId={coupleId} authorId={userId} />} />
      <Route path="/records/daily" element={<DailyQuestionScreen coupleId={coupleId} authorId={userId} questionId="daily" promptDate={new Date().toISOString().slice(0, 10)} />} />
      <Route path="/records/coupons" element={<CouponScreen coupleId={coupleId} authorId={userId} />} />
      <Route path="/records/milestones" element={<MilestoneScreen coupleId={coupleId} authorId={userId} />} />
      <Route path="/envelopes" element={<EnvelopeListScreen coupleId={coupleId} senderId={userId} />} />
      <Route path="/gallery" element={<GalleryScreen coupleId={coupleId} />} />
      <Route path="/stories" element={<StoriesScreen coupleId={coupleId} />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Route>
  </Routes>
}
