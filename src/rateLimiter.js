export class TokenBucketStrategy {
  constructor({ capacity = 60, refillPerSecond = 1, clock = Date.now } = {}) {
    this.capacity = capacity;
    this.refillPerMs = refillPerSecond / 1000;
    this.clock = clock;
    this.buckets = new Map();
    this.calls = 0;
  }

  allow(key) {
    const now = this.clock();
    this.calls += 1;
    if (this.calls % 256 === 0) {
      for (const [savedKey, saved] of this.buckets) {
        if (now - saved.at > this.capacity / this.refillPerMs) this.buckets.delete(savedKey);
      }
    }
    const bucket = this.buckets.get(key) || { tokens: this.capacity, at: now };
    bucket.tokens = Math.min(this.capacity, bucket.tokens + Math.max(0, now - bucket.at) * this.refillPerMs);
    bucket.at = now;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return {
      allowed,
      limit: this.capacity,
      remaining: Math.floor(bucket.tokens),
      retryAfter: allowed ? 0 : Math.max(1, Math.ceil((1 - bucket.tokens) / this.refillPerMs / 1000))
    };
  }
}

export class SlidingWindowLogStrategy {
  constructor({ limit = 8, windowMs = 60000, clock = Date.now } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.clock = clock;
    this.logs = new Map();
    this.calls = 0;
  }

  allow(key) {
    const now = this.clock();
    this.calls += 1;
    if (this.calls % 256 === 0) {
      for (const [savedKey, entries] of this.logs) {
        if (!entries.length || entries.at(-1) <= now - this.windowMs) this.logs.delete(savedKey);
      }
    }
    const entries = (this.logs.get(key) || []).filter((time) => time > now - this.windowMs);
    const allowed = entries.length < this.limit;
    if (allowed) entries.push(now);
    this.logs.set(key, entries);
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - entries.length),
      retryAfter: allowed ? 0 : Math.max(1, Math.ceil((entries[0] + this.windowMs - now) / 1000))
    };
  }
}

export function rateLimit(strategy, keyFor = (req) => req.ip) {
  return (req, res, next) => {
    const result = strategy.allow(keyFor(req));
    res.set('X-RateLimit-Limit', String(result.limit));
    res.set('X-RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.set('Retry-After', String(result.retryAfter));
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}
