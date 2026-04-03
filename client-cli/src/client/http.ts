import type {
  SessionListItem,
  WorkspaceInfo,
} from "@float-code/shared/protocol";

export class HttpClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  async getRecentWorkspaces(): Promise<WorkspaceInfo[]> {
    const res = await this.fetch("/api/workspaces/recent");
    const data = (await res.json()) as { workspaces: WorkspaceInfo[] };
    return data.workspaces;
  }

  async getSessions(workspacePath: string): Promise<SessionListItem[]> {
    const params = new URLSearchParams({ workspacePath });
    const res = await this.fetch(`/api/sessions?${params.toString()}`);
    if (res.status === 404) return [];
    const data = (await res.json()) as { sessions: SessionListItem[] };
    return data.sessions;
  }

  private async fetch(path: string): Promise<Response> {
    return globalThis.fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });
  }
}
