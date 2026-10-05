import { existsSync } from "node:fs";
import { PrismaClient as PostgresClient } from "@prisma/client";
import { PrismaClient as SqliteClient } from "../generated/sqlite-client/index.js";

const allowExisting = process.argv.includes("--allow-existing");
const sqlitePath = "prisma/dev.sqlite";

if (!existsSync(sqlitePath)) {
  throw new Error(`SQLite source database was not found at ${sqlitePath}.`);
}

if (!process.env.DATABASE_URL?.startsWith("postgresql://")) {
  throw new Error(
    "DATABASE_URL must point to the target PostgreSQL database before importing.",
  );
}

const source = new SqliteClient();
const target = new PostgresClient();

const models = [
  "session",
  "review",
  "reviewVote",
  "reviewRequest",
  "rewardSettings",
  "reviewReward",
];

async function counts(client) {
  return Object.fromEntries(
    await Promise.all(
      models.map(async (model) => [model, await client[model].count()]),
    ),
  );
}

function assertCountsMatch(before, after) {
  for (const model of models) {
    if (before[model] !== after[model]) {
      throw new Error(
        `${model} count mismatch: expected ${before[model]}, got ${after[model]}.`,
      );
    }
  }
}

try {
  const sourceCounts = await counts(source);
  const targetCounts = await counts(target);
  if (!allowExisting && Object.values(targetCounts).some((count) => count > 0)) {
    throw new Error(
      "Target PostgreSQL database is not empty. Use --allow-existing only after taking a backup and reviewing duplicates.",
    );
  }

  const [sessions, reviews, votes, requests, settings, rewards] =
    await Promise.all([
      source.session.findMany(),
      source.review.findMany(),
      source.reviewVote.findMany(),
      source.reviewRequest.findMany(),
      source.rewardSettings.findMany(),
      source.reviewReward.findMany(),
    ]);

  await target.$transaction(async (tx) => {
    await tx.session.createMany({ data: sessions });
    await tx.review.createMany({ data: reviews });
    await tx.reviewVote.createMany({ data: votes });
    await tx.reviewRequest.createMany({ data: requests });
    await tx.rewardSettings.createMany({ data: settings });
    await tx.reviewReward.createMany({ data: rewards });
  });

  const importedCounts = await counts(target);
  assertCountsMatch(sourceCounts, importedCounts);

  const [sourceShops, targetShops] = await Promise.all([
    source.review.findMany({ distinct: ["shop"], select: { shop: true } }),
    target.review.findMany({ distinct: ["shop"], select: { shop: true } }),
  ]);
  const expectedShops = new Set(sourceShops.map(({ shop }) => shop));
  const actualShops = new Set(targetShops.map(({ shop }) => shop));
  if (
    expectedShops.size !== actualShops.size ||
    [...expectedShops].some((shop) => !actualShops.has(shop))
  ) {
    throw new Error("Shop coverage mismatch after import.");
  }

  console.info("SQLite to PostgreSQL import completed.");
  console.info(JSON.stringify({ sourceCounts, importedCounts }, null, 2));
} finally {
  await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
}
