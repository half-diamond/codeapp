import { createHash } from 'node:crypto';

function hash(value) {
  return BigInt(`0x${createHash('sha256').update(String(value)).digest('hex')}`);
}

export class ConsistentHashRing {
  constructor(nodes = [], virtualNodes = 100) {
    if (!Number.isInteger(virtualNodes) || virtualNodes < 1) throw new RangeError('virtualNodes must be a positive integer');
    this.nodes = [...new Set(nodes.map(String))];
    this.ring = [];
    for (const node of this.nodes) {
      for (let i = 0; i < virtualNodes; i += 1) this.ring.push({ point: hash(`${node}:${i}`), node });
    }
    this.ring.sort((a, b) => (a.point < b.point ? -1 : a.point > b.point ? 1 : a.node.localeCompare(b.node)));
  }

  getNode(key) {
    if (this.ring.length === 0) throw new Error('Cannot look up a key on an empty ring');
    const point = hash(key);
    let low = 0;
    let high = this.ring.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.ring[mid].point < point) low = mid + 1;
      else high = mid;
    }
    return this.ring[low === this.ring.length ? 0 : low].node;
  }
}
