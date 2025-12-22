import { Queue, Worker } from "bullmq"
import IORedis from "ioredis"
import { v4 as uuid } from "uuid"

const redisOptions = process.env.UPSTASH_REDIS_HOST
  ? {
      password: process.env.UPSTASH_REDIS_PASSWORD,
      tls: {},
    }
  : {}

const connection = new IORedis({
  host: process.env.UPSTASH_REDIS_HOST || "127.0.0.1",
  port: Number(process.env.UPSTASH_REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
  ...redisOptions,
})

const queues = new Map<string, Queue>()

export function getQueue(type: string) {
  if (!queues.has(type)) {
    queues.set(type, new Queue(`tasks-${type}`, { connection }))
  }
  return queues.get(type)!
}

// Add a job
export async function enqueueTask(type: string, data?: Record<string, any>) {
  const queue = getQueue(type)
  const job = await queue.add(type, data, { jobId: uuid() })
  return job.id
}

// Query status
export async function getTaskStatus(type: string, id: string) {
  const queue = getQueue(type)
  const job = await queue.getJob(id)
  if (!job) return null

  const state = await job.getState()
  return {
    id: job.id,
    state,
    progress: job.progress,
    result: job.returnvalue,
    error: job.failedReason,
  }
}

// Worker registration
export function registerWorker<TInput, TOutput>(
  type: string,
  handler: (data: TInput, job: any) => Promise<TOutput>,
  onComplete?: (output: TOutput & { id?: string }) => Promise<void>,
  onError?: (error: unknown, job: any) => Promise<void>
) {
  const worker = new Worker(
    `tasks-${type}`,
    async (job) => {
      try {
        const result = await handler(job.data, job)

        if (onComplete) {
          await onComplete({ ...result, id: job.id })
        }

        return result
      } catch (err) {
        if (onError) {
          await onError(err, job)
        }
        throw err
      }
    },
    { connection }
  )

  return worker
}
