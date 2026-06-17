import { readFileSync } from "node:fs";
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
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;
  const exportPath = testInfo.outputPath(`export-${testInfo.project.name}.json`);
  await download.saveAs(exportPath);
  const exported = JSON.parse(readFileSync(exportPath, "utf8")) as { schemaVersion: string; save: { name: string } };

  expect(exported.schemaVersion).toBe("1");
  expect(exported.save.name).toBe(worldName);

  await page.getByLabel("Import save JSON").setInputFiles(exportPath);
  await expect(page.getByText("Imported")).toBeVisible();
  await expect(page.getByRole("heading", { name: worldName })).toBeVisible();
  await page.getByRole("textbox", { name: "GM intervention" }).fill("让导入后的世界出现第二条线索");
  await page.getByRole("button", { name: "Advance turn" }).click();
  await expect(page.getByText("GM 指令改变了局势")).toBeVisible();
});

test("creates an English save with Chinese UI", async ({ page }, testInfo) => {
  const worldName = `Mist Harbor ${testInfo.project.name}`;

  await page.goto("/");
  await page.getByRole("button", { name: "Enter" }).click();
  await page.getByLabel("UI language").selectOption("zh");
  await expect(page.getByRole("heading", { name: "存档" })).toBeVisible();
  await page.getByLabel("存档语言").selectOption("en");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("textbox", { name: "世界名称" }).fill(worldName);
  await page.getByRole("textbox", { name: "世界前提" }).fill("A port city is choosing who writes its next law.");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("textbox", { name: "角色种子" }).fill("Ada\nBryn\nCora");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByText("草稿已就绪")).toBeVisible();
  await page.getByRole("button", { name: "接受草稿" }).click();
  await expect(page.getByRole("heading", { name: worldName })).toBeVisible();
  await page.getByRole("textbox", { name: "GM 介入" }).fill("Let the harbor council split into two factions");
  await page.getByRole("button", { name: "推进回合" }).click();
  await expect(page.getByRole("button", { name: "接受回合" })).toBeVisible();
  await page.getByRole("button", { name: "接受回合" }).click();
  await expect(page.getByRole("button", { name: "回合已接受" })).toBeVisible();
});
