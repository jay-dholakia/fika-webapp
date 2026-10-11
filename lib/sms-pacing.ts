export const SMS_PACING_MS = {
  quickAck: 1500,
  beat: 2200,
  context: 2800,
  reflective: 3200,
  media: 2000,
} as const

export async function sleepForSmsPacing(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

/** How long to hold the typing indicator before sending, scaled to message length. */
export function typingDurationMs(text: string): number {
  return Math.min(Math.max(Math.ceil(text.length * 28), 900), 2000)
}
