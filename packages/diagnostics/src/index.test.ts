import { Diagnostics, createDiagnostics } from './index';

describe('Diagnostics', () => {
  it('should report uptime > 0', async () => {
    const diag = new Diagnostics();
    const uptime = diag.getUptime();
    expect(uptime).toBeGreaterThanOrEqual(0);
  });

  it('should return ok status with no checks configured', async () => {
    const diag = new Diagnostics({});
    const result = await diag.checkHealth();
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBeDefined();
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(Object.keys(result.checks)).toHaveLength(0);
  });

  it('should return ok when all checks pass', async () => {
    const diag = new Diagnostics({
      getRpcConnected: () => true,
      getStoreHealthy: async () => true,
      getTelegramRunning: () => true,
      getWebRunning: () => true,
      getPendingApprovals: () => 2,
    });
    const result = await diag.checkHealth();
    expect(result.status).toBe('ok');
    expect(result.checks.rpc?.healthy).toBe(true);
    expect(result.checks.store?.healthy).toBe(true);
    expect(result.checks.telegram?.healthy).toBe(true);
    expect(result.checks.web?.healthy).toBe(true);
    expect(result.checks.pendingApprovals?.latencyMs).toBe(2);
  });

  it('should return degraded when some checks fail', async () => {
    const diag = new Diagnostics({
      getRpcConnected: () => true,
      getStoreHealthy: async () => false,
    });
    const result = await diag.checkHealth();
    expect(result.status).toBe('degraded');
    expect(result.checks.rpc?.healthy).toBe(true);
    expect(result.checks.store?.healthy).toBe(false);
  });

  it('should return unhealthy when all checks fail', async () => {
    const diag = new Diagnostics({
      getRpcConnected: () => false,
      getStoreHealthy: async () => false,
      getTelegramRunning: () => false,
    });
    const result = await diag.checkHealth();
    expect(result.status).toBe('unhealthy');
  });

  it('should handle store check throwing error', async () => {
    const diag = new Diagnostics({
      getStoreHealthy: async () => { throw new Error('DB locked'); },
    });
    const result = await diag.checkHealth();
    // Single failing check results in 'unhealthy'
    expect(result.status).toBe('unhealthy');
    expect(result.checks.store?.healthy).toBe(false);
    expect(result.checks.store?.error).toContain('DB locked');
  });

  it('should track latency for rpc check', async () => {
    const diag = new Diagnostics({
      getRpcConnected: () => true,
    });
    const result = await diag.checkHealth();
    expect(result.checks.rpc?.latencyMs).toBeDefined();
    expect(result.checks.rpc?.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('createDiagnostics', () => {
  it('should create a Diagnostics instance', () => {
    const diag = createDiagnostics();
    expect(diag).toBeInstanceOf(Diagnostics);
  });

  it('should pass config to Diagnostics', async () => {
    const diag = createDiagnostics({ getRpcConnected: () => true });
    const result = await diag.checkHealth();
    expect(result.checks.rpc?.healthy).toBe(true);
  });
});
