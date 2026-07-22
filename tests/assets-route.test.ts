import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requestMocks = vi.hoisted(() => ({ requireSafeOrigin: vi.fn() }));

vi.mock("@/server/security/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/security/request")>()),
  requireSafeOrigin: requestMocks.requireSafeOrigin
}));

import { DELETE, GET, PATCH, POST } from "@/app/api/assets/route";
import { closeAllDatabases } from "@/server/db/database";
import { listBrandAssets, resetAllData } from "@/server/db/repository";
import { createWorkspaceRecord, currentWorkspaceId, runInWorkspace } from "@/server/workspaces/registry";

const originalDataDirectory = process.env.MARKETING_HUB_DATA_DIR;
const testDataDirectory = path.join(os.tmpdir(), `marketing-hub-assets-route-vitest-${process.pid}`);
let imageBytes: Buffer;

beforeAll(async () => {
  process.env.MARKETING_HUB_DATA_DIR = testDataDirectory;
  imageBytes = await sharp({ create: { width: 320, height: 240, channels: 4, background: "#315678" } }).png().toBuffer();
});

beforeEach(() => {
  requestMocks.requireSafeOrigin.mockReset().mockResolvedValue(undefined);
  closeAllDatabases();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  resetAllData();
});

afterAll(() => {
  closeAllDatabases();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  if (originalDataDirectory === undefined) delete process.env.MARKETING_HUB_DATA_DIR;
  else process.env.MARKETING_HUB_DATA_DIR = originalDataDirectory;
});

describe("brand asset route workspace binding", () => {
  it("keeps async uploads and subsequent operations inside the explicit workspace", async () => {
    const workspace = createWorkspaceRecord({ name: "Scoped Asset Workspace" });
    expect(currentWorkspaceId()).toBe("default");

    const form = new FormData();
    form.set("workspaceId", workspace.id);
    form.set("title", "Scoped visual reference");
    form.set("type", "assistant_attachment");
    form.set("file", new File([Uint8Array.from(imageBytes)], "scoped-reference.png", { type: "image/png" }));
    const uploadResponse = await POST(new Request("http://127.0.0.1:3000/api/assets", { method: "POST", body: form }));
    const uploaded = await uploadResponse.json() as { id: string; active: boolean };

    expect(uploadResponse.status).toBe(201);
    expect(listBrandAssets()).toEqual([]);
    expect(runInWorkspace(workspace.id, () => listBrandAssets())).toEqual([
      expect.objectContaining({ id: uploaded.id, type: "assistant_attachment", active: true, mimeType: "image/png" })
    ]);

    const wrongWorkspaceRead = await GET(new Request(`http://127.0.0.1:3000/api/assets?workspaceId=default&id=${uploaded.id}`));
    expect(wrongWorkspaceRead.status).toBe(404);
    const scopedRead = await GET(new Request(`http://127.0.0.1:3000/api/assets?workspaceId=${workspace.id}&id=${uploaded.id}`));
    expect(scopedRead.status).toBe(200);
    expect(scopedRead.headers.get("content-type")).toBe("image/png");

    const patchResponse = await PATCH(new Request("http://127.0.0.1:3000/api/assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspace.id, id: uploaded.id, active: false })
    }));
    expect(patchResponse.status).toBe(200);
    expect(runInWorkspace(workspace.id, () => listBrandAssets()[0].active)).toBe(false);

    await DELETE(new Request(`http://127.0.0.1:3000/api/assets?workspaceId=default&id=${uploaded.id}`, { method: "DELETE" }));
    expect(runInWorkspace(workspace.id, () => listBrandAssets())).toHaveLength(1);

    const deleteResponse = await DELETE(new Request(`http://127.0.0.1:3000/api/assets?workspaceId=${workspace.id}&id=${uploaded.id}`, { method: "DELETE" }));
    expect(deleteResponse.status).toBe(200);
    expect(runInWorkspace(workspace.id, () => listBrandAssets())).toEqual([]);
    expect(listBrandAssets()).toEqual([]);
  });
});
