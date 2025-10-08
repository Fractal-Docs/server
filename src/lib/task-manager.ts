import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { v4 as uuid } from "uuid";

const connection = new IORedis({
  host: process.env.UPSTASH_REDIS_HOST,
  port: Number(process.env.UPSTASH_REDIS_PORT),
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls: {},
  maxRetriesPerRequest: null,
});
const queue = new Queue("tasks", { connection });
const events = new QueueEvents("tasks", { connection });

// Add a job
export async function enqueueTask(type, data) {
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
export function registerWorker(type, handler) {
  return new Worker(
    "tasks",
    async (job) => {
      if (job.name === type) {
        return handler(job.data, job);
      }
    },
    { connection }
  );
}

export { events };
