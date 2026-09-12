import os from 'node:os';
import path from 'node:path';

function expandHome(value: string): string {
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

export interface AppConfig {
  messagesServiceName?: string;
  messagesDbPath: string;
  googleVoiceEnabled: boolean;
  googleVoiceProfileDir: string;
  googleVoiceHeadless: boolean;
  confirmationTtlMs: number;
  hourlyLimit: number;
  allowlist: string[];
  dataDir: string;
}

export function loadConfig(env = process.env): AppConfig {
  const allowlist = (env.RECIPIENT_ALLOWLIST ?? '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  return {
    messagesServiceName: env.MESSAGES_SERVICE_NAME?.trim() || undefined,
    messagesDbPath: expandHome(env.MESSAGES_DB_PATH ?? '~/Library/Messages/chat.db'),
    googleVoiceEnabled: env.GOOGLE_VOICE_ENABLED === 'true',
    googleVoiceProfileDir: expandHome(env.GOOGLE_VOICE_PROFILE_DIR ?? '~/.chatgpt-sms-mcp/google-voice-profile'),
    googleVoiceHeadless: env.GOOGLE_VOICE_HEADLESS === 'true',
    confirmationTtlMs: Number(env.CONFIRMATION_TTL_MS ?? 300000),
    hourlyLimit: Number(env.MESSAGE_RATE_LIMIT_PER_HOUR ?? 30),
    allowlist,
    dataDir: path.join(process.cwd(), '.data')
  };
}
