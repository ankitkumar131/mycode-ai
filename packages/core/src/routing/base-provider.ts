export abstract class BaseProvider {
  protected _health: {
    successCount: number;
    failureCount: number;
    isAvailable: boolean;
    lastError?: string;
  } = { successCount: 0, failureCount: 0, isAvailable: true };

  abstract get name(): string;
  abstract get model(): string;
  abstract get canRead(): boolean;
  abstract get canWrite(): boolean;

  abstract chat(messages: unknown[], tools?: unknown[], options?: any): Promise<any>;
  abstract stream(messages: unknown[], tools?: unknown[], options?: any): AsyncGenerator<any>;

  recordSuccess(): void {
    this._health.successCount++;
    this.markAvailable();
  }

  recordFailure(error?: string): void {
    this._health.failureCount++;
    if (error) this._health.lastError = error;
  }

  markUnavailable(error?: string): void {
    this._health.isAvailable = false;
    if (error) this._health.lastError = error;
  }

  markAvailable(): void {
    this._health.isAvailable = true;
    this._health.lastError = undefined;
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
