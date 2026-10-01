import type { SupabaseClient } from "@supabase/supabase-js"
import { supabase as defaultSupabase } from "../../core/network/supabaseClient"
import { buildAAD, decryptEnvelope, deriveSubkey, encryptEnvelope, type Envelope } from "../../core/crypto"
import { getCDK } from "../../core/keystore"
import { db, enqueue, type LocalRecordRow } from "../../core/data"
import { parseEnvelope, serializeEnvelope } from "./repository"
import type { DailyAnswer } from "./types"

export { parseEnvelope, serializeEnvelope } from "./repository"

export class DailyAnswerDecryptionError extends Error {
  constructor() {
    super("Unable to decrypt this daily answer")
    this.name = "DailyAnswerDecryptionError"
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function dailyKey(coupleId: string): Promise<CryptoKey> {
  return deriveSubkey(await getCDK(), `just-US:daily_answers:${coupleId}`)
}

export async function encryptDailyAnswer(answer: DailyAnswer): Promise<Envelope> {
  const keyVersion = 1
  return encryptEnvelope(
    encoder.encode(JSON.stringify({
      questionId: answer.questionId,
      answer: answer.answer,
      promptDate: answer.promptDate,
    })),
    await dailyKey(answer.coupleId),
    buildAAD(answer.coupleId, "daily_answers", answer.id, answer.authorId, keyVersion),
    keyVersion,
  )
}

export async function decryptDailyAnswer(
  envelope: Envelope,
  coupleId: string,
  id: string,
  authorId: string,
  createdAt: number,
  questionId: string,
  promptDate: string,
): Promise<DailyAnswer> {
  try {
    const payload = JSON.parse(decoder.decode(await decryptEnvelope(
      envelope,
      await dailyKey(coupleId),
      buildAAD(coupleId, "daily_answers", id, authorId, envelope.keyVersion),
    ))) as { answer: string; questionId: string; promptDate: string }
    if (payload.questionId !== questionId || payload.promptDate !== promptDate) {
      throw new Error("Daily-answer metadata mismatch")
    }
    return { id, coupleId, authorId, createdAt, ...payload }
  } catch {
    throw new DailyAnswerDecryptionError()
  }
}

function localRow(answer: DailyAnswer, status: LocalRecordRow["status"]): LocalRecordRow {
  return {
    id: answer.id,
    coupleId: answer.coupleId,
    authorId: answer.authorId,
    kind: "daily_answer",
    createdAt: answer.createdAt,
    record: answer as unknown as Record<string, unknown>,
    status,
  }
}

export async function submitDailyAnswer(
  answer: DailyAnswer,
  unlockAt?: Date,
): Promise<string> {
  const envelope = await encryptDailyAnswer(answer)
  await db.localRecords.put(localRow(answer, "pending"))
  await enqueue("daily_answers", {
    id: answer.id,
    couple_id: answer.coupleId,
    author_id: answer.authorId,
    question_id: answer.questionId,
    prompt_date: answer.promptDate,
    key_version: envelope.keyVersion,
    ciphertext: serializeEnvelope(envelope),
    ...(unlockAt ? { unlock_at: unlockAt.toISOString() } : {}),
    created_at: new Date(answer.createdAt).toISOString(),
  }, answer.id)
  return answer.id
}

async function mergeDailyAnswer(
  row: Record<string, unknown>,
  onAnswer?: (answer: DailyAnswer) => void,
): Promise<void> {
  const answer = await decryptDailyAnswer(
    parseEnvelope(String(row.ciphertext)),
    String(row.couple_id),
    String(row.id),
    String(row.author_id),
    Date.parse(String(row.created_at)),
    String(row.question_id),
    String(row.prompt_date),
  )
  await db.localRecords.put(localRow(answer, "sent"))
  onAnswer?.(answer)
}

export function subscribeToDailyAnswers(
  coupleId: string,
  onAnswer: (answer: DailyAnswer) => void,
  client: SupabaseClient = defaultSupabase,
  onStatus?: (status: string) => void,
  onError?: (error: unknown) => void,
): () => void {
  const channel = client.channel(`daily-answers-${coupleId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "daily_answers",
      filter: `couple_id=eq.${coupleId}`,
    }, (payload) => {
      const row = payload.new as Record<string, unknown>
      const load = row.ciphertext
        ? Promise.resolve(row)
        : client.from("daily_answers").select("*").eq("id", String(row.id)).single()
          .then(({ data, error }) => {
            if (error || !data) throw error ?? new Error("Daily answer row unavailable")
            return data as Record<string, unknown>
          })
      void Promise.resolve(load).then((fullRow) => mergeDailyAnswer(fullRow, onAnswer))
        .catch((error) => onError?.(error))
    })
    .subscribe((status) => onStatus?.(status))
  return () => { void client.removeChannel(channel) }
}

export async function getLocalDailyAnswers(coupleId: string): Promise<DailyAnswer[]> {
  const rows = await db.localRecords.where("coupleId").equals(coupleId).toArray()
  return rows.filter((row) => row.kind === "daily_answer" && row.record)
    .map((row) => row.record as unknown as DailyAnswer)
}
