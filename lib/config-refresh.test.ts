import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchUpdates } from './gemini-polling.ts';
import { createConfigRefresh } from './config-refresh.ts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const surface = () => ({ win: new EventTarget(), doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }) });

test('config polling retries after the browser reconnects and removes the listener on cleanup', async () => {
  const { win, doc } = surface();
  let calls = 0;
  let available = false;
  const refresh = createConfigRefresh('/api/media/config', isConfig, value => { available = value.available; }, (async () => {
    if (++calls === 1) throw new TypeError('Network interrupted');
    return Response.json({ available: true });
  }) as typeof fetch);
  const stop = watchUpdates(refresh, win, doc, 60_000);
  try {
    await flush();
    assert.equal(calls, 1);
    assert.equal(available, false);
    win.dispatchEvent(new Event('online'));
    await flush();
    assert.equal(available, true);
    assert.equal(calls, 2);
    stop();
    win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('focus'));
    await flush();
    assert.equal(calls, 2);
  } finally { stop(); }
});

type Config = { available: boolean };
const isConfig = (value: unknown): value is Config => !!value && typeof value === 'object'
  && 'available' in value && typeof value.available === 'boolean';

test('failed, malformed and interrupted reads retain known configuration; valid updates still apply', async () => {
  let current: Config | undefined;
  const replies = [
    Response.json({ available: true }),
    new Response('Unavailable', { status: 503 }),
    new Response('<html>Filtered response</html>'),
    Response.json({ unrelated: true }),
    new TypeError('Network interrupted'),
    Response.json({ available: false }),
  ];
  const refresh = createConfigRefresh('/api/media/config', isConfig, value => { current = value; }, (async () => {
    const response = replies.shift();
    if (response instanceof Error) throw response;
    return response!;
  }) as typeof fetch);
  await refresh();
  const known = current;
  assert.deepEqual(known, { available: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    await refresh();
    assert.equal(current, known);
  }
  await refresh();
  assert.deepEqual(current, { available: false });
});

test('concurrent configuration refreshes share one request', async () => {
  let calls = 0;
  let release!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { release = resolve; });
  const applied: Config[] = [];
  const refresh = createConfigRefresh('/api/media/config', isConfig, value => { applied.push(value); }, (async () => {
    calls++;
    return response;
  }) as typeof fetch);
  const first = refresh();
  const second = refresh();
  assert.equal(first, second);
  await flush();
  assert.equal(calls, 1);
  release(Response.json({ available: true }));
  await Promise.all([first, second]);
  assert.deepEqual(applied, [{ available: true }]);
});

test('a synchronous fetch failure does not permanently cache a settled request', async () => {
  let calls = 0;
  let current: Config | undefined;
  const refresh = createConfigRefresh('/api/media/config', isConfig, value => { current = value; }, (() => {
    if (++calls === 1) throw new TypeError('Fetch interrupted synchronously');
    return Promise.resolve(Response.json({ available: true }));
  }) as typeof fetch);
  await refresh();
  assert.equal(current, undefined);
  await refresh();
  assert.equal(calls, 2);
  assert.deepEqual(current, { available: true });
});

test('configuration reads work without AbortSignal.timeout support', async t => {
  t.mock.method(AbortSignal, 'timeout', () => { throw new TypeError('AbortSignal.timeout is unavailable'); });
  let current: Config | undefined;
  const refresh = createConfigRefresh('/api/media/config', isConfig, value => { current = value; }, (async (_url, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ available: true });
  }) as typeof fetch);
  await refresh();
  assert.deepEqual(current, { available: true });
});

test('focus and reconnect during a read coalesce into one follow-up without overlaps', async () => {
  const { win, doc } = surface();
  let calls = 0;
  let release!: () => void;
  const first = new Promise<void>(resolve => { release = resolve; });
  const stop = watchUpdates(async () => { if (++calls === 1) await first; }, win, doc, 60_000);
  try {
    win.dispatchEvent(new Event('focus'));
    win.dispatchEvent(new Event('online'));
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(calls, 1);
    release();
    await flush();
    assert.equal(calls, 2);
  } finally { stop(); }
});
