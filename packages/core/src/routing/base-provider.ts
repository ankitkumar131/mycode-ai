export abstract class BaseProvider {
  protected _health = { successCount: 0, failureCount: 0, isAvailable: true };

  abstract get name(): string;
  abstract get model(): string;
  abstract get canRead(): boolean;
  abstract get canWrite(): boolean;

  abstract chat(messages: unknown[], tools?: unknown[]): Promise<unknown>;
  abstract stream(messages: unknown[], tools?: unknown[]): AsyncGenerator<unknown>;

  recordSuccess(): void {
    this._health.successCount++;
  }

  recordFailure(): void {
    this._health.failureCount++;
  }

  getHealth() {
    return { ...this._health };
  }

  toJSON() {
    return {
      name: this.name,
      model: this.model,
      priority: 0,
      status: this._health.isAvailable ? ('active' as const) : ('error' as const),
    };
  }
}
