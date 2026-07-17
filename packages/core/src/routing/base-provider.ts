export abstract class BaseProvider {
  abstract get name(): string;
  abstract get model(): string;
  abstract chat(messages: unknown[], tools?: unknown[]): Promise<unknown>;
  abstract stream(messages: unknown[], tools?: unknown[]): AsyncGenerator<unknown>;
}
