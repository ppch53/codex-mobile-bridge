import { AuthGuard } from './AuthGuard';
import { LocalStore } from '@codex-mobile-bridge/store';
import fs from 'fs';
import path from 'path';

describe('AuthGuard', () => {
  const testDbPath = path.join(__dirname, 'test-auth.json');
  let store: LocalStore;
  let auth: AuthGuard;

  beforeEach(async () => {
    store = new LocalStore(testDbPath);
    await store.initialize();
    auth = new AuthGuard(store, ['111', '222']);
  });

  afterEach(() => {
    store.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  // --- Telegram auth ---

  describe('authenticateTelegram', () => {
    it('should allow whitelisted user', async () => {
      const result = await auth.authenticateTelegram('111');
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('111');
    });

    it('should reject non-whitelisted user', async () => {
      expect(await auth.authenticateTelegram('999')).toBeNull();
    });

    it('should allow all when wildcard is set', async () => {
      const wildcardAuth = new AuthGuard(store, ['*']);
      const result = await wildcardAuth.authenticateTelegram('anyone');
      expect(result).not.toBeNull();
    });
  });

  // --- Pairing flow ---

  describe('pairing flow', () => {
    it('should generate pairing code and create device in store', async () => {
      const { deviceId, code } = await auth.generatePairingCode();

      expect(deviceId).toMatch(/^[a-f0-9]{32}$/);
      expect(code).toMatch(/^\d{6}$/);

      const device = await store.getDeviceById(deviceId);
      expect(device).not.toBeNull();
      expect(device!.paired).toBe(false);
      expect(device!.pairingHash).not.toBe(code); // hash, not plain code
    });

    it('should verify correct pairing code', async () => {
      const { deviceId, code } = await auth.generatePairingCode();
      const valid = await auth.verifyPairingCode(deviceId, code);
      expect(valid).toBe(true);

      const device = await store.getDeviceById(deviceId);
      expect(device!.paired).toBe(true);
    });

    it('should reject wrong pairing code', async () => {
      const { deviceId } = await auth.generatePairingCode();
      expect(await auth.verifyPairingCode(deviceId, '000000')).toBe(false);
    });

    it('should reject expired pairing code', async () => {
      // Create a device that's already expired
      const deviceId = 'expired-device';
      const code = '123456';
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(code).digest('hex');
      await store.createDevice(deviceId, hash, new Date(Date.now() - 1000)); // expired 1 second ago

      expect(await auth.verifyPairingCode(deviceId, code)).toBe(false);
      const device = await store.getDeviceById(deviceId);
      expect(device!.paired).toBe(false);
    });

    it('should reject pairing for unknown device', async () => {
      expect(await auth.verifyPairingCode('unknown', '123456')).toBe(false);
    });

    it('should return true for already-paired device', async () => {
      const { deviceId, code } = await auth.generatePairingCode();
      await auth.verifyPairingCode(deviceId, code); // pair it

      // Verify again should still return true
      expect(await auth.verifyPairingCode(deviceId, 'anything')).toBe(true);
    });
  });

  // --- verifyByCode (code-only pairing) ---

  describe('verifyByCode (code-only pairing)', () => {
    it('should verify using code only', async () => {
      const { code } = await auth.generatePairingCode();
      const result = await auth.verifyByCode(code);
      expect(result.verified).toBe(true);
      expect(result.deviceId).toBeDefined();
    });

    it('should reject wrong code', async () => {
      await auth.generatePairingCode();
      const result = await auth.verifyByCode('000000');
      expect(result.verified).toBe(false);
    });

    it('should reject expired code', async () => {
      const crypto = await import('crypto');
      const code = '654321';
      const hash = crypto.createHash('sha256').update(code).digest('hex');
      await store.createDevice('exp-dev', hash, new Date(Date.now() - 1000));
      const result = await auth.verifyByCode(code);
      expect(result.verified).toBe(false);
    });

    it('should reject already-used code', async () => {
      const { deviceId, code } = await auth.generatePairingCode();
      await auth.verifyPairingCode(deviceId, code);
      const result = await auth.verifyByCode(code);
      expect(result.verified).toBe(false);
    });
  });

  // --- Device authentication ---

  describe('authenticateDevice', () => {
    it('should authenticate paired device', async () => {
      const { deviceId, code } = await auth.generatePairingCode();
      await auth.verifyPairingCode(deviceId, code);

      const result = await auth.authenticateDevice(deviceId);
      expect(result).not.toBeNull();
      expect(result!.deviceId).toBe(deviceId);
    });

    it('should reject unpaired device', async () => {
      const { deviceId } = await auth.generatePairingCode();
      // Don't pair it

      expect(await auth.authenticateDevice(deviceId)).toBeNull();
    });

    it('should reject unknown device', async () => {
      expect(await auth.authenticateDevice('unknown')).toBeNull();
    });
  });
});
