// EnrollLimiter: a single global Durable Object that rate limits the public
// enrollment endpoint.
//
// Enrollment is authenticated by a shared token that ships inside the signed
// installer. A shared secret is convenient for mass deployment but, if it ever
// leaked, could be used to spam the API with bogus server records. A simple
// fixed-window limiter caps how many enrolments can happen per minute so a
// leaked token cannot flood the database faster than an admin would notice.

export class EnrollLimiter {
  private ctx: DurableObjectState;

  // Fixed window: at most MAX enrol attempts per WINDOW_MS.
  private static readonly MAX = 20;
  private static readonly WINDOW_MS = 60_000;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
  }

  async fetch(): Promise<Response> {
    const now = Date.now();
    const windowStart = (await this.ctx.storage.get<number>('windowStart')) ?? 0;
    let count = (await this.ctx.storage.get<number>('count')) ?? 0;

    if (now - windowStart >= EnrollLimiter.WINDOW_MS) {
      // New window.
      await this.ctx.storage.put('windowStart', now);
      await this.ctx.storage.put('count', 1);
      return json({ allowed: true, remaining: EnrollLimiter.MAX - 1 });
    }

    if (count >= EnrollLimiter.MAX) {
      const retryAfterMs = EnrollLimiter.WINDOW_MS - (now - windowStart);
      return json({ allowed: false, retry_after_seconds: Math.ceil(retryAfterMs / 1000) });
    }

    count += 1;
    await this.ctx.storage.put('count', count);
    return json({ allowed: true, remaining: EnrollLimiter.MAX - count });
  }
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}
