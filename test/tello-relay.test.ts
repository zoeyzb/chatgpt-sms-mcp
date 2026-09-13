import { afterEach, describe, expect, it } from 'vitest';
import { createRelayServer } from '../src/relay/server.js';
import { TelloRelayAdapter } from '../src/providers/telloRelay.js';
import { runRelayWorkerOnce } from '../src/relay/worker.js';

const token = 'worker-test-token';

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
    throw new Error('relay server failed to start');
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

describe('TelloRelayAdapter', () => {
  it('enqueues one message and returns unknown with the relay job id', async () => {
    const { relay, url } = await startServer();
    servers.push(relay);

    const adapter = new TelloRelayAdapter({
      relayUrl: url,
      authToken: token
    });

    const result = await adapter.send(
      '+13125551234',
      'hello from relay',
      'confirmed-job-1'
    );

    expect(result.status).toBe('unknown');
    expect(result.providerMessageId).toBeTruthy();
    expect(relay.jobs.size).toBe(1);

    const job = [...relay.jobs.values()][0];

    expect(job.recipient).toBe('+13125551234');
    expect(job.message).toBe('hello from relay');
    expect(job.idempotencyKey).toBe('confirmed-job-1');
  });
});

describe('relay worker', () => {
  it('leases one job, sends exactly once, and reports sent', async () => {
    const { relay, url } = await startServer();
    servers.push(relay);

    const adapter = new TelloRelayAdapter({
      relayUrl: url,
      authToken: token
    });

    await adapter.send(
      '+13125551234',
      'worker test',
      'worker-confirmed-1'
    );

    let sendCalls = 0;

    const fakeMessages = {
      async send(recipient: string, body: string) {
        sendCalls++;

        expect(recipient).toBe('+13125551234');
        expect(body).toBe('worker test');

        return {
          status: 'sent' as const,
          providerMessageId: 'messages-123'
        };
      }
    };

    const worked = await runRelayWorkerOnce({
      relayUrl: url,
      authToken: token,
      messages: fakeMessages
    });

    expect(worked).toBe(true);
    expect(sendCalls).toBe(1);

    const job = [...relay.jobs.values()][0];

    expect(job.state).toBe('sent');
    expect(job.providerMessageId).toBe('messages-123');
  });

  it('does nothing when there is no queued job', async () => {
    const { relay, url } = await startServer();
    servers.push(relay);

    let sendCalls = 0;

    const fakeMessages = {
      async send() {
        sendCalls++;
        return { status: 'sent' as const };
      }
    };

    const worked = await runRelayWorkerOnce({
      relayUrl: url,
      authToken: token,
      messages: fakeMessages
    });

    expect(worked).toBe(false);
    expect(sendCalls).toBe(0);
  });

  it('reports failed without retrying the Messages send', async () => {
    const { relay, url } = await startServer();
    servers.push(relay);

    const adapter = new TelloRelayAdapter({
      relayUrl: url,
      authToken: token
    });

    await adapter.send(
      '+13125551234',
      'failure test',
      'worker-confirmed-2'
    );

    let sendCalls = 0;

    const fakeMessages = {
      async send() {
        sendCalls++;

        return {
          status: 'failed' as const,
          detail: 'Messages finished with error 4'
        };
      }
    };

    await runRelayWorkerOnce({
      relayUrl: url,
      authToken: token,
      messages: fakeMessages
    });

    expect(sendCalls).toBe(1);

    const job = [...relay.jobs.values()][0];

    expect(job.state).toBe('failed');
    expect(job.detail).toContain('error 4');
  });
});
