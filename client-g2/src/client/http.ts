import type {
  SessionListItem,
  WorkspaceInfo,
  WorkspacesBrowseResponse,
} from "@float-code/shared/protocol";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export class HttpClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  updateConfig(baseUrl: string, token: string): void {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async getRecentWorkspaces(signal?: AbortSignal): Promise<WorkspaceInfo[]> {
    const res = await this.doFetch("/api/workspaces/recent", signal);
    const data = (await res.json()) as { workspaces: WorkspaceInfo[] };
    return data.workspaces;
  }

  async getSessions(
    workspacePath: string,
    signal?: AbortSignal,
  ): Promise<SessionListItem[]> {
    const params = new URLSearchParams({ workspacePath });
    const res = await this.doFetch(
      `/api/sessions?${params.toString()}`,
      signal,
    );
    if (res.status === 404) return [];
    const data = (await res.json()) as { sessions: SessionListItem[] };
    return data.sessions;
  }

  async browse(
    path?: string,
    signal?: AbortSignal,
  ): Promise<WorkspacesBrowseResponse> {
    const params = path ? `?${new URLSearchParams({ path }).toString()}` : "";
    const res = await this.doFetch(`/api/workspaces/browse${params}`, signal);
    if (res.status === 404) {
      let message = "HTTP 404";
      try {
        const data = (await res.json()) as {
          error?: { message?: string };
        };
        message = data.error?.message ?? message;
      } catch {
        // JSON parse failed
      }
      throw new Error(message);
    }
    return (await res.json()) as WorkspacesBrowseResponse;
  }

  private async doFetch(path: string, signal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(
      () => controller.abort(),
      DEFAULT_FETCH_TIMEOUT_MS,
    );
    const abortListener = () => controller.abort();
    signal?.addEventListener("abort", abortListener, { once: true });

    let res: Response;
    try {
      res = await globalThis.fetch(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new Error(
          `Request timed out after ${DEFAULT_FETCH_TIMEOUT_MS}ms`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", abortListener);
    }

    if (res.ok || res.status === 404) return res;

    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as {
        error?: { message?: string };
      };
      message = data.error?.message ?? message;
    } catch {
      // JSON parse failed, use default message
    }
    throw new Error(message);
  }
}
