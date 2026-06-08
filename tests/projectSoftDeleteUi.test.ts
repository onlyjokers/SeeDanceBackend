import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("project soft delete UI wiring", () => {
  const source = readFileSync("src/main.tsx", "utf8");

  it("lets executor soft delete projects through the project API", () => {
    expect(source).toContain("deleteProject");
    expect(source).toContain("onDeleteProject");
    expect(source).toContain("DELETE");
    expect(source).toContain("/api/video-projects/${projectId}");
  });

  it("lets manager restore deleted projects", () => {
    expect(source).toContain("\"projects\"");
    expect(source).toContain("restoreProject");
    expect(source).toContain("onRestoreProject");
    expect(source).toContain("/api/manager/video-projects/${projectId}/restore");
  });

  it("keeps executor scoped to active projects", () => {
    expect(source).toContain("activeProjects");
    expect(source).toContain("!project.deletedAt");
  });
});
