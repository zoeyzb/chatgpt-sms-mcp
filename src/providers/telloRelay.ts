import type { SendResult } from '../types.js';

interface TelloRelayOptions {
  relayUrl: string;
  authToken: string;
}

interface RelayJobResponse {
  job: {
    id: string;
  };
}

export class TelloRelayAdapter {
  constructor(private readonly options: TelloRelayOptions) {}

  async send(
    recipient: string,
    body: string,
    idempotencyKey: string
  ): Promise<SendResult> {
    const response = await fetch(
      `${this.options.relayUrl.replace(/\/$/, '')}/jobs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipient,
          message: body,
          idempotencyKey
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Relay rejected message job with HTTP ${response.status}`
      );
    }

    const payload = (await response.json()) as RelayJobResponse;

    return {
      status: 'unknown',
      providerMessageId: payload.job.id,
      detail: 'Message queued for the Mac relay.'
    };
  }
}
