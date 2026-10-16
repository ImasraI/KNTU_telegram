import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../personal/worker.js';

test('private Worker serves its linked CSS and JS with security headers', async () => {
  const served=[];
  const env={ASSETS:{fetch:async request=>{served.push(new URL(request.url).pathname);return new Response('asset');}}};
  for(const path of ['/','/index.html','/theme.css','/style.css','/app.js']){
    const response=await handleRequest(new Request('https://personal.example'+path),env);
    assert.equal(response.status,200,path);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.match(response.headers.get('Content-Security-Policy'),/default-src 'self'/);
  }
  assert.equal(served.length,5);
  for(const path of ['/schema.sql','/login.js','/security.js','/.dev.vars','/unknown.css']){
    assert.equal((await handleRequest(new Request('https://personal.example'+path),env)).status,404,path);
  }
  assert.equal(served.length,5,'only explicitly public files reach the asset binding');
});

test('personal UI ships the exact main Mini App theme and safe default login form',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.equal(read('personal/public/theme.css'),read('web/app.css'));
  const html=read('personal/public/index.html');
  assert.match(html,/viewport-fit=cover/);assert.match(html,/href="\/theme.css"/);
  assert.match(html,/id="password" type="password"/);
  assert.doesNotMatch(html.match(/<input[^>]*id="remember"[^>]*>/)[0],/checked/);
});
