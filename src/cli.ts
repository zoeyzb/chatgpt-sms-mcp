import { createMessagingService } from './app.js';
import { loadConfig } from './config.js';
import { interactiveGoogleVoiceLogin } from './providers/googleVoice.js';

const command = process.argv[2];
const service = createMessagingService();

function printAndExit(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`, () => process.exit(0));
}

if (command === 'status') {
  printAndExit(await service.statuses());
} else if (command === 'dry-run') {
  printAndExit(await service.prepareOrSend({ provider: 'messages', recipient: '+13125550100', message: 'dry run only - do not send', idempotencyKey: `dryrun-${Date.now()}` }));
} else if (command === 'gv-conversations') {
  printAndExit(await service.listConversations('google_voice', 20));
} else if (command === 'google-voice-login') {
  const config = loadConfig(process.env);
  if (!config.googleVoiceEnabled) {
    console.error('Google Voice is disabled. Set GOOGLE_VOICE_ENABLED=true in .env first.');
    process.exitCode = 1;
  } else {
    await interactiveGoogleVoiceLogin(config.googleVoiceProfileDir);
    console.log('Google Voice login detected and saved in the local browser profile.');
  }
} else {
  console.error('Usage: npm run status | npm run dry-run | npm run gv-conversations | npm run google-voice-login');
  process.exitCode = 1;
}
