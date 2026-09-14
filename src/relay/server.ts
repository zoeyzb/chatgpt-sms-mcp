import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

export type RelayJobState =
  | 'queued'
  | 'leased'
  | 'sent'
  | 'failed'
  | 'unknown';

export interface RelayJob {
  id: string;
  recipient: string;
  message: string;
  idempotencyKey: string;
  createdAt: string;
  state: RelayJobState;
  leaseExpiresAt?: number;
  providerMessageId?: string;
  detail?: string;
}

interface RelayServerOptions {
  authToken: string;
  leaseMs: number;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, expected: string) {
  const header = req.headers.authorization ?? '';
  const prefix = 'Bearer ';

  if (!header.startsWith(prefix)) {
    return false;
  }

  const supplied = Buffer.from(header.slice(prefix.length));
  const wanted = Buffer.from(expected);

  if (supplied.length !== wanted.length) {
    return false;
  }

  return timingSafeEqual(supplied, wanted);
}

async function readJson(req: IncomingMessage) {
  let raw = '';

  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) {
      throw new Error('request too large');
    }
  }

  return raw ? JSON.parse(raw) : {};
}

export function createRelayServer(options: RelayServerOptions) {
  const jobs = new Map<string, RelayJob>();
  const byIdempotencyKey = new Map<string, string>();

  const server = createServer(async (req, res) => {
    if (!authorized(req, options.authToken)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);

      if (method === 'POST' && url.pathname === '/jobs') {
        const body = await readJson(req);

        if (
          typeof body.recipient !== 'string' ||
          typeof body.message !== 'string' ||
          typeof body.idempotencyKey !== 'string' ||
          !body.recipient ||
          !body.message ||
          !body.idempotencyKey
        ) {
          sendJson(res, 400, { error: 'invalid job' });
          return;
        }

        const existingId = byIdempotencyKey.get(body.idempotencyKey);

        if (existingId) {
          const existing = jobs.get(existingId)!;

          if (
            existing.recipient !== body.recipient ||
            existing.message !== body.message
          ) {
            sendJson(res, 409, {
              error: 'idempotency key already used for different job'
            });
            return;
          }

          sendJson(res, 200, { job: existing });
          return;
        }

        const job: RelayJob = {
          id: randomUUID(),
          recipient: body.recipient,
          message: body.message,
          idempotencyKey: body.idempotencyKey,
          createdAt: new Date().toISOString(),
          state: 'queued'
        };

        jobs.set(job.id, job);
        byIdempotencyKey.set(job.idempotencyKey, job.id);

        sendJson(res, 201, { job });
        return;
      }

      if (
        method === 'POST' &&
        url.pathname === '/jobs/lease-next'
      ) {
        const now = Date.now();

        const job = [...jobs.values()].find(
          (candidate) => candidate.state === 'queued'
        );

        if (!job) {
          res.statusCode = 204;
          res.end();
          return;
        }

        job.state = 'leased';
        job.leaseExpiresAt = now + options.leaseMs;

        sendJson(res, 200, { job });
        return;
      }

      if (
        method === 'GET' &&
        parts.length === 2 &&
        parts[0] === 'jobs'
      ) {
        const job = jobs.get(parts[1]);

        if (!job) {
          sendJson(res, 404, { error: 'job not found' });
          return;
        }

        sendJson(res, 200, { job });
        return;
      }

      if (
        method === 'POST' &&
        parts.length === 3 &&
        parts[0] === 'jobs' &&
        parts[2] === 'lease'
      ) {
        const job = jobs.get(parts[1]);

        if (!job) {
          sendJson(res, 404, { error: 'job not found' });
          return;
        }

        const now = Date.now();

        if (job.state === 'leased') {
          sendJson(res, 409, { error: 'already leased' });
          return;
        }

        if (['sent', 'failed', 'unknown'].includes(job.state)) {
          sendJson(res, 409, { error: 'job already completed' });
          return;
        }

        job.state = 'leased';
        job.leaseExpiresAt = now + options.leaseMs;

        sendJson(res, 200, { job });
        return;
      }

      if (
        method === 'POST' &&
        parts.length === 3 &&
        parts[0] === 'jobs' &&
        parts[2] === 'result'
      ) {
        const job = jobs.get(parts[1]);

        if (!job) {
          sendJson(res, 404, { error: 'job not found' });
          return;
        }

        if (job.state !== 'leased') {
          sendJson(res, 409, { error: 'job is not leased' });
          return;
        }

        const body = await readJson(req);

        if (!['sent', 'failed', 'unknown'].includes(body.status)) {
          sendJson(res, 400, { error: 'invalid result status' });
          return;
        }

        job.state = body.status;
        job.providerMessageId =
          typeof body.providerMessageId === 'string'
            ? body.providerMessageId
            : undefined;
        job.detail =
          typeof body.detail === 'string'
            ? body.detail
            : undefined;

        delete job.leaseExpiresAt;

        sendJson(res, 200, { job });
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'bad request'
      });
    }
  });

  return {
    server,
    jobs
  };
}
