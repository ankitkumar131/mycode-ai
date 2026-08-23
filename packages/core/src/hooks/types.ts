export interface HookDefinition {
  name: string;
  event: string;
  handler: (event: HookEvent) => Promise<void>;
}

export interface HookEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: Date;
}
