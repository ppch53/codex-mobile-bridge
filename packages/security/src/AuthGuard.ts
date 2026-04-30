import crypto from 'crypto';
import type { LocalStore } from '@codex-mobile-bridge/store';
import type { AuthContext } from './types';

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class AuthGuard {
  private store: LocalStore;
  private allowedTelegramUserIds: string[];

  constructor(store: LocalStore, allowedTelegramUserIds: string[]) {
    this.store = store;
    this.allowedTelegramUserIds = allowedTelegramUserIds;
  }

  async authenticateTelegram(telegramUserId: string): Promise<AuthContext | null> {
    if (!this.allowedTelegramUserIds.includes(telegramUserId) && !this.allowedTelegramUserIds.includes('*')) {
      return null;
    }
    return { userId: telegramUserId, role: 'user', telegramUserId };
  }

  async authenticateDevice(deviceId: string): Promise<AuthContext | null> {
    const device = await this.store.getDeviceById(deviceId);
    if (!device || !device.paired) return null;
    await this.store.updateDeviceLastSeen(deviceId);
    return { userId: device.id, role: 'user', deviceId };
  }

  async generatePairingCode(): Promise<{ deviceId: string; code: string }> {
    const deviceId = crypto.randomBytes(16).toString('hex');
    const code = (Math.floor(100000 + Math.random() * 900000)).toString();
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    await this.store.createDevice(deviceId, hash, expiresAt);
    return { deviceId, code };
  }

  async verifyPairingCode(deviceId: string, code: string): Promise<boolean> {
    const device = await this.store.getDeviceById(deviceId);
    if (!device) return false;
    if (device.paired) return true; // already paired
    if (Date.now() > device.expiresAt) return false;

    const hash = crypto.createHash('sha256').update(code).digest('hex');
    if (hash !== device.pairingHash) return false;

    await this.store.pairDevice(deviceId);
    return true;
  }

  async verifyByCode(code: string): Promise<{ verified: boolean; deviceId?: string }> {
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    const device = await this.store.getDeviceByPairingHash(hash);
    if (!device) return { verified: false };
    await this.store.pairDevice(device.id);
    return { verified: true, deviceId: device.id };
  }
}
