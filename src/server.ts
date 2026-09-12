import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { createMessagingService } from './app.js';

const providerSchema = z.enum(['messages', 'google_voice']);

export function buildServer() {
  const service = createMessagingService();
  const server = new McpServer({ name: 'chatgpt-sms-mcp', version: '0.1.0' });
  const asResult = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], structuredContent: value });
  const asError = (error: unknown) => ({ content: [{ type: 'text' as const, text: (error as Error).message }], isError: true });

  server.registerTool('send_message', {
    description: 'Prepare or, after explicit confirmation, send one SMS/message. First call returns a confirmation token; call again with that token to send.',
    inputSchema: z.object({ provider: providerSchema, recipient: z.string(), message: z.string().min(1).max(1600), confirmationToken: z.string().optional(), idempotencyKey: z.string().min(8).max(200).optional() }),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true, readOnlyHint: false }
  }, async input => { try { return asResult(await service.prepareOrSend(input)); } catch (e) { return asError(e); } });

  server.registerTool('read_messages', {
    description: 'Read recent messages from a provider. This is read-only.',
    inputSchema: z.object({ provider: providerSchema, contact: z.string().optional(), limit: z.number().int().min(1).max(100).default(20), unreadOnly: z.boolean().default(false) }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ provider, contact, limit, unreadOnly }) => { try { return asResult(await service.readMessages(provider, contact, limit, unreadOnly)); } catch (e) { return asError(e); } });

  server.registerTool('reply_to_message', {
    description: 'Prepare or, after explicit confirmation, reply to a specific existing message.',
    inputSchema: z.object({ provider: providerSchema, messageId: z.string(), message: z.string().min(1).max(1600), confirmationToken: z.string().optional(), idempotencyKey: z.string().min(8).max(200).optional() })
  }, async input => { try { return asResult(await service.prepareOrReply(input)); } catch (e) { return asError(e); } });

  server.registerTool('list_conversations', {
    description: 'List recent message conversations.',
    inputSchema: z.object({ provider: providerSchema, limit: z.number().int().min(1).max(100).default(20) }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ provider, limit }) => { try { return asResult(await service.listConversations(provider, limit)); } catch (e) { return asError(e); } });

  server.registerTool('search_messages', {
    description: 'Search message text in a provider.',
    inputSchema: z.object({ provider: providerSchema, query: z.string().min(1), limit: z.number().int().min(1).max(100).default(20) }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ provider, query, limit }) => { try { return asResult(await service.searchMessages(provider, query, limit)); } catch (e) { return asError(e); } });

  server.registerTool('get_message', {
    description: 'Get one message by provider-specific message id.',
    inputSchema: z.object({ provider: providerSchema, messageId: z.string() }),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async ({ provider, messageId }) => { try { return asResult(await service.getMessage(provider, messageId)); } catch (e) { return asError(e); } });

  server.registerTool('get_provider_status', {
    description: 'Check whether macOS Messages/Tello bridge and Google Voice adapter can currently read and send.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async () => { try { return asResult(await service.statuses()); } catch (e) { return asError(e); } });

  return server;
}

void serveStdio(buildServer);
console.error('chatgpt-sms-mcp running on stdio');
