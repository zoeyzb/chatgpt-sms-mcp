import { createMessagingService } from './app.js';

const command = process.argv[2];
const service = createMessagingService();

if (command === 'status') {
  console.log(JSON.stringify(await service.statuses(), null, 2));
} else if (command === 'dry-run') {
  console.log(JSON.stringify(await service.prepareOrSend({ provider: 'messages', recipient: '+13125550100', message: 'dry run only - do not send', idempotencyKey: `dryrun-${Date.now()}` }), null, 2));
} else {
  console.error('Usage: npm run status | npm run dry-run');
  process.exitCode = 1;
}
