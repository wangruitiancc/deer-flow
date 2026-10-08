import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

const FRONTEND_ROOT = path.resolve(__dirname, "../../..");

function source(relativePath: string): string {
  return readFileSync(path.join(FRONTEND_ROOT, relativePath), "utf8");
}

describe("Matrix-Law product boundary", () => {
  it("routes generic workspace entry points back to legal matters", () => {
    for (const file of [
      "src/app/workspace/page.tsx",
      "src/app/workspace/chats/page.tsx",
      "src/app/workspace/agents/layout.tsx",
      "src/app/workspace/scheduled-tasks/page.tsx",
      "src/app/blog/[[...mdxPath]]/page.tsx",
      "src/app/blog/posts/page.tsx",
      "src/app/blog/tags/[tag]/page.tsx",
      "src/app/[lang]/docs/[[...mdxPath]]/page.tsx",
      "src/app/showcase/[thread_id]/page.tsx",
    ]) {
      expect(source(file)).toContain('redirect("/workspace/law")');
    }
    const landing = source("src/app/page.tsx");
    expect(landing).toContain("getAuthenticatedHomePath");
    expect(landing).toContain('redirect("/setup")');
  });

  it("routes platform administrators to the operator home", () => {
    const roleRouting = source("src/core/auth/role-routing.ts");
    const landingPage = source("src/app/page.tsx");
    const adminPage = source("src/app/admin/page.tsx");

    expect(roleRouting).toContain(
      'user.system_role === "admin" ? "/admin" : "/workspace/law"',
    );
    expect(landingPage).toContain("getAuthenticatedHomePath");
    expect(landingPage).toContain(
      "redirect(getAuthenticatedHomePath(result.user))",
    );
    expect(adminPage).not.toContain('href="/workspace/law"');
  });

  it("does not expose generic chat, custom-agent, schedule, or channel navigation", () => {
    const sidebar = source("src/components/workspace/workspace-sidebar.tsx");
    const header = source("src/components/workspace/workspace-header.tsx");
    const palette = source("src/components/workspace/command-palette.tsx");
    const chatPage = source("src/components/workspace/chats/chat-page.tsx");
    const skillSettings = source(
      "src/components/workspace/settings/skill-settings-page.tsx",
    );
    const settingsDialog = source(
      "src/components/workspace/settings/settings-dialog.tsx",
    );
    const settingsDeepLink = source(
      "src/components/workspace/workspace-settings-deep-link.tsx",
    );
    const navMenu = source("src/components/workspace/workspace-nav-menu.tsx");
    const threadPage = source("src/app/workspace/chats/[thread_id]/page.tsx");

    expect(sidebar).not.toContain("WorkspaceChannelsList");
    expect(sidebar).not.toContain("RecentChatList");
    expect(sidebar).not.toContain("WorkspaceNavChatList");
    expect(sidebar).toContain("LegalProjectTree");
    expect(header.match(/\{t\.sidebar\.lawMatters\}/g)).toHaveLength(1);
    expect(header).not.toContain("/workspace/chats/new");
    expect(palette).not.toContain("/workspace/chats/new");
    expect(chatPage).not.toContain("/workspace/chats/new");
    expect(chatPage).not.toContain("ThreadScheduledTasksLink");
    expect(skillSettings).not.toContain("/workspace/chats/new");
    expect(settingsDialog).not.toContain("ChannelsSettingsPage");
    expect(settingsDialog).not.toContain("IntegrationsSettingsPage");
    expect(settingsDialog).not.toContain("SubagentSettingsPage");
    expect(settingsDialog).not.toContain("SkillSettingsPage");
    expect(settingsDialog).not.toContain("ToolSettingsPage");
    expect(settingsDeepLink).not.toContain('\"channels\"');
    expect(settingsDeepLink).not.toContain('\"integrations\"');
    expect(navMenu).not.toContain("deerflow.tech");
    expect(navMenu).not.toContain("bytedance/deer-flow");
    expect(threadPage).toContain("LegalThreadGate");
    expect(header).toContain("MatrixLawLogo");
    expect(source("src/components/brand/matrix-law-logo.tsx")).toContain(
      "Matrix-Law",
    );
  });

  it("brands authentication and product copy as Matrix-Law", () => {
    expect(source("src/app/(auth)/login/page.tsx")).toContain("Matrix-Law");
    expect(source("src/app/(auth)/login/page.tsx")).not.toContain(">DeerFlow<");
    expect(source("src/app/(auth)/setup/page.tsx")).toContain("Matrix-Law");
    expect(
      source("src/components/workspace/settings/about-content.ts"),
    ).toContain("dedicated legal work system");
    expect(source("src/components/workspace/input-box.tsx")).not.toContain(
      'useSkills } from "@/core/skills/hooks"',
    );
  });
});
