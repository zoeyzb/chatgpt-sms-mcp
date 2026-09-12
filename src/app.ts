import path from 'node:path';
import { loadConfig } from './config.js';
import { MessagesAdapter } from './providers/messages.js';
import { GoogleVoiceAdapter } from './providers/googleVoice.js';
import { ConfirmationStore } from './security/confirmation.js';
import { HourlyRateLimiter } from './security/rateLimit.js';
import { IdempotencyLedger } from './security/idempotency.js';
import { MessagingService } from './services/messaging.js';

export function createMessagingService(env = process.env): MessagingService {
  const config = loadConfig(env);
  return new MessagingService(
    [
      new MessagesAdapter(config.messagesDbPath, config.messagesServiceName),
      new GoogleVoiceAdapter(config.googleVoiceEnabled, config.googleVoiceProfileDir, config.googleVoiceHeadless)
    ],
    new ConfirmationStore(config.confirmationTtlMs),
    new HourlyRateLimiter(config.hourlyLimit),
    new IdempotencyLedger(path.join(config.dataDir, 'idempotency.json')),
    config.allowlist
  );
}
