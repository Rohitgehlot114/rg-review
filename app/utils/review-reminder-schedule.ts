export const REMINDER_DAYS = [3, 7, 14] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function reminderStageDue(input: {
  sentAt: Date;
  reminderCount: number;
  lastReminderAt: Date | null;
  now: Date;
}): boolean {
  const stage = input.reminderCount;
  const dueDay = REMINDER_DAYS[stage];
  if (dueDay === undefined) return false;

  const daysSinceSent = (input.now.getTime() - input.sentAt.getTime()) / DAY_MS;
  if (daysSinceSent < dueDay) return false;

  if (stage === 0 || !input.lastReminderAt) return stage === 0;
  const previousDay = REMINDER_DAYS[stage - 1];
  const minimumGap = dueDay - previousDay;
  const daysSinceLast =
    (input.now.getTime() - input.lastReminderAt.getTime()) / DAY_MS;
  return daysSinceLast >= minimumGap;
}
