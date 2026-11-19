import { ConsistentHashRing } from './hashRing.js';

export class IdempotencyCache {
  constructor(ttlMs = 24 * 60 * 60 * 1000, clock = Date.now) {
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.entries = new Map();
  }

  claim(key) {
    this.prune();
    const existing = this.entries.get(key);
    if (existing) return { owner: false, result: existing.promise };
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const entry = { promise, resolve, reject, expiresAt: this.clock() + this.ttlMs };
    this.entries.set(key, entry);
    return { owner: true, result: promise, resolve, reject };
  }

  prune() {
    const now = this.clock();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

export class PartitionedJobQueue {
  constructor(nodes = ['worker-0', 'worker-1', 'worker-2'], virtualNodes = 100) {
    this.ring = new ConsistentHashRing(nodes, virtualNodes);
    this.tails = new Map(nodes.map((node) => [node, Promise.resolve()]));
  }

  workerFor(key) {
    return this.ring.getNode(key);
  }

  enqueue(node, task) {
    if (!this.tails.has(node)) throw new Error(`Unknown worker: ${node}`);
    const next = this.tails.get(node).then(task);
    this.tails.set(node, next.catch((error) => console.error(`Queue ${node}: ${error.message}`)));
    return next;
  }
}

export const jobQueue = new PartitionedJobQueue();
export const idempotencyCache = new IdempotencyCache();
