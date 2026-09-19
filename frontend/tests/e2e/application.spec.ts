import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function login(page: Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(role + "@cedar.local");
  await page.getByLabel("Password", { exact: true }).fill("CedarDemo!2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
}
test("customer home is usable at phone width with no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "customer");
  await expect(
    page.getByRole("heading", {
      name: /Your table, in good time|We’re saving you a place/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "From your host" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/manager");
  await expect(
    page.getByRole("heading", { name: "This area is for restaurant staff." }),
  ).toBeVisible();
});
test("host table controls explain protected availability and keyboard-close their dialog", async ({
  page,
}) => {
  await login(page, "host");
  await expect(
    page.getByRole("heading", { name: "The waitlist" }),
  ).toBeVisible();
  const table = page
    .getByRole("button", { name: /Table .+, .+ seats,/ })
    .first();
  await table.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Reason / service note")).toBeVisible();
  await expect(page.getByLabel("Availability", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/manager");
  await expect(
    page.getByRole("heading", { name: "This area is for restaurant staff." }),
  ).toBeVisible();
});
test("manager can inspect every configuration surface and generate demo activity", async ({
  page,
}) => {
  await login(page, "manager");
  await expect(
    page.getByRole("heading", { name: "Queue activity" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restaurant & tables" }).click();
  await expect(page.getByLabel("Restaurant name")).toHaveValue(
    "The Cedar Table",
  );
  await page.getByRole("button", { name: "Add table", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Seats", { exact: true })).toHaveAttribute(
    "max",
    "20",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Queue policies" }).click();
  await expect(
    page.getByLabel("Priority burst limit", { exact: true }),
  ).toHaveAttribute("max", "2");
  await page.getByRole("button", { name: "Team access" }).click();
  await expect(
    page.getByRole("heading", { name: "Provision an account" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Audit history" }).click();
  await expect(
    page.getByRole("heading", { name: "Operational history" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Demo studio" }).click();
  await page.getByLabel("Number of parties", { exact: true }).fill("1");
  await page.getByRole("button", { name: /Add random customer/ }).click();
  await expect(
    page.getByText("Simulation applied.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset / reseed demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset the demo restaurant?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
});
test("display renders a QR and anonymized calls with restricted access", async ({
  page,
}) => {
  await login(page, "display");
  await expect(
    page.getByRole("heading", { name: "Now welcoming" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Rotating restaurant arrival check-in QR code",
    }),
  ).toBeVisible();
  await expect(page.getByText(/This code refreshes in/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Floor & waitlist" }),
  ).toHaveCount(0);
  const forbidden = await page.request.get("/api/v1/host/board");
  expect(forbidden.status()).toBe(403);
});
