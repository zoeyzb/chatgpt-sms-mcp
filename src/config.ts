import os from 'node:os';
import path from 'node:path';

function expandHome(value: string): string {
  return value.startsWith('~/')
    ? path.join(os.homedir(), value.slice(2))
    : value;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export interface AppConfig {
  messagesServiceName?: string;
  messagesDbPath: string;
  googleVoiceEnabled: boolean;
  googleVoiceProfileDir: string;
  googleVoiceHeadless: boolean;

  telloRelayEnabled: boolean;
  telloRelayUrl: string;
  relayAuthToken?: string;
  telloRelayPollMs: number;
  telloRelayLeaseMs: number;

  confirmationTtlMs: number;
  hourlyLimit: number;
  allowlist: string[];
  dataDir: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env
): AppConfig {
  const allowlist = (env.RECIPIENT_ALLOWLIST ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    messagesServiceName:
      env.MESSAGES_SERVICE_NAME?.trim() || undefined,

    messagesDbPath: expandHome(
      env.MESSAGES_DB_PATH ?? '~/Library/Messages/chat.db'
    ),

    googleVoiceEnabled:
      env.GOOGLE_VOICE_ENABLED === 'true',

    googleVoiceProfileDir: expandHome(
      env.GOOGLE_VOICE_PROFILE_DIR ??
        '~/.chatgpt-sms-mcp/google-voice-profile'
    ),

    googleVoiceHeadless:
      env.GOOGLE_VOICE_HEADLESS === 'true',

    telloRelayEnabled:
      env.TELLO_RELAY_ENABLED === 'true',

    telloRelayUrl: stripTrailingSlash(
      env.TELLO_RELAY_URL ?? 'http://127.0.0.1:8787'
    ),

    relayAuthToken:
      env.RELAY_AUTH_TOKEN?.trim() || undefined,

    telloRelayPollMs:
      Number(env.TELLO_RELAY_POLL_MS ?? 5000),

    telloRelayLeaseMs:
      Number(env.TELLO_RELAY_LEASE_MS ?? 30000),

    confirmationTtlMs:
      Number(env.CONFIRMATION_TTL_MS ?? 300000),

    hourlyLimit:
      Number(env.MESSAGE_RATE_LIMIT_PER_HOUR ?? 30),

    allowlist,

    dataDir: path.join(process.cwd(), '.data')
  };
}
