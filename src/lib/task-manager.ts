import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { v4 as uuid } from "uuid";

const redisOptions = process.env.UPSTASH_REDIS_HOST
  ? {
      password: process.env.UPSTASH_REDIS_PASSWORD,
      tls: {},
    }
  : {};

const connection = new IORedis({
  host: process.env.UPSTASH_REDIS_HOST || "127.0.0.1",
  port: Number(process.env.UPSTASH_REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
  ...redisOptions,
});

const queue = new Queue("tasks", { connection });
const events = new QueueEvents("tasks", { connection });

// Add a job
export async function enqueueTask(type, data?: Record<string, any>) {
  const job = await queue.add(type, data, { jobId: uuid() });
  return job.id;
}

// Query status
export async function getTaskStatus(id) {
  const job = await queue.getJob(id);
  if (!job) return null;

  const state = await job.getState();
  return {
    id: job.id,
    state,
    progress: job.progress,
    result: job.returnvalue,
    error: job.failedReason,
  };
}

// Worker registration
export function registerWorker(
  type: string,
  handler: (data: any, job: any) => Promise<any>,
  onComplete?: (job: any) => Promise<void>
) {
  const worker = new Worker(
    "tasks",
    async (job) => {
      if (job.name === type) {
        const output = await handler(job.data, job);
        if (onComplete) {
          await onComplete(output);
        }
        return output;
      }
    },
    { connection }
  );

  return worker;
}

export { events };
