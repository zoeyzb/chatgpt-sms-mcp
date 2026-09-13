import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('relay config', () => {
  it('loads relay settings from environment variables', () => {
    const config = loadConfig({
      TELLO_RELAY_ENABLED: 'true',
      TELLO_RELAY_URL: 'https://relay.example.com/',
      RELAY_AUTH_TOKEN: 'secret-token',
      TELLO_RELAY_POLL_MS: '2500',
      TELLO_RELAY_LEASE_MS: '45000'
    });

    expect(config.telloRelayEnabled).toBe(true);
    expect(config.telloRelayUrl).toBe('https://relay.example.com');
    expect(config.relayAuthToken).toBe('secret-token');
    expect(config.telloRelayPollMs).toBe(2500);
    expect(config.telloRelayLeaseMs).toBe(45000);
  });

  it('uses safe relay defaults without embedding a token', () => {
    const config = loadConfig({});

    expect(config.telloRelayEnabled).toBe(false);
    expect(config.telloRelayUrl).toBe('http://127.0.0.1:8787');
    expect(config.relayAuthToken).toBeUndefined();
    expect(config.telloRelayPollMs).toBe(5000);
    expect(config.telloRelayLeaseMs).toBe(30000);
  });
});
