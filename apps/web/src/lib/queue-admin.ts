import { ConnectionOptions, Queue } from 'bullmq';
import { ALL_QUEUE_NAMES } from './queue';
import { createRedisConnection } from './redis';

const adminQueues = new Map<string, Queue>();

export function getAdminQueue(name: string): Queue {
  if (!(ALL_QUEUE_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown queue: ${name}`);
  }
  let queue = adminQueues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: createRedisConnection() as ConnectionOptions });
    adminQueues.set(name, queue);
  }
  return queue;
}
