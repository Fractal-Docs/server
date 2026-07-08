import cron from "node-cron"
import { storage } from "../storage"
import { getTaskStatus } from "./task-manager"
import type { JobType } from "../shared/schema"

// Maps the DB's enqueued_tasks.type (a coarse category) to the BullMQ
// queue/job type name used by registerWorker/enqueueTask.
const BULLMQ_JOB_TYPE: Record<JobType, string> = {
  analyze: "analyzeRepo",
  generate: "generateDocumentation",
  release: "generateReleaseDocumentation",
  role: "generateRoleDocumentation",
}

// BullMQ execution and the enqueued_tasks table are written independently -
// nothing keeps them in sync, so a worker that dies (or a completion/error
// handler that itself throws) leaves the DB row stuck on "pending" forever.
// This sweep finds pending rows old enough that they can no longer be
// legitimately in flight and reconciles them against BullMQ's own view of
// the job.
const STALE_AFTER_MS = 10 * 60 * 1000

export async function reconcileStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS)
  const staleJobs = await storage.getPendingJobsOlderThan(cutoff)

  for (const job of staleJobs) {
    try {
      const bullmqType = BULLMQ_JOB_TYPE[job.type]
      const status = await getTaskStatus(bullmqType, job.jobId)

      if (!status) {
        await storage.updateJob(job.jobId, {
          status: "error",
          message:
            "Job is no longer tracked in the queue (worker likely died before completion)",
        })
        console.warn(
          `[job-reconciler] Marked missing job ${job.jobId} (${job.type}) as error`
        )
        continue
      }

      if (status.state === "failed") {
        await storage.updateJob(job.jobId, {
          status: "error",
          message: status.error || "Job failed",
        })
        console.warn(
          `[job-reconciler] Marked failed job ${job.jobId} (${job.type}) as error`
        )
      } else if (status.state === "completed") {
        // BullMQ finished the job but our completion handler never updated
        // this row (e.g. it threw partway through) - surface as an error
        // rather than leaving it pending forever, since we can't safely
        // assume the handler's side effects (saving docs/releases) ran.
        await storage.updateJob(job.jobId, {
          status: "error",
          message:
            "Job completed in the queue but its completion handler did not finish - result may be incomplete",
        })
        console.warn(
          `[job-reconciler] Marked orphaned-completed job ${job.jobId} (${job.type}) as error`
        )
      }
      // Any other state (active/waiting/delayed) is still legitimately in
      // flight - leave it alone.
    } catch (error) {
      console.error(
        `[job-reconciler] Failed to reconcile job ${job.jobId}:`,
        error
      )
    }
  }
}

export function startJobReconciler() {
  cron.schedule("*/5 * * * *", () => {
    reconcileStaleJobs().catch((error) =>
      console.error("[job-reconciler] Sweep failed:", error)
    )
  })
}
