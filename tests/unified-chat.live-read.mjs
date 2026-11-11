// Read-only production smoke check. Uses the existing code without printing it.
// Does not create conversations, media, archive records, or jobs.
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const base='https://helper-zeta-eight.vercel.app';
const login=await fetch(base+'/api/login',{method:'POST',body:new URLSearchParams({code:process.env.ACCESS_CODE??''}),redirect:'manual'});
assert.equal(login.status,303);
assert.equal(new URL(login.headers.get('location')).pathname,'/');
const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
assert.ok(cookie);
const headers={cookie};
const page=await fetch(base+'/',{headers});assert.equal(page.status,200);
const html=await page.text();
assert.ok(html.includes('מה ליצור'));
assert.ok(!html.includes('href="/gemini"'));
const old=await fetch(base+'/gemini',{headers,redirect:'manual'});
assert.equal(old.status,307);assert.equal(new URL(old.headers.get('location'),base).pathname,'/');
const config=await fetch(base+'/api/gemini/config',{headers});assert.equal(config.status,200);
const cfg=await config.json();assert.equal(cfg.available,true);
assert.deepEqual(cfg.models.map(m=>m.key).sort(),['account-image','account-video']);
const unauthorized=await fetch(base+'/api/gemini/config');assert.equal(unauthorized.status,401);
console.log(JSON.stringify({site:base,login:'same existing code',unifiedPage:'ok',oldLinkRedirect:'ok',accountMediaReady:cfg.available,models:cfg.models.map(m=>m.key),anonymousAccess:'blocked',newGenerations:0}));
