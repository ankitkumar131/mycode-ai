export class SafetyChecker {
  isCommandAllowed(command: string): boolean {
    return true;
  }

  isPathAllowed(path: string): boolean {
    return true;
  }

  sanitizeInput(input: string): string {
    return input;
  }
}
