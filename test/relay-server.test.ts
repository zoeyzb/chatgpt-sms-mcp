import { afterEach, describe, expect, it } from 'vitest';
import { createRelayServer } from '../src/relay/server.js';

const token = 'test-relay-token';

async function startServer() {
  const relay = createRelayServer({
    authToken: token,
    leaseMs: 30_000
  });

  await new Promise<void>((resolve) => {
    relay.server.listen(0, '127.0.0.1', resolve);
  });

  const address = relay.server.address();

  if (!address || typeof address === 'string') {
    throw new Error('server did not start');
  }

  return {
    relay,
    url: `http://127.0.0.1:${address.port}`
  };
}

const servers: Array<ReturnType<typeof createRelayServer>> = [];

afterEach(async () => {
  while (servers.length) {
    const relay = servers.pop()!;
    await new Promise<void>((resolve) => relay.server.close(() => resolve()));
  }
});

async function authedFetch(
  url: string,
  path: string,
  init: RequestInit = {}
) {
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });
}

describe('relay server', () => {
  it('rejects requests without the bearer token', async () => {
    const { relay, url } = await startServer();
    servers.push(relay);

    const response = await fetch(`${url}/jobs`);

    expect(response.status).toBe(401);
  });

  it('creates exactly one relay job', async () => {
    const { relay, url } = await startServer();
    servers.push(relay);

    const response = await authedFetch(url, '/jobs', {
      method: 'POST',
      body: JSON.stringify({
        recipient: '+13125551234',
        message: 'hello',
        idempotencyKey: 'job-1'
      })
    });

    expect(response.status).toBe(201);

    const body = await response.json();

    expect(body.job.recipient).toBe('+13125551234');
    expect(body.job.message).toBe('hello');
    expect(body.job.state).toBe('queued');
  });

  it('returns the same job for the same idempotency key', async () => {
    const { relay, url } = await startServer();
    servers.push(relay);

    const payload = {
      recipient: '+13125551234',
      message: 'hello',
      idempotencyKey: 'same-job'
    };

    const first = await authedFetch(url, '/jobs', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const second = await authedFetch(url, '/jobs', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(firstBody.job.id).toBe(secondBody.job.id);
  });

  it('allows only one active lease', async () => {
    const { relay, url } = await startServer();
    servers.push(relay);

    const create = await authedFetch(url, '/jobs', {
      method: 'POST',
      body: JSON.stringify({
        recipient: '+13125551234',
        message: 'hello',
        idempotencyKey: 'lease-test'
      })
    });

    const created = await create.json();
    const id = created.job.id;

    const firstLease = await authedFetch(url, `/jobs/${id}/lease`, {
      method: 'POST'
    });

    const secondLease = await authedFetch(url, `/jobs/${id}/lease`, {
      method: 'POST'
    });

    expect(firstLease.status).toBe(200);
    expect(secondLease.status).toBe(409);
  });

  it('accepts a final result for a leased job', async () => {
    const { relay, url } = await startServer();
    servers.push(relay);

    const create = await authedFetch(url, '/jobs', {
      method: 'POST',
      body: JSON.stringify({
        recipient: '+13125551234',
        message: 'hello',
        idempotencyKey: 'result-test'
      })
    });

    const created = await create.json();
    const id = created.job.id;

    await authedFetch(url, `/jobs/${id}/lease`, {
      method: 'POST'
    });

    const result = await authedFetch(url, `/jobs/${id}/result`, {
      method: 'POST',
      body: JSON.stringify({
        status: 'sent',
        providerMessageId: '123'
      })
    });

    expect(result.status).toBe(200);

    const get = await authedFetch(url, `/jobs/${id}`);
    const body = await get.json();

    expect(body.job.state).toBe('sent');
    expect(body.job.providerMessageId).toBe('123');
  });
});
