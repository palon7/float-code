export class WorkspaceNotFoundError extends Error {
  constructor(dirPath: string) {
    super(`Directory not found: ${dirPath}`);
    this.name = "WorkspaceNotFoundError";
  }
}
