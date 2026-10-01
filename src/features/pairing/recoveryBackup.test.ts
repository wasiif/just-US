import { describe, expect, it } from "vitest"
import { verifyPhraseConfirmation } from "./recoveryBackup"

describe("recovery phrase confirmation", () => {
  it("reports each requested word independently", () => {
    const result = verifyPhraseConfirmation(
      "alpha bravo charlie delta echo foxtrot",
      ["bravo", "wrong", "echo"],
      [1, 3, 4],
    )
    expect(result).toEqual([
      { index: 1, expected: "bravo", entered: "bravo", matched: true },
      { index: 3, expected: "delta", entered: "wrong", matched: false },
      { index: 4, expected: "echo", entered: "echo", matched: true },
    ])
  })
})
