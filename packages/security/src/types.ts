
export interface AuthContext {
  userId: string;
  role: 'user' | 'admin';
  telegramUserId?: string;
  deviceId?: string;
}

export interface PolicyResult {
  allowed: boolean;
  requiresSecondConfirmation?: boolean;
  reason?: string;
}

export interface RedactionResult {
  text: string;
  redacted: boolean;
  redactedCount: number;
}
