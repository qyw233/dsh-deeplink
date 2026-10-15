import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { apply as applyHost, deeplinkPrompt, inject as hostInject } from '../lib/index.js';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));

function store(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { value = next; for (const listener of listeners) listener(); },
    get size() { return listeners.size; },
  };
}

function harness({ url = 'http://localhost:3080/', flags = {}, ready = true, openWorkspace, openSession, storageUnavailable = false } = {}) {
  let module;
  let currentUrl = new URL(url);
  const effects = [];
  const registrations = [];
  const styles = new Set();
  const events = new Map();
  const storage = new Map(Object.entries(flags));
  const warnings = [];
  const calls = [];
  const history = { state: { router: 'preserved' }, calls: [], replaceState(state, _, path) {
    this.calls.push(path); this.state = state; currentUrl = new URL(path, currentUrl);
  } };
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  };
  const window = {
    __ModuleLoader__: { load(definition) { module = definition.factory(name => {
      assert.equal(name, 'react'); return React;
    }); } },
    addEventListener(name, listener) { events.set(name, listener); },
    removeEventListener(name) { events.delete(name); },
  };
  const anchors = [];
  const documentEvents = new Map();
  const document = {
    documentElement: {},
    querySelectorAll: () => anchors,
    addEventListener: (name, listener) => documentEvents.set(name, listener),
    removeEventListener: name => documentEvents.delete(name),
    createElement: () => { const node = { dataset: {}, remove() { styles.delete(node); } }; return node; },
    head: { appendChild(node) { styles.add(node); } },
  };
  const list = store({ phase: ready ? 'ready' : 'pending', ids: ['old', 'target'], byId: {
    old: { id: 'old', retainedBy: { mainView: 1 } },
    target: { id: 'target', retainedBy: {} },
    background: { id: 'background', retainedBy: { sidebar: 1 } },
  } });
  const workspaces = store({ phase: ready ? 'ready' : 'pending', items: [{ workspaceId: 'workspace' }], archivedSessionIds: [] });
  const select = id => list.set({ ...list.getSnapshot(), byId: Object.fromEntries(
    Object.entries(list.getSnapshot().byId).map(([key, row]) => [key, { ...row, retainedBy: key === id ? { mainView: 1 } : {} }])
  ) });
  vm.runInNewContext(source, {
    window, document, history, URL, URLSearchParams,
    MutationObserver: class { observe() {} disconnect() {} },
    get location() { return currentUrl; },
    localStorage: {
      getItem(key) { if (storageUnavailable) throw new Error('blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageUnavailable) throw new Error('blocked'); storage.set(key, value); },
    },
    console: { warn: (...args) => warnings.push(args) },
  });
  const ctx = {
    sessions: { list }, workspaces: { list: workspaces },
    uiWorkspace: {
      openSession(id) { calls.push(['session', id]); if (openSession) openSession(id); else select(id); },
      openWorkspace: (...args) => { calls.push(['workspace', args[0]]); return openWorkspace?.(args[1], select) ?? Promise.resolve(); },
    },
    layout: { beginNavigation() { calls.push(['beginNavigation']); } },
    effect(factory) { const off = factory(); effects.push(off); return off; },
    slots: {
      inject(name, factory) { assert.equal(name, 'plugins.bundle.config'); return factory(); },
      register(options, component) { registrations.push({ options, component }); return () => registrations.pop(); },
    },
  };
  module.apply(ctx);
  const anchor = (href, attributes = {}) => {
    const attrs = new Map(Object.entries({ href, target: '_blank', ...attributes }));
    const node = {
      getAttribute: key => attrs.get(key) ?? null,
      hasAttribute: key => attrs.has(key),
      setAttribute: (key, value) => attrs.set(key, value),
      removeAttribute: key => attrs.delete(key),
      closest: () => node, isConnected: true,
    };
    anchors.push(node);
    return node;
  };
  const click = (node, extra = {}) => {
    const event = { target: node, button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...extra };
    documentEvents.get('click')?.(event);
    return event;
  };
  return { module, list, workspaces, select, storage, warnings, calls, history, styles, events, registrations, anchor, click, documentEvents,
    url: () => currentUrl, dispose: () => { for (const off of effects.reverse()) off?.(); } };
}

test('manifest references current packages, no removed runtime or external dependencies', () => {
  assert(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'));
  assert(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-workspace'));
  assert.equal(manifest.dependencies, undefined);
});

test('host registers portable prompt without server URL and disposes it', () => {
  let section;
  let dispose;
  let removed = false;
  assert.deepEqual(hostInject, ['systemPrompt']);
  applyHost({
    systemPrompt: { section(value) { section = value; return () => { removed = true; }; } },
    effect(factory) { dispose = factory(); },
  });
  assert(section.text.includes('https://dsh.invalid/?session='));
  dispose(); assert(removed);
});

test('prompt never embeds a server origin or private storage instructions', () => {
  const prompt = deeplinkPrompt('https://example.com/proxy/?token=secret#auth');
  assert(prompt.includes('https://dsh.invalid/?workspace=<workspaceId>'));
  assert(!prompt.includes('https://example.com'));
  assert(!prompt.includes('secret'));
  assert(!prompt.includes('storages/workspace.json'));
});

test('session wins over workspace; preserves query/hash and router history state', () => {
  const h = harness({ url: 'http://localhost:3080/proxy/?session=target&workspace=workspace&theme=dark#anchor' });
  assert.deepEqual(h.calls, [['beginNavigation'], ['session', 'target']]);
  assert.equal(h.url().href, 'http://localhost:3080/proxy/?theme=dark&session=target#anchor');
  assert.deepEqual(h.history.state, { router: 'preserved' });
  h.dispose();
});

test('waits for both baselines, processes target once', () => {
  const h = harness({ url: 'http://localhost:3080/?session=target', ready: false });
  assert.equal(h.history.calls.length, 0);
  h.list.set({ ...h.list.getSnapshot(), phase: 'ready' });
  assert.equal(h.calls.length, 0);
  h.workspaces.set({ ...h.workspaces.getSnapshot(), phase: 'ready' });
  h.list.set({ ...h.list.getSnapshot() });
  assert.equal(h.calls.filter(([kind]) => kind === 'session').length, 1);
  h.dispose();
});

for (const id of ['missing', 'background', 'target']) test('unlisted or archived target falls back: ' + id, () => {
  const h = harness({ url: 'http://localhost:3080/?session=' + id, ready: false });
  h.workspaces.set({ ...h.workspaces.getSnapshot(), phase: 'ready', archivedSessionIds: ['target'] });
  h.list.set({ ...h.list.getSnapshot(), phase: 'ready' });
  assert.equal(h.calls.length, 0);
  assert.equal(h.url().searchParams.get('session'), 'old');
  h.dispose();
});

test('follow uses only mainView, not background retention, and clears absent selection', () => {
  const h = harness();
  assert.equal(h.url().searchParams.get('session'), 'old');
  h.select('target'); assert.equal(h.url().searchParams.get('session'), 'target');
  const count = h.history.calls.length;
  h.list.set({ ...h.list.getSnapshot() }); assert.equal(h.history.calls.length, count);
  h.select(undefined); assert.equal(h.url().search, '');
  h.dispose();
});

test('workspace navigation waits without clobbering link or connecting twice', async () => {
  let resolve;
  let complete;
  const h = harness({ url: 'http://localhost:3080/?workspace=workspace', openWorkspace(beforeOpen, select) {
    complete = () => { beforeOpen('target'); select('target'); resolve(); };
    return new Promise(r => { resolve = r; });
  } });
  h.select('old');
  h.workspaces.set({ ...h.workspaces.getSnapshot() });
  assert.equal(h.url().search, '?workspace=workspace');
  assert.deepEqual(h.calls, [['workspace', 'workspace']]);
  complete(); await tick();
  assert.equal(h.url().search, '?session=target');
  h.dispose();
});

test('workspace failure is handled and falls back', async () => {
  const h = harness({ url: 'http://localhost:3080/?workspace=workspace', openWorkspace: () => Promise.reject(new Error('offline')) });
  await tick();
  assert.equal(h.warnings.length, 1);
  assert.equal(h.url().search, '?session=old');
  h.dispose();
});

test('unknown workspace leaves navigation unchanged', () => {
  const h = harness({ url: 'http://localhost:3080/?workspace=missing' });
  assert.equal(h.calls.length, 0);
  assert.equal(h.url().search, '?session=old');
  h.dispose();
});

test('jump and follow flags remain independent', () => {
  const h = harness({ url: 'http://localhost:3080/?session=target', flags: { 'dsh-deeplink.jump': 'false', 'dsh-deeplink.follow': '0' } });
  assert.equal(h.calls.length, 0);
  h.select('old'); assert.equal(h.history.calls.length, 0);
  h.dispose();
  const h2 = harness({ url: 'http://localhost:3080/?session=target', flags: { 'dsh-deeplink.follow': '0' } });
  assert.equal(h2.calls[1][1], 'target');
  assert.equal(h2.history.calls.length, 0);
  h2.dispose();
});

test('bundle settings use owned styles and accessible toggles; follow toggles immediately', () => {
  const h = harness({ flags: { 'dsh-deeplink.follow': '0' } });
  const { options, component } = h.registrations[0];
  assert.equal(options.name, 'plugins.bundle.config');
  assert.equal(options.key, manifest.name);
  const tree = component();
  const follow = tree.children[3].children[1];
  assert.equal(follow.props['aria-label'], 'Follow current conversation');
  follow.props.onClick();
  assert.equal(h.storage.get('dsh-deeplink.follow'), '1');
  assert.equal(h.url().search, '?session=old');
  assert.equal(h.styles.size, 1);
  h.dispose();
  assert.equal(h.styles.size, 0);
  assert.equal(h.registrations.length, 0);
  assert.equal(h.list.size, 0);
  assert.equal(h.workspaces.size, 0);
  assert.equal(h.events.size, 0);
});

test('synchronous navigation errors do not escape or leave the URL stuck', async () => {
  const h = harness({ url: 'http://localhost:3080/?session=target', openSession() { throw new Error('unavailable'); } });
  assert.equal(h.warnings.length, 1);
  assert.equal(h.url().search, '?session=old');
  h.dispose();
  const h2 = harness({ url: 'http://localhost:3080/?workspace=workspace', openWorkspace() { throw new Error('unavailable'); } });
  assert.equal(h2.warnings.length, 1);
  assert.equal(h2.url().search, '?session=old');
  h2.dispose();
});

test('empty session parameter permits workspace target', async () => {
  const h = harness({ url: 'http://localhost:3080/?session=&workspace=workspace' });
  assert.deepEqual(h.calls, [['workspace', 'workspace']]);
  await tick(); h.dispose();
});

test('storage changes from another tab enable following immediately', () => {
  const h = harness({ flags: { 'dsh-deeplink.follow': '0' } });
  h.select('target'); assert.equal(h.history.calls.length, 0);
  h.storage.set('dsh-deeplink.follow', '1');
  h.events.get('storage')();
  assert.equal(h.url().search, '?session=target');
  h.dispose();
});

test('unavailable localStorage falls back to defaults without crashing', () => {
  const h = harness({ url: 'http://localhost:3080/?session=target', storageUnavailable: true });
  assert.equal(h.url().search, '?session=target');
  const tree = h.registrations[0].component();
  assert.doesNotThrow(() => tree.children[3].children[1].props.onClick());
  h.dispose();
});

for (const origin of ['http://localhost:3081/', 'https://dsh.wads.dev/', 'https://example.com/proxy/dsh/']) {
  test('portable Markdown link stays on current browser URL: ' + origin, () => {
    const h = harness({ url: origin + '?theme=dark#anchor' });
    const a = h.anchor('https://dsh.invalid/?session=target');
    const event = h.click(a);
    assert(event.defaultPrevented); assert(event.stopped);
    assert.equal(a.getAttribute('target'), '_self');
    const resolved = new URL(a.getAttribute('href'));
    assert.equal(resolved.origin, new URL(origin).origin);
    assert.equal(resolved.pathname, new URL(origin).pathname);
    assert.equal(resolved.searchParams.get('session'), 'target');
    assert.equal(resolved.searchParams.get('theme'), 'dark');
    assert.equal(resolved.hash, '#anchor');
    assert.equal(h.url().origin, new URL(origin).origin);
    assert.equal(h.url().searchParams.get('session'), 'target');
    h.dispose();
    assert.equal(a.getAttribute('href'), 'https://dsh.invalid/?session=target');
    assert.equal(a.getAttribute('target'), '_blank');
    assert.equal(h.documentEvents.size, 0);
  });
}

test('legacy loopback links for known targets stay on current HTTPS instance', () => {
  const h = harness({ url: 'https://dsh.wads.dev/' });
  const event = h.click(h.anchor('http://127.0.0.1:3080/?session=target'));
  assert(event.defaultPrevented);
  assert.equal(h.url().href, 'https://dsh.wads.dev/?session=target');
  h.dispose();
});

test('unrelated or unsafe links, downloads and unknown cross-instance targets are not intercepted', () => {
  const h = harness({ url: 'https://dsh.wads.dev/' });
  for (const href of ['https://other-dsh.example/?session=target', 'http://localhost:3080/?session=unknown', 'https://dsh.invalid.evil/?session=target', 'javascript:alert(1)', 'https://dsh.invalid/path?session=target']) {
    const a = h.anchor(href);
    assert.equal(h.click(a).defaultPrevented, false);
    assert.equal(a.getAttribute('href'), href);
  }
  assert.equal(h.click(h.anchor('https://dsh.invalid/?session=target', { download: '' })).defaultPrevented, false);
  h.dispose();
});

test('modified and middle clicks retain native tab behavior with resolved local URL', () => {
  const h = harness({ url: 'https://dsh.wads.dev/' });
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
    const a = h.anchor('https://dsh.invalid/?session=target');
    assert.equal(h.click(a, modifier).defaultPrevented, false);
    assert.equal(a.getAttribute('href'), 'https://dsh.wads.dev/?session=target');
  }
  assert.equal(h.calls.length, 0);
  h.dispose();
});

test('workspace marker opens through UI and jump off does not intercept links', async () => {
  const h = harness();
  assert(h.click(h.anchor('https://dsh.invalid/?workspace=workspace')).defaultPrevented);
  assert.deepEqual(h.calls, [['workspace', 'workspace']]);
  await tick(); h.dispose();
  const h2 = harness({ flags: { 'dsh-deeplink.jump': '0' } });
  assert.equal(h2.click(h2.anchor('https://dsh.invalid/?session=target')).defaultPrevented, false);
  h2.dispose();
});

test('a stale workspace request cannot settle or overwrite a later Markdown navigation', async () => {
  const pending = [];
  const h = harness({ openWorkspace(beforeOpen) { return new Promise(resolve => pending.push({ beforeOpen, resolve })); } });
  h.click(h.anchor('https://dsh.invalid/?workspace=workspace'));
  h.click(h.anchor('https://dsh.invalid/?session=target'));
  assert.throws(() => pending[0].beforeOpen('old'), /superseded/);
  pending[0].resolve(); await tick();
  assert.equal(h.url().searchParams.get('session'), 'target');
  h.dispose();
});

test('same-origin query link is intercepted and encoded IDs are decoded once', () => {
  const h = harness({ url: 'https://dsh.wads.dev/' });
  const list = h.list.getSnapshot();
  const id = 'session /+ç';
  h.list.set({ ...list, ids: [...list.ids, id], byId: { ...list.byId, [id]: { id, retainedBy: {} } } });
  const event = h.click(h.anchor('?session=' + encodeURIComponent(id)));
  assert(event.defaultPrevented);
  assert.equal(h.url().searchParams.get('session'), id);
  h.dispose();
});

test('unload during workspace connection blocks a late open and URL writes', async () => {
  let before;
  let resolve;
  const h = harness({ url: 'http://localhost:3080/?workspace=workspace', openWorkspace(beforeOpen) {
    before = beforeOpen; return new Promise(r => { resolve = r; });
  } });
  h.dispose();
  assert.throws(() => before('target'), /disposed/);
  resolve(); await tick();
  assert.equal(h.history.calls.length, 0);
});
