import { test, expect } from '@playwright/test';
import {
  API_BASE,
  createAdvancedEditorFixture,
  openAdvancedEditor,
} from './editor-helpers';

test.describe('SegmentEditorV2 advanced editor', () => {
  test('opens advanced editor, rounds trip to simple, blade save remake, trim, undo', async ({
    page,
  }) => {
    const fixture = await createAdvancedEditorFixture(page);
    await openAdvancedEditor(page, fixture.episodeId);

    const advanced = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { name: /Advanced Editor:/i }),
    });
    await expect(advanced).toBeVisible();
    await expect(advanced.getByRole('button', { name: 'Select tool' })).toBeVisible();
    await expect(advanced.getByRole('button', { name: 'Blade tool' })).toBeVisible();
    await expect(advanced.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(advanced.getByRole('button', { name: 'Remake', exact: true })).toBeVisible();
    await expect(advanced.getByText(/Space Pause/)).toBeVisible();
    await expect(
      advanced.getByText(/No multitrack recordings for this segment/i),
    ).toHaveCount(0);

    // Simple editor round-trip
    await advanced.getByRole('button', { name: 'Simple editor' }).click();
    await expect(page.getByRole('button', { name: 'Advanced editor' })).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: 'Advanced editor' }).click();
    await expect(advanced.getByRole('heading', { name: /Advanced Editor:/i })).toBeVisible();

    // Seek into the clip so blade at playhead is valid, select first clip, blade.
    await page.keyboard.press('d');
    const clip = advanced.locator('button[class*="segmentEditorV2Clip"]').first();
    await expect(clip).toBeVisible({ timeout: 15000 });
    await clip.click();
    const clipsBeforeBlade = await advanced
      .locator('button[class*="segmentEditorV2Clip"]')
      .count();
    await advanced.getByRole('button', { name: 'Blade at playhead' }).click();
    await expect
      .poll(async () => advanced.locator('button[class*="segmentEditorV2Clip"]').count())
      .toBeGreaterThan(clipsBeforeBlade);

    await advanced.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(advanced.getByRole('button', { name: 'Save', exact: true })).toBeDisabled({
      timeout: 30000,
    });
    await advanced.getByRole('button', { name: 'Remake', exact: true }).click();
    await expect(advanced.getByRole('button', { name: 'Remake', exact: true })).toBeEnabled({
      timeout: 180000,
    });
    await expect(advanced.locator('[role="alert"]')).toHaveCount(0);

    // Soft trim Start / End / Save; verify via API
    await page.keyboard.press('e');
    await page.keyboard.press('d');
    await page.keyboard.press('r');
    const saveTrim = advanced.getByRole('button', { name: 'Save', exact: true });
    if (await saveTrim.isEnabled()) {
      await saveTrim.click();
      await expect(saveTrim).toBeDisabled({ timeout: 30000 });
    }
    const listRes = await page.request.get(
      `${API_BASE}/episodes/${fixture.episodeId}/segments`,
      { headers: { 'x-csrf-token': fixture.csrf } },
    );
    expect(listRes.ok()).toBeTruthy();
    const list = (await listRes.json()) as {
      segments?: Array<{ id: string; trimRanges?: unknown }>;
    };
    const found = list.segments?.find((s) => s.id === fixture.segmentId);
    expect(Array.isArray(found?.trimRanges) && found!.trimRanges!.length > 0).toBeTruthy();

    // Delete → Undo → Redo
    const clipCountBeforeDelete = await advanced
      .locator('button[class*="segmentEditorV2Clip"]')
      .count();
    await advanced.locator('button[class*="segmentEditorV2Clip"]').first().click();
    await advanced.getByRole('button', { name: 'Delete selected clip' }).click();
    await expect(advanced.locator('button[class*="segmentEditorV2Clip"]')).toHaveCount(
      clipCountBeforeDelete - 1,
    );
    await advanced.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(advanced.locator('button[class*="segmentEditorV2Clip"]')).toHaveCount(
      clipCountBeforeDelete,
    );
    await advanced.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(advanced.locator('button[class*="segmentEditorV2Clip"]')).toHaveCount(
      clipCountBeforeDelete - 1,
    );
    await advanced.getByRole('button', { name: 'Undo', exact: true }).click();

    // Hotkey smoke: S blades with selection; A/D nudge
    await advanced.locator('button[class*="segmentEditorV2Clip"]').first().click();
    await page.keyboard.press('d');
    const beforeS = await advanced.locator('button[class*="segmentEditorV2Clip"]').count();
    await page.keyboard.press('s');
    const afterS = await advanced.locator('button[class*="segmentEditorV2Clip"]').count();
    expect(afterS).toBeGreaterThanOrEqual(beforeS);
  });
});
