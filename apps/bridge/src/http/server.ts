import express from 'express';
import cors from 'cors';
import path from 'path';
import { AuthGuard } from '@codex-mobile-bridge/security';
import { LocalStore } from '@codex-mobile-bridge/store';

export function createHttpServer(
  authGuard: AuthGuard,
  _store: LocalStore
) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve Web/PWA static files
  const webDist = path.resolve(__dirname, '../../../web/dist');
  app.use(express.static(webDist));

  // Generate pairing code
  app.post('/api/pairing/generate', async (req, res) => {
    try {
      const { deviceId, code } = await authGuard.generatePairingCode();
      res.json({ deviceId, code, expiresIn: 600 });
    } catch (err) {
      res.status(500).json({ error: 'Failed to generate pairing code' });
    }
  });

  // Verify pairing code and return WebSocket token (deviceId)
  app.post('/api/pairing/verify', async (req, res) => {
    const { deviceId, code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'code required' });
    }
    if (deviceId) {
      const isValid = await authGuard.verifyPairingCode(deviceId, code);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid or expired code' });
      }
      return res.json({ token: deviceId });
    }
    // Code-only path: look up device by code hash
    const result = await authGuard.verifyByCode(code);
    if (!result.verified) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }
    res.json({ token: result.deviceId });
  });

  // Health check
  app.get('/api/status', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}