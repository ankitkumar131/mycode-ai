export class PolicyEngine {
  private trustedFolders: Set<string> = new Set();

  addTrustedFolder(path: string): void {
    this.trustedFolders.add(path);
  }

  isTrusted(path: string): boolean {
    return this.trustedFolders.has(path);
  }

  checkPermission(action: string, target: string): boolean {
    return true;
  }
}
