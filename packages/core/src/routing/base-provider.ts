/** Default cooldown after a failure, when the caller does not specify one. */
export const DEFAULT_COOLDOWN_MS = 30_000;

/**
 * Default cap on generated tokens per response.
 *
 * 4096 was too small for agentic work: a `write_file` call carrying a React
 * component routinely exceeds it, so the response was truncated mid-JSON, the
 * tool arguments failed to parse, and the turn ended having done nothing
 * visible. Raise per provider with `maxOutputTokens` if a model allows more.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

export abstract class BaseProvider {
  protected _health = {
    successCount: 0,
    failureCount: 0,
    isAvailable: true,
    /** Epoch ms before which this provider is skipped. 0 means ready now. */
    cooldownUntil: 0,
    lastError: undefined as string | undefined,
  };

  abstract get name(): string;
  abstract get model(): string;
  abstract get canRead(): boolean;
  abstract get canWrite(): boolean;

  abstract chat(messages: unknown[], tools?: unknown[], options?: any): Promise<any>;
  abstract stream(messages: unknown[], tools?: unknown[], options?: any): AsyncGenerator<any>;

  /** A successful call clears any cooldown, so the provider is preferred again immediately. */
  recordSuccess(): void {
    this._health.successCount++;
    this._health.failureCount = 0;
    this._health.cooldownUntil = 0;
    this._health.isAvailable = true;
    this._health.lastError = undefined;
  }

  /**
   * Park this provider for `cooldownMs`. The cooldown expires on its own, which
   * is what lets a primary recover after a transient blip instead of staying
   * demoted for the rest of the session.
   */
  recordFailure(cooldownMs: number = DEFAULT_COOLDOWN_MS, message?: string): void {
    this._health.failureCount++;
    this._health.cooldownUntil = Date.now() + Math.max(0, cooldownMs);
    if (message) this._health.lastError = message;
  }

  /** Eligible for a new request: not disabled, and out of cooldown. */
  isReady(now: number = Date.now()): boolean {
    return this._health.isAvailable && now >= this._health.cooldownUntil;
  }

  /** Clear any cooldown or disabled state so this provider is immediately eligible. */
  resetCooldown(): void {
    this._health.cooldownUntil = 0;
    this._health.isAvailable = true;
  }

  getHealth() {
    return { ...this._health };
  }

  toJSON() {
    // `isAvailable` is only ever written as `true`, so status must come from the
    // cooldown window. Serializing it as always-'active' made every diagnostic
    // downstream report a dead provider as healthy.
    const ready = this.isReady();
    return {
      name: this.name,
      model: this.model,
      status: ready ? ('active' as const) : ('error' as const),
      successCount: this._health.successCount,
      failureCount: this._health.failureCount,
      lastError: this._health.lastError,
    };
  }
}
