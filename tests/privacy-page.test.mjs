import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('privacy notice covers outreach and makes opt-out prominent', async () => {
  const page = await readFile(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8');

  assert.match(page, /Oliver Hitchings, sole trader/);
  assert.match(page, /public business sources/);
  assert.match(page, /legitimate interests/);
  assert.match(page, /object to direct marketing at any time/);
  assert.match(page, /hello@oliverhitchings\.com/);
  assert.match(page, /Information Commissioner/);
});

test('site footer links to the privacy notice', async () => {
  const footer = await readFile(new URL('../src/components/Footer.astro', import.meta.url), 'utf8');

  assert.match(footer, /href=["']\/privacy\/["']/);
});
