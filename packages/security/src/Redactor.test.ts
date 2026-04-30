import { Redactor } from './Redactor';

describe('Redactor', () => {
  let redactor: Redactor;

  beforeEach(() => {
    redactor = new Redactor(true);
  });

  describe('redact', () => {
    it('should redact Bearer token', () => {
      const result = redactor.redact('Authorization: Bearer sk-abc123def456');
      expect(result.redacted).toBe(true);
      expect(result.text).toContain('[REDACTED]');
      expect(result.text).not.toContain('sk-abc123def456');
    });

    it('should redact api_key', () => {
      const result = redactor.redact('api_key=secretkey123');
      expect(result.redacted).toBe(true);
      expect(result.text).toContain('[REDACTED]');
    });

    it('should redact password', () => {
      const result = redactor.redact('password=mysecretpass');
      expect(result.redacted).toBe(true);
      expect(result.text).toContain('[REDACTED]');
    });

    it('should redact token', () => {
      const result = redactor.redact('token=abc123xyz');
      expect(result.redacted).toBe(true);
      expect(result.text).toContain('[REDACTED]');
    });

    it('should redact TELEGRAM_BOT_TOKEN', () => {
      const result = redactor.redact('TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
      expect(result.redacted).toBe(true);
      expect(result.text).toContain('[REDACTED]');
    });

    it('should redact cookie', () => {
      const result = redactor.redact('cookie=session_abc123');
      expect(result.redacted).toBe(true);
      expect(result.text).toContain('[REDACTED]');
    });

    it('should leave clean text unchanged', () => {
      const text = 'This is a normal message with no secrets';
      const result = redactor.redact(text);
      expect(result.redacted).toBe(false);
      expect(result.text).toBe(text);
      expect(result.redactedCount).toBe(0);
    });

    it('should redact multiple secrets in one string', () => {
      const text = 'token=abc and password=xyz';
      const result = redactor.redact(text);
      expect(result.redacted).toBe(true);
      expect(result.redactedCount).toBe(2);
    });

    it('should return original text when disabled', () => {
      const disabledRedactor = new Redactor(false);
      const text = 'Authorization: Bearer sk-secret123';
      const result = disabledRedactor.redact(text);
      expect(result.redacted).toBe(false);
      expect(result.text).toBe(text);
    });
  });

  describe('redactLog', () => {
    it('should redact secrets in string arguments', () => {
      const result = redactor.redactLog('token=abc123');
      expect(result[0]).toContain('[REDACTED]');
    });

    it('should redact secrets in object arguments', () => {
      const result = redactor.redactLog({ key: 'password=secret' });
      expect(result[0]).toContain('[REDACTED]');
    });

    it('should handle non-string non-object arguments', () => {
      const result = redactor.redactLog(42);
      expect(result[0]).toBe('42');
    });

    it('should handle mixed argument types', () => {
      const result = redactor.redactLog('token=abc', { key: 'val' }, 123, null);
      expect(result).toHaveLength(4);
    });
  });
});
