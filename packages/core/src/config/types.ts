import type { ProviderConfig } from '../routing/types.js';

export interface MyCodeConfig {
  version: string;
  providers: ProviderConfig[];
  preferences: {
    confirmWrites: boolean;
    confirmCommands: boolean;
  };
  mcp?: {
    servers: Array<{
      name: string;
      command: string;
      args?: string[];
    }>;
  };
  theme?: string;
  vimMode?: boolean;
}
