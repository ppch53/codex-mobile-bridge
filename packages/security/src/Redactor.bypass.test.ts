import { Redactor } from './Redactor';

describe('Redactor security gap tests', () => {
  const redactor = new Redactor(true);

  describe('patterns that SHOULD be caught', () => {
    it('should catch Bearer token', () => {
      const result = redactor.redact('Authorization: Bearer sk-abc123def456ghi789jkl012mno345');
      expect(result.redacted).toBe(true);
      expect(result.text).not.toContain('sk-abc123');
    });

    it('should catch api_key assignment', () => {
      const result = redactor.redact('api_key=AKIA1234567890ABCDEF');
      expect(result.redacted).toBe(true);
    });

    it('should catch password in connection string', () => {
      const result = redactor.redact('password=SuperSecret123!');
      expect(result.redacted).toBe(true);
    });

    it('should catch TELEGRAM_BOT_TOKEN', () => {
      const result = redactor.redact('TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ');
      expect(result.redacted).toBe(true);
    });
  });

  describe('known gaps - patterns NOT caught (documented)', () => {
    // These tests document patterns the current Redactor does NOT catch.
    // They serve as a security awareness registry. If any of these become
    // critical, add the pattern to SECRET_PATTERNS in Redactor.ts.

    it('KNOWN GAP: does not catch AWS access keys standalone', () => {
      const result = redactor.redact('AKIAIOSFODNN7EXAMPLE');
      // AWS keys are only caught when prefixed with api_key=
      expect(result.redacted).toBe(false);
    });

    it('KNOWN GAP: does not catch GitHub fine-grained tokens', () => {
      const result = redactor.redact('github_pat_11ABCDEFG0123456789abcdefghijklmnop');
      expect(result.redacted).toBe(false);
    });

    it('KNOWN GAP: does not catch JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const result = redactor.redact(jwt);
      expect(result.redacted).toBe(false);
    });

    it('KNOWN GAP: does not catch PEM private keys', () => {
      const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA0Z3VS5JJcds...\n-----END RSA PRIVATE KEY-----';
      const result = redactor.redact(pem);
      expect(result.redacted).toBe(false);
    });

    it('KNOWN GAP: does not catch database connection strings with embedded password', () => {
      const result = redactor.redact('postgresql://admin:p@ssw0rd@db.example.com:5432/mydb');
      expect(result.redacted).toBe(false);
    });

    it('KNOWN GAP: does not catch generic long hex strings that could be secrets', () => {
      const result = redactor.redact('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
      expect(result.redacted).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = redactor.redact('');
      expect(result.redacted).toBe(false);
      expect(result.text).toBe('');
    });

    it('should not modify clean text', () => {
      const clean = 'This is a normal message with no secrets at all.';
      const result = redactor.redact(clean);
      expect(result.redacted).toBe(false);
      expect(result.text).toBe(clean);
    });

    it('should handle multiple secrets in one string', () => {
      const text = 'token=abc123 and api_key=def456 and password=ghi789';
      const result = redactor.redact(text);
      expect(result.redactedCount).toBe(3);
      expect(result.text).not.toContain('abc123');
      expect(result.text).not.toContain('def456');
      expect(result.text).not.toContain('ghi789');
    });

    it('should handle very large strings efficiently', () => {
      const large = 'x'.repeat(100000) + 'token=secret123' + 'y'.repeat(100000);
      const start = Date.now();
      const result = redactor.redact(large);
      const elapsed = Date.now() - start;
      expect(result.redacted).toBe(true);
      expect(elapsed).toBeLessThan(1000); // should complete in under 1 second
    });

    it('should pass through non-string inputs in redactLog', () => {
      const result = redactor.redactLog(42, null, undefined, { key: 'value' });
      expect(result).toHaveLength(4);
      expect(result[0]).toBe('42');
    });
  });
});
