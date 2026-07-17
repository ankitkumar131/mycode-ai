export class SystemPromptBuilder {
  private parts: string[] = [];

  addSection(section: string): void {
    this.parts.push(section);
  }

  build(): string {
    return this.parts.join('\n\n');
  }

  static default(): string {
    return 'You are MyCode, a multi-provider AI coding agent.';
  }
}
