import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('personal button works in Telegram isolate without URL global', () => {
  const source = readFileSync(new URL('../tgcloud/lib/personal-bot.js', import.meta.url),'utf8').replace(/^import .*;$/mg,'').replace('export function','function');
  for (const appUrl of ['https://kntu-personal-vc.arsamalaei90.workers.dev/', '', 'https://user:password@example.com/', 'https://example.com/?token=x', 'http://example.com/', 'https://example.com/#x']) {
    const result = runInNewContext(source + '\npersonalCommand({text:"/personal",chat:{id:1,type:"private"},from:{id:1}},appUrl)', {appUrl});
    assert.equal(!!result.reply_markup, appUrl === 'https://kntu-personal-vc.arsamalaei90.workers.dev/');
  }
});
