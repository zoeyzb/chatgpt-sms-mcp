export type ProviderName = 'messages' | 'google_voice';

export interface Message {
  id: string;
  provider: ProviderName;
  threadId: string;
  sender: string;
  recipient: string;
  body: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  status: 'sent' | 'received' | 'unknown';
}

export interface Conversation {
  id: string;
  provider: ProviderName;
  participants: string[];
  lastMessageAt?: string;
}

export interface ProviderStatus {
  provider: ProviderName;
  available: boolean;
  readAvailable: boolean;
  sendAvailable: boolean;
  details: string[];
}

export interface SendResult {
  status: 'sent' | 'unknown';
  providerMessageId?: string;
  detail?: string;
}

export interface MessagingProvider {
  readonly name: ProviderName;
  status(): Promise<ProviderStatus>;
  send(recipient: string, body: string): Promise<SendResult>;
  readMessages(options: { contact?: string; limit: number; unreadOnly?: boolean }): Promise<Message[]>;
  listConversations(limit: number): Promise<Conversation[]>;
  searchMessages(query: string, limit: number): Promise<Message[]>;
  getMessage(id: string): Promise<Message | null>;
  replyToMessage(messageId: string, body: string): Promise<{ recipient: string; result: SendResult }>;
}
