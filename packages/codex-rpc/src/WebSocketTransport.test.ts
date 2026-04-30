import { WebSocketServer } from 'ws';
import { WebSocketTransport } from './WebSocketTransport';

describe('WebSocketTransport', () => {
  let server: WebSocketServer;
  let port: number;

  beforeEach((done) => {
    server = new WebSocketServer({ port: 0 });
    server.on('listening', () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      done();
    });
  });

  afterEach((done) => {
    server.close(done);
  });

  it('should connect to a WebSocket server', async () => {
    const transport = new WebSocketTransport({ url: `ws://127.0.0.1:${port}` });
    await transport.connect();
    expect(true).toBe(true); // connected without error
    await transport.disconnect();
  });

  it('should send and receive messages', async () => {
    server.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: 'ok' }));
      });
    });

    const transport = new WebSocketTransport({ url: `ws://127.0.0.1:${port}` });
    await transport.connect();

    const responsePromise = new Promise<string>((resolve) => {
      transport.onMessage((data) => resolve(data));
    });

    await transport.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test' }));

    const response = await responsePromise;
    const parsed = JSON.parse(response);
    expect(parsed.result).toBe('ok');
    expect(parsed.id).toBe(1);

    await transport.disconnect();
  });

  it('should call onClose when connection drops', async () => {
    server.on('connection', (ws) => {
      setTimeout(() => ws.close(), 50);
    });

    const transport = new WebSocketTransport({ url: `ws://127.0.0.1:${port}` });
    const closed = new Promise<void>((resolve) => {
      transport.onClose(resolve);
    });

    await transport.connect();
    await closed;
    await transport.disconnect();
  });

  it('should reject on connection timeout', async () => {
    // Use a port that won't respond
    const transport = new WebSocketTransport({
      url: 'ws://127.0.0.1:1',
      connectTimeoutMs: 200,
    });

    await expect(transport.connect()).rejects.toThrow();
  });

  it('should send auth token as header when provided', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let receivedHeaders: Record<string, any> | null = null;
    server.on('connection', (_ws, req) => {
      receivedHeaders = req.headers as Record<string, any>;
    });

    const transport = new WebSocketTransport({
      url: `ws://127.0.0.1:${port}`,
      authToken: 'test-token-123',
    });
    await transport.connect();

    // Give the server a moment to process the connection
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(receivedHeaders).not.toBeNull();
    expect(receivedHeaders!['authorization']).toBe('Bearer test-token-123');

    await transport.disconnect();
  });
});
