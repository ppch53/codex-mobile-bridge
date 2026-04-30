
import { RedactionResult } from './types';

const SECRET_PATTERNS: [RegExp, string][] = [
  [/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, 'Authorization: Bearer [REDACTED]'],
  [/token[=:]\s*[A-Za-z0-9._-]+/gi, 'token=[REDACTED]'],
  [/api_key[=:]\s*[A-Za-z0-9._-]+/gi, 'api_key=[REDACTED]'],
  [/password[=:]\s*[^\s&]+/gi, 'password=[REDACTED]'],
  [/secret[=:]\s*[^\s&]+/gi, 'secret=[REDACTED]'],
  [/refresh_token[=:]\s*[A-Za-z0-9._-]+/gi, 'refresh_token=[REDACTED]'],
  [/cookie[=:]\s*[A-Za-z0-9._-]+/gi, 'cookie=[REDACTED]'],
  [/TELEGRAM_BOT_TOKEN[=:]\s*[A-Za-z0-9:_-]+/gi, 'TELEGRAM_BOT_TOKEN=[REDACTED]'],
];

export class Redactor {
  constructor(private enabled: boolean = true) {}

  redact(text: string): RedactionResult {
    if (!this.enabled) {
      return { text, redacted: false, redactedCount: 0 };
    }

    let redactedText = text;
    let redactedCount = 0;

    for (const [pattern, replacement] of SECRET_PATTERNS) {
      const matches = redactedText.match(pattern);
      if (matches) {
        redactedCount += matches.length;
        redactedText = redactedText.replace(pattern, replacement);
      }
    }

    return {
      text: redactedText,
      redacted: redactedCount > 0,
      redactedCount,
    };
  }

  redactLog(...args: unknown[]): string[] {
    return args.map(arg => {
      if (typeof arg === 'string') {
        return this.redact(arg).text;
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return this.redact(JSON.stringify(arg)).text;
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    });
  }
}
