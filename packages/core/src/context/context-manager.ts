import { FileContextResolver } from './file-resolver.js';

export class ContextManager {
  private resolver: FileContextResolver;

  constructor(private cwd: string) {
    this.resolver = new FileContextResolver(cwd);
  }

  async getSystemContext(): Promise<string> {
    return '';
  }

  resolveReferences(input: string): { resolved: string; files: string[] } {
    return { resolved: input, files: [] };
  }
}
