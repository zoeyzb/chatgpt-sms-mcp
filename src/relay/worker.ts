import type { SendResult } from '../types.js';

interface WorkerMessageSender {
  send(recipient: string, body: string): Promise<SendResult>;
}

interface RelayWorkerOptions {
  relayUrl: string;
  authToken: string;
  messages: WorkerMessageSender;
}

interface RelayJob {
  id: string;
  recipient: string;
  message: string;
}

interface LeaseResponse {
  job: RelayJob;
}

function headers(authToken: string) {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  };
}

export async function runRelayWorkerOnce(
  options: RelayWorkerOptions
): Promise<boolean> {
  const baseUrl = options.relayUrl.replace(/\/$/, '');

  const leaseResponse = await fetch(`${baseUrl}/jobs/lease-next`, {
    method: 'POST',
    headers: headers(options.authToken)
  });

  if (leaseResponse.status === 204) {
    return false;
  }

  if (!leaseResponse.ok) {
    throw new Error(
      `Could not lease relay job: HTTP ${leaseResponse.status}`
    );
  }

  const lease = (await leaseResponse.json()) as LeaseResponse;
  const job = lease.job;

  const result = await options.messages.send(
    job.recipient,
    job.message
  );

  const resultResponse = await fetch(
    `${baseUrl}/jobs/${encodeURIComponent(job.id)}/result`,
    {
      method: 'POST',
      headers: headers(options.authToken),
      body: JSON.stringify({
        status: result.status,
        providerMessageId: result.providerMessageId,
        detail: result.detail
      })
    }
  );

  if (!resultResponse.ok) {
    throw new Error(
      `Could not report relay result: HTTP ${resultResponse.status}`
    );
  }

  return true;
}
