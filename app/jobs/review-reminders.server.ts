import prisma from "../db.server";
import { deliverReviewEmail } from "../services/email.server";
import { REMINDER_DAYS, reminderStageDue } from "../utils/review-reminder-schedule";
import { reviewRequestUrl, requestIsPastExpiry } from "../utils/review-requests.server";

const JOB_INTERVAL_MS = 60 * 60 * 1000;

type ReminderGlobal = typeof globalThis & {
  reviewReminderTimer?: ReturnType<typeof setInterval>;
  reviewReminderRunning?: boolean;
};

export async function processDueReviewReminders(now = new Date()) {
  const runtime = globalThis as ReminderGlobal;
  if (runtime.reviewReminderRunning) return;
  runtime.reviewReminderRunning = true;

  try {
    const candidates = await prisma.reviewRequest.findMany({
      where: {
        status: "sent",
        sentAt: { not: null },
        reminderCount: { lt: REMINDER_DAYS.length },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { sentAt: "asc" },
      take: 50,
    });

    for (const reviewRequest of candidates) {
      if (!reviewRequest.sentAt) continue;

      if (requestIsPastExpiry(reviewRequest.expiresAt, now)) {
        await prisma.reviewRequest.updateMany({
          where: {
            id: reviewRequest.id,
            shop: reviewRequest.shop,
            status: "sent",
          },
          data: { status: "expired" },
        });
        continue;
      }

      if (
        !reminderStageDue({
          sentAt: reviewRequest.sentAt,
          reminderCount: reviewRequest.reminderCount,
          lastReminderAt: reviewRequest.lastReminderAt,
          now,
        })
      ) {
        continue;
      }

      const reviewUrl = reviewRequestUrl(reviewRequest.token);
      if (!reviewUrl) {
        console.error(
          `[rg-review] reminder skipped shop=${reviewRequest.shop} request=${reviewRequest.id} reason=missing-app-url`,
        );
        continue;
      }

      const claimed = await prisma.reviewRequest.updateMany({
        where: {
          id: reviewRequest.id,
          shop: reviewRequest.shop,
          status: "sent",
          reminderCount: reviewRequest.reminderCount,
        },
        data: {
          reminderCount: reviewRequest.reminderCount + 1,
          lastReminderAt: now,
        },
      });
      if (claimed.count !== 1) continue;

      const delivered = await deliverReviewEmail({
        kind: "reminder",
        to: reviewRequest.customerEmail,
        customerName: reviewRequest.customerName,
        productTitle: reviewRequest.productTitle,
        reviewUrl,
        shop: reviewRequest.shop,
        requestId: reviewRequest.id,
      });

      if (!delivered.ok) {
        await prisma.reviewRequest.updateMany({
          where: {
            id: reviewRequest.id,
            shop: reviewRequest.shop,
            status: "sent",
            reminderCount: reviewRequest.reminderCount + 1,
            lastReminderAt: now,
          },
          data: {
            reminderCount: reviewRequest.reminderCount,
            lastReminderAt: reviewRequest.lastReminderAt,
          },
        });
      }
    }
  } catch (error) {
    console.error("[rg-review] reminder job failed");
    if (error instanceof Error && !error.message.includes("RESEND")) {
      console.error(error.name);
    }
  } finally {
    runtime.reviewReminderRunning = false;
  }
}

export function ensureReviewReminderScheduler() {
  const runtime = globalThis as ReminderGlobal;
  if (runtime.reviewReminderTimer) return;

  void processDueReviewReminders();
  runtime.reviewReminderTimer = setInterval(() => {
    void processDueReviewReminders();
  }, JOB_INTERVAL_MS);
  runtime.reviewReminderTimer.unref?.();
}
