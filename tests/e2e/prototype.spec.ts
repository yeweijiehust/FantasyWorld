import { expect, test } from "@playwright/test";

test("creates a world and advances one turn", async ({ page }, testInfo) => {
  const worldName = `雾港纪元 ${testInfo.project.name}`;

  await page.goto("/");
  await page.getByRole("button", { name: "Enter" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("textbox", { name: "World name" }).fill(worldName);
  await page.getByRole("textbox", { name: "Premise" }).fill("旧王国崩塌后，边境港口正在形成新的权力秩序。");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("textbox", { name: "Character seeds" }).fill("艾琳\n赛勒斯\n莫娜");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByText("Draft ready")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(worldName) })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Draft ready")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(worldName) })).toHaveCount(0);
  await page.getByRole("button", { name: "Accept draft" }).click();
  await expect(page.getByRole("heading", { name: worldName })).toBeVisible();
  await page.getByRole("textbox", { name: "GM intervention" }).fill("让一艘陌生船只抵达港口");
  await page.getByRole("button", { name: "Advance turn" }).click();
  await expect(page.getByText("GM 指令改变了局势")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: new RegExp(worldName) }).click();
  await expect(page.getByRole("heading", { name: worldName })).toBeVisible();
  await expect(page.getByText("GM 指令改变了局势")).toBeVisible();
  await page.getByRole("button", { name: "Accept turn" }).click();
  await expect(page.getByRole("button", { name: "Turn accepted" })).toBeVisible();
  await page.getByRole("button", { name: "Rollback" }).click();
  await expect(page.getByText("The world is waiting for its first turn.")).toBeVisible();
});
