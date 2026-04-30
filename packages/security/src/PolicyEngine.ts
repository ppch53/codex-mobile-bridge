
import path from 'path';
import { PolicyResult } from './types';

const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-rf?|--recursive)?\b/i,
  /\bdel\s+\/f\b/i,
  /\bformat\b/i,
  /\bdd\b/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bchmod\s+777\b/i,
  /\bcurl.*\|\s*bash\b/i,
  /\bwget.*\|\s*bash\b/i,
];

export class PolicyEngine {
  constructor(
    private allowedWorkspaces: string[],
    private dangerousCommandConfirm: boolean = true
  ) {}

  isPathAllowed(requestPath: string): boolean {
    const resolved = path.resolve(requestPath).toLowerCase().replace(/\\/g, '/');
    for (const workspace of this.allowedWorkspaces) {
      const normalizedWorkspace = path.resolve(workspace).toLowerCase().replace(/\\/g, '/');
      // Exact match or under workspace boundary (must end with /)
      if (resolved === normalizedWorkspace || resolved.startsWith(normalizedWorkspace + '/')) {
        return true;
      }
    }
    return false;
  }

  isDangerousCommand(command: string): boolean {
    for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
      if (pattern.test(command)) {
        return true;
      }
    }
    return false;
  }

  evaluateCommand(command: string): PolicyResult {
    const isDangerous = this.isDangerousCommand(command);

    if (isDangerous && this.dangerousCommandConfirm) {
      return {
        allowed: true,
        requiresSecondConfirmation: true,
        reason: 'This command appears dangerous and requires a second confirmation.',
      };
    }

    return {
      allowed: true,
      requiresSecondConfirmation: false,
    };
  }

  evaluateFileChange(filePath: string): PolicyResult {
    const allowed = this.isPathAllowed(filePath);
    if (!allowed) {
      return {
        allowed: false,
        requiresSecondConfirmation: false,
        reason: `File path "${filePath}" is not in allowed workspaces.`,
      };
    }

    return {
      allowed: true,
      requiresSecondConfirmation: false,
    };
  }

  evaluatePermission(request: { requestedPaths?: string[]; reason?: string }): PolicyResult {
    if (request.requestedPaths) {
      for (const path of request.requestedPaths) {
        if (!this.isPathAllowed(path)) {
          return {
            allowed: false,
            requiresSecondConfirmation: false,
            reason: `Path "${path}" is not in allowed workspaces.`,
          };
        }
      }
    }

    return {
      allowed: true,
      requiresSecondConfirmation: false,
    };
  }

  recordViolation(actor: string, action: string, target: string, reason: string): void {
    // This would be connected to the audit log
    // For now, just a placeholder
    console.warn(`[Policy Violation] ${actor} attempted ${action} on ${target}: ${reason}`);
  }
}
