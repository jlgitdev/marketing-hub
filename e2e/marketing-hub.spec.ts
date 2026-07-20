import { expect, test } from "@playwright/test";
import { hasExternalSpeakerSite } from "../tests/external-speaker-site";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => { await fetch("/api/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) }); });
  await page.reload();
  await expect(page.getByText("Demo mode").first()).toBeVisible();
});

test("completes and reopens the deterministic marketing workflow", async ({ page }) => {
  test.setTimeout(60_000);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Leads" }).click();
  await expect(page.getByRole("heading", { name: "Find, qualify, and act on the right leads", exact: true })).toBeVisible();
  const ticketBuyerStrategy = page.getByRole("button", { name: "Ticket buyers Individuals, teams, and learning budgets", exact: true });
  await ticketBuyerStrategy.click();
  await expect(ticketBuyerStrategy).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("5 audiences · 3 paths")).toBeVisible();
  await page.getByRole("button", { name: "Balanced pipeline Ticket buyers and distribution partners", exact: true }).click();
  const researchResponse = page.waitForResponse((response) => response.url().endsWith("/api/research") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Find qualified leads" }).click();
  expect((await researchResponse).status()).toBe(202);
  await expect(page.locator(".operation-card").filter({ hasText: "Bay Area AI summit sales pipeline" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Content" }).click();
  await expect(page.locator(".activity-trigger")).toBeVisible();
  const researchToast = page.locator(".operation-toast").filter({ hasText: "Bay Area AI summit sales pipeline" });
  await expect(researchToast).toBeVisible({ timeout: 20_000 });
  await researchToast.getByRole("link", { name: "View" }).click();
  const leadCard = page.locator(".lead-card").filter({ hasText: "Bay Circuit AI Community" });
  await expect(leadCard).toBeVisible();
  await leadCard.getByText(/Inspect qualification, .* sources?, and review notes/).click();
  await expect(leadCard.getByRole("link", { name: /Bay Circuit partnerships/ })).toBeVisible();
  await leadCard.getByLabel("Select Bay Circuit AI Community").check();
  const leadCsvDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export leads" }).click();
  expect((await leadCsvDownload).suggestedFilename()).toBe("summit-sales-leads.csv");
  await page.getByRole("button", { name: "Create sales outreach" }).click();
  const recipientCard = page.locator(".recipient-card").filter({ hasText: "Bay Circuit AI Community" });
  await expect(recipientCard).toBeVisible({ timeout: 20_000 });
  await recipientCard.locator(":scope > summary").click();
  await recipientCard.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(recipientCard.getByText("reviewed", { exact: true })).toBeVisible();
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export reviewed CSV" }).click();
  expect((await csvDownload).suggestedFilename()).toBe("marketing-hub-outreach.csv");

  await page.getByRole("link", { name: "Content" }).click();
  await page.getByRole("button", { name: "Generate platform drafts" }).click();
  await expect(page.getByRole("heading", { name: "LinkedIn" })).toBeVisible({ timeout: 20_000 });
  const linkedInText = page.locator(".platform-card").filter({ hasText: "LinkedIn" }).getByLabel("Post text");
  await linkedInText.fill(`${await linkedInText.inputValue()}\n\nEdited in the deterministic browser test.`);
  await page.locator(".platform-card").filter({ hasText: "LinkedIn" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/LinkedIn draft saved/)).toBeVisible();
  await page.getByRole("button", { name: "Generate and render graphic" }).click();
  await expect(page.locator(".generated-gallery img").first()).toBeVisible({ timeout: 20_000 });
  const imageDownload = page.waitForEvent("download");
  await page.locator(".generated-gallery").getByRole("link", { name: "PNG" }).first().click();
  expect((await imageDownload).suggestedFilename()).toMatch(/\.png$/);

  await page.reload();
  await expect(page.getByText("Applied Intelligence Forum launch").first()).toBeVisible();
  await page.getByRole("link", { name: "Runs" }).click();
  await expect(page.getByText("Bay Area AI summit sales pipeline")).toBeVisible();
  await expect(page.getByText("Applied Intelligence Forum launch")).toBeVisible();
  const researchRun = page.locator(".run-card").filter({ hasText: "Bay Area AI summit sales pipeline" });
  await researchRun.getByRole("link", { name: "Reopen" }).press("Enter");
  await expect(page.getByText("Bay Area AI summit sales pipeline").first()).toBeVisible();
  await page.getByRole("link", { name: "Runs" }).click();
  const contentRun = page.locator(".run-card").filter({ hasText: "Applied Intelligence Forum launch" });
  await contentRun.getByRole("link", { name: "Reopen" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Applied Intelligence Forum launch" })).toBeVisible();
});

test("settings explains ephemeral keys and local reset boundaries", async ({ page }) => {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText(/Raw key is never stored/)).toBeVisible();
  await expect(page.getByText(/Opaque HttpOnly cookie only/)).toBeVisible();
  await expect(page.locator("code")).toContainText("marketing-hub");
});

test.describe("Speaker Spotlight with downloaded site fixture", () => {
  test.skip(!hasExternalSpeakerSite, "Set AGI_SUMMIT_SITE_DIR to run downloaded-site Speaker Spotlight coverage.");

  test("creates a grouped Speaker Spotlight package from a speaker name", async ({ page }) => {
    await page.getByRole("link", { name: "Spotlight", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Speaker Spotlight", exact: true })).toBeVisible();
    await page.getByLabel("Speaker names").fill("Joe Palermo");
    await page.getByRole("button", { name: "Create Speaker Spotlights" }).click();
    const result = page.locator(".spotlight-result").filter({ hasText: "Joe Palermo" });
    await expect(result.getByRole("img", { name: /Joe Palermo Speaker Spotlight/ })).toBeVisible({ timeout: 30_000 });
    await expect(result.getByText(/Speaker Spotlight: Joe Palermo/)).toBeVisible();
    await expect(result.getByRole("link", { name: "Download image" })).toBeVisible();
    await page.getByRole("link", { name: "Runs" }).click();
    await expect(page.locator(".run-card").filter({ hasText: "Speaker Spotlight · Joe Palermo" })).toBeVisible();
  });
});

test("restores progress after reload and cancels queued work before it starts", async ({ page }) => {
  await page.getByRole("link", { name: "Leads" }).click();
  await page.getByRole("button", { name: "Find qualified leads" }).click();
  await expect(page.locator(".operation-card").filter({ hasText: "Bay Area AI summit sales pipeline" }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator(".operation-card").filter({ hasText: "Bay Area AI summit sales pipeline" }).first()).toBeVisible();

  await page.getByRole("link", { name: "Content" }).click();
  await page.getByRole("button", { name: "Generate platform drafts" }).click();
  await page.locator(".activity-trigger").click();
  const queuedCampaign = page.locator(".activity-drawer .operation-card").filter({ hasText: "Applied Intelligence Forum launch" });
  await expect(queuedCampaign).toContainText("Queued");
  await queuedCampaign.getByRole("button", { name: "Cancel" }).click();
  await expect(queuedCampaign).toContainText("Canceled");
  await expect(page.getByRole("heading", { name: "LinkedIn" })).not.toBeVisible();
});
