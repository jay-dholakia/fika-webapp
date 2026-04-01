export const SMS_PACING_MS = {
  quickAck: 1200,
  beat: 1800,
  context: 2200,
  reflective: 2600,
  media: 2000,
} as const

export async function sleepForSmsPacing(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}
