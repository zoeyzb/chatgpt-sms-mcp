import { createMessagingService } from './app.js';
import { loadConfig } from './config.js';
import { interactiveGoogleVoiceLogin } from './providers/googleVoice.js';

const command = process.argv[2];
const service = createMessagingService();

if (command === 'status') {
  console.log(JSON.stringify(await service.statuses(), null, 2));
} else if (command === 'dry-run') {
  console.log(JSON.stringify(await service.prepareOrSend({ provider: 'messages', recipient: '+13125550100', message: 'dry run only - do not send', idempotencyKey: `dryrun-${Date.now()}` }), null, 2));
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
  console.error('Usage: npm run status | npm run dry-run | npm run google-voice-login');
  process.exitCode = 1;
}
