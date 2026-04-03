import { homedir } from "node:os";
import { Hono } from "hono";
import type {
  WorkspacesRecentResponse,
  WorkspacesBrowseResponse,
  WorkspaceDetailResponse,
} from "@float-code/shared/protocol";
import { getRecent } from "../workspace/workspace-store.js";
import { browseDirectory } from "../workspace/browse.js";
import { getWorkspaceDetail } from "../workspace/detail.js";
import { WorkspaceNotFoundError } from "../workspace/errors.js";
import { errorResponse } from "./error-response.js";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "api" });

const workspacesRouter = new Hono()
  .onError((err, c) => {
    if (err instanceof WorkspaceNotFoundError) {
      log.warn({ err }, "Workspace not found");
      return errorResponse(c, 404, "WORKSPACE_NOT_FOUND", err.message);
    }
    throw err;
  })
  .get("/recent", async (c) => {
    const workspaces = await getRecent();
    return c.json<WorkspacesRecentResponse>({ workspaces });
  })
  .get("/browse", async (c) => {
    const dirPath = c.req.query("path") || homedir();
    const entries = await browseDirectory(dirPath);
    return c.json<WorkspacesBrowseResponse>({ path: dirPath, entries });
  })
  .get("/detail", async (c) => {
    const dirPath = c.req.query("path");
    if (!dirPath) {
      return errorResponse(
        c,
        400,
        "INVALID_REQUEST",
        "Query parameter 'path' is required",
      );
    }

    const detail = await getWorkspaceDetail(dirPath);
    return c.json<WorkspaceDetailResponse>(detail);
  });

export default workspacesRouter;
