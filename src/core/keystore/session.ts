import { get, set } from "idb-keyval"

const COUPLE_ID_KEY = "just-us:couple-id"

export async function persistCoupleId(coupleId: string): Promise<void> {
  await set(COUPLE_ID_KEY, coupleId)
}

export async function getPersistedCoupleId(): Promise<string | undefined> {
  return get<string | undefined>(COUPLE_ID_KEY)
}
