export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: string;
  checks: Record<string, { healthy: boolean; latencyMs?: number; error?: string }>;
}

export interface DiagnosticsConfig {
  getRpcConnected?: () => boolean;
  getStoreHealthy?: () => Promise<boolean>;
  getTelegramRunning?: () => boolean;
  getWebRunning?: () => boolean;
  getPendingApprovals?: () => number;
}

export class Diagnostics {
  private startTime: number;
  private config: DiagnosticsConfig;

  constructor(config: DiagnosticsConfig = {}) {
    this.startTime = Date.now();
    this.config = config;
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }

  async checkHealth(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult['checks'] = {};
    let healthyCount = 0;
    let totalChecks = 0;

    // RPC check
    if (this.config.getRpcConnected) {
      totalChecks++;
      const start = Date.now();
      const ok = this.config.getRpcConnected();
      checks.rpc = { healthy: ok, latencyMs: Date.now() - start };
      if (ok) healthyCount++;
    }

    // Store check
    if (this.config.getStoreHealthy) {
      totalChecks++;
      const start = Date.now();
      try {
        const ok = await this.config.getStoreHealthy();
        checks.store = { healthy: ok, latencyMs: Date.now() - start };
        if (ok) healthyCount++;
      } catch (err) {
        checks.store = { healthy: false, error: String(err) };
      }
    }

    // Telegram check
    if (this.config.getTelegramRunning) {
      totalChecks++;
      const ok = this.config.getTelegramRunning();
      checks.telegram = { healthy: ok };
      if (ok) healthyCount++;
    }

    // Web check
    if (this.config.getWebRunning) {
      totalChecks++;
      const ok = this.config.getWebRunning();
      checks.web = { healthy: ok };
      if (ok) healthyCount++;
    }

    // Pending approvals
    if (this.config.getPendingApprovals) {
      const count = this.config.getPendingApprovals();
      checks.pendingApprovals = { healthy: true };
      checks.pendingApprovals.latencyMs = count; // reuse field for count
    }

    let status: HealthCheckResult['status'];
    if (totalChecks === 0 || healthyCount === totalChecks) {
      status = 'ok';
    } else if (healthyCount > 0) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      uptime: this.getUptime(),
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}

export function createDiagnostics(config?: DiagnosticsConfig): Diagnostics {
  return new Diagnostics(config);
}
