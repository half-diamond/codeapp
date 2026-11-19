import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsistentHashRing } from '../src/hashRing.js';

test('distributes keys across workers', () => {
  const ring = new ConsistentHashRing(['worker-0', 'worker-1', 'worker-2'], 100);
  const counts = new Map(ring.nodes.map((node) => [node, 0]));
  for (let i = 0; i < 3000; i += 1) counts.set(ring.getNode(`key-${i}`), counts.get(ring.getNode(`key-${i}`)) + 1);
  for (const count of counts.values()) assert.ok(count > 700 && count < 1300);
});

test('removing a worker remaps only its keys', () => {
  const before = new ConsistentHashRing(['a', 'b', 'c'], 100);
  const after = new ConsistentHashRing(['a', 'b'], 100);
  let moved = 0;
  for (let i = 0; i < 5000; i += 1) {
    const key = `problem-${i}`;
    const oldNode = before.getNode(key);
    const newNode = after.getNode(key);
    if (oldNode !== newNode) {
      moved += 1;
      assert.equal(oldNode, 'c');
    }
  }
  assert.ok(moved > 1200 && moved < 2100);
});
