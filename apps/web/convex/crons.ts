import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Convex has no native TTL indexes; retention runs via scheduled batched deletes.
crons.interval("retention-sweep-hourly", { hours: 1 }, internal.ops.retention.runRetentionSweep, {
  reason: "cron.hourly",
});

export default crons;
