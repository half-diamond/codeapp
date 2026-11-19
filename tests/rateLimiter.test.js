import test from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowLogStrategy, TokenBucketStrategy } from '../src/rateLimiter.js';

test('token bucket allows a burst and refills over time', () => {
  let now = 0;
  const limiter = new TokenBucketStrategy({ capacity: 3, refillPerSecond: 1, clock: () => now });
  assert.equal(limiter.allow('ip').allowed, true);
  assert.equal(limiter.allow('ip').allowed, true);
  assert.equal(limiter.allow('ip').allowed, true);
  assert.equal(limiter.allow('ip').allowed, false);
  now = 1000;
  assert.equal(limiter.allow('ip').allowed, true);
});

test('sliding window rejects excess requests until an entry expires', () => {
  let now = 0;
  const limiter = new SlidingWindowLogStrategy({ limit: 2, windowMs: 1000, clock: () => now });
  assert.equal(limiter.allow('user').allowed, true);
  assert.equal(limiter.allow('user').allowed, true);
  assert.equal(limiter.allow('user').allowed, false);
  now = 1001;
  assert.equal(limiter.allow('user').allowed, true);
});
