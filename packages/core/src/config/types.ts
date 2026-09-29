import type { ProviderConfig } from '../routing/types.js';
import type { PonytailMode } from '../policy/ponytail.js';
import type { BrowserVerifierConfig } from '../integrations/browser-verifier.js';
import type { DecisionGateConfig } from '../integrations/decision-gate.js';

export interface MyCodeConfig {
  version: string;
  providers: ProviderConfig[];
  preferences: {
    theme?: string;
    confirmWrites: boolean;
    confirmCommands: boolean;
    maxContextFiles?: number;
    logConversations?: boolean;
  };
  /** Native Ponytail policy. It is enabled for every task by default. */
  ponytail?: {
    mode: PonytailMode;
    applyToAllTasks: boolean;
  };
  /** Application-level execution policy. Provider quotas remain outside MyCode's control. */
  usage?: {
    unlimited: boolean;
  };
  /** Automatic intent routing and bounded local/remote task orchestration. */
  orchestration?: {
    enabled?: boolean;
    maxParallelTasks?: number;
  };
  /** Optional external adapters used by automatic orchestration. */
  integrations?: {
    browser?: BrowserVerifierConfig;
    decision?: DecisionGateConfig;
  };
  mcp?: {
    servers: Array<{
      name: string;
      command: string;
      args?: string[];
    }>;
  };
  vimMode?: boolean;
  /** Tools disabled by default for every session */
  disabledTools?: string[];
  /** Restrict to these toolsets (empty = all) */
  toolsets?: string[];
  skills?: {
    externalDirs?: string[];
    noBundled?: boolean;
  };
  /** User-defined quick commands: /name → shell exec or alias to another slash command */
  quickCommands?: Record<string, { type: 'exec' | 'alias'; command?: string; target?: string; description?: string }>;
  /** Named personalities → system-prompt overlay text */
  personalities?: Record<string, string>;
  /** Approx context window per provider name or model (tokens) */
  contextWindows?: Record<string, number>;
}
