export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  from: EmailAddress;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

export class EmailSendError extends Error {
  constructor(
    readonly providerType: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}
