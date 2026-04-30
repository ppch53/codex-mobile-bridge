import { PolicyEngine } from './PolicyEngine';

describe('PolicyEngine security bypass tests', () => {
  const engine = new PolicyEngine(
    ['C:\\Projects', 'C:\\Work\\my-app', '/home/user/code'],
    true
  );

  describe('path traversal attacks', () => {
    it('should reject path traversal escaping workspace', () => {
      expect(engine.isPathAllowed('C:\\Projects\\..\\..\\..\\Windows\\System32')).toBe(false);
    });

    it('should reject nested path traversal', () => {
      expect(engine.isPathAllowed('C:\\Projects\\sub\\..\\..\\..\\Windows')).toBe(false);
    });

    it('should reject Unix-style traversal', () => {
      expect(engine.isPathAllowed('C:/Projects/../../../etc/passwd')).toBe(false);
    });

    it('should reject traversal from nested workspace', () => {
      expect(engine.isPathAllowed('C:\\Work\\my-app\\..\\..\\secrets')).toBe(false);
    });
  });

  describe('prefix collision attacks', () => {
    it('should reject path that shares workspace prefix', () => {
      expect(engine.isPathAllowed('C:\\ProjectsEvil\\payload')).toBe(false);
    });

    it('should reject path with workspace as prefix substring', () => {
      expect(engine.isPathAllowed('C:\\Projects-backdoor')).toBe(false);
    });

    it('should reject path with workspace prefix and no separator', () => {
      expect(engine.isPathAllowed('C:\\ProjectsSecret')).toBe(false);
    });

    it('should allow legitimate subdirectory', () => {
      expect(engine.isPathAllowed('C:\\Projects\\src\\main.ts')).toBe(true);
    });
  });

  describe('UNC path attacks', () => {
    it('should reject UNC path to local machine', () => {
      expect(engine.isPathAllowed('\\\\?\\C:\\Projects\\..\\..\\Windows')).toBe(false);
    });

    it('should reject UNC server share', () => {
      expect(engine.isPathAllowed('\\\\server\\share\\path')).toBe(false);
    });
  });

  describe('null byte injection', () => {
    it('should reject null byte in path', () => {
      // Null byte in path string
      expect(engine.isPathAllowed('C:\\Projects\x00\\..\\..\\Windows')).toBe(false);
    });
  });

  describe('case sensitivity', () => {
    it('should allow path with different case (Windows)', () => {
      expect(engine.isPathAllowed('c:\\projects\\src')).toBe(true);
    });

    it('should allow workspace with different case', () => {
      expect(engine.isPathAllowed('C:\\PROJECTS\\file.txt')).toBe(true);
    });
  });

  describe('boundary conditions', () => {
    it('should allow exact workspace path', () => {
      expect(engine.isPathAllowed('C:\\Projects')).toBe(true);
    });

    it('should allow path with trailing separator', () => {
      expect(engine.isPathAllowed('C:\\Projects\\')).toBe(true);
    });

    it('should reject completely unrelated path', () => {
      expect(engine.isPathAllowed('D:\\OtherProject\\file.txt')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(engine.isPathAllowed('')).toBe(false);
    });
  });

  describe('evaluateFileChange uses path validation', () => {
    it('should block file change outside workspace', () => {
      const result = engine.evaluateFileChange('C:\\ProjectsEvil\\malware.exe');
      expect(result.allowed).toBe(false);
    });

    it('should block file change via traversal', () => {
      const result = engine.evaluateFileChange('C:\\Projects\\..\\..\\Windows\\system.ini');
      expect(result.allowed).toBe(false);
    });

    it('should allow file change inside workspace', () => {
      const result = engine.evaluateFileChange('C:\\Projects\\src\\index.ts');
      expect(result.allowed).toBe(true);
    });
  });
});
