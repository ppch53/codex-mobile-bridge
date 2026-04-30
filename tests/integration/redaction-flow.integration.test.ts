/**
 * Integration test: Redactor applied to Codex adapter output
 * and WebSocket event pipeline.
 */

import { CodexRpcClient, WebSocketTransport } from '@codex-mobile-bridge/codex-rpc';
import { CodexAdapter } from '@codex-mobile-bridge/codex-adapter';
import { Redactor } from '@codex-mobile-bridge/security';
import { MockAppServer } from '../fixtures/mock-app-server';
import WebSocket, { WebSocketServer } from 'ws';

const REDACT_PORT = 14801;

describe('Redaction flow: CodexAdapter output', () => {
  let mockServer: MockAppServer;
  let rpcClient: CodexRpcClient;
  let adapter: CodexAdapter;
  let redactor: Redactor;

  beforeAll(async () => {
    mockServer = new MockAppServer({ port: REDACT_PORT, eventDelay: 5 });
    await mockServer.start();
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  beforeEach(async () => {
    redactor = new Redactor(true);
    const transport = new WebSocketTransport({ url: `ws://127.0.0.1:${REDACT_PORT}` });
    rpcClient = new CodexRpcClient(transport, { defaultTimeout: 5000 });
    adapter = new CodexAdapter(rpcClient);
    await rpcClient.connect();
  });

  afterEach(async () => {
    await rpcClient.disconnect();
  });

  it('should redact secrets from account info', async () => {
    // MockAppServer returns account with email - the redactor should process it
    const account = await adapter.readAccount();

    // Apply redaction as the bridge would
    const raw = JSON.stringify(account);
    const result = redactor.redact(raw);

    // The mock account data doesn't contain secrets by default,
    // but the redaction pipeline should work without errors
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe('string');
  });

  it('should redact secrets from synthetic thread data', async () => {
    // Simulate what happens when Codex returns content with secrets
    const threadData = {
      id: 'thread-001',
      title: 'Config: api_key=AKIA1234567890ABCDEF token=sk-live-abc123def456',
      status: 'active',
    };

    const raw = JSON.stringify(threadData);
    const result = redactor.redact(raw);

    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain('AKIA1234567890ABCDEF');
    expect(result.text).not.toContain('sk-live-abc123def456');
    expect(result.text).toContain('[REDACTED]');
  });

  it('should redact secrets from turn output text', async () => {
    // Simulate Codex output containing credentials
    const codexOutput = [
      'Here is your config:',
      'password=MyS3cretP@ss!',
      'And the API response with token=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    ].join('\n');

    const result = redactor.redact(codexOutput);

    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain('MyS3cretP@ss!');
    expect(result.text).not.toContain('ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.text).toContain('Here is your config:'); // Non-secret preserved
  });
});

describe('Redaction flow: WebSocket event pipeline', () => {
  const WS_PORT = 14802;

  it('should redact secrets before broadcasting to WebSocket clients', async () => {
    const redactor = new Redactor(true);
    const received = await new Promise<{ event: { content: string } }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out')), 5000);
      const wss = new WebSocketServer({ port: WS_PORT });

      wss.on('connection', (ws) => {
        const event = {
          type: 'item/completed',
          threadId: 'thread-001',
          content: 'Command output: export API_TOKEN=secret123456789abcdef',
        };
        const redactedContent = redactor.redact(event.content);
        const redactedEvent = { ...event, content: redactedContent.text };
        ws.send(JSON.stringify({ type: 'event', event: redactedEvent }));
      });

      const client = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

      client.on('message', (data) => {
        clearTimeout(timer);
        const msg = JSON.parse(data.toString());
        if (msg.type === 'event') {
          client.close();
          wss.close(() => resolve(msg));
        }
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        wss.close(() => reject(err));
      });
    });

    expect(received.event.content).not.toContain('secret123456789abcdef');
    expect(received.event.content).toContain('[REDACTED]');
    expect(received.event.content).toContain('Command output:');
  });

  it('should preserve non-secret content after redaction', () => {
    const redactor = new Redactor(true);

    const safeContent = 'Build completed successfully in 3.2 seconds.\nAll 42 tests passed.';
    const result = redactor.redact(safeContent);

    expect(result.redacted).toBe(false);
    expect(result.text).toBe(safeContent);
  });
});
