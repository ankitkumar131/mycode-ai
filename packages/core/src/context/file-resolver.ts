export class FileContextResolver {
  constructor(private cwd: string) {}

  resolve(input: string): string {
    return input;
  }

  getResolvedFiles(): string[] {
    return [];
  }
}
