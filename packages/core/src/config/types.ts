import type { ProviderConfig } from '../routing/types.js';

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
  mcp?: {
    servers: Array<{
      name: string;
      command: string;
      args?: string[];
    }>;
  };
  vimMode?: boolean;
}
