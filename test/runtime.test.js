import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import * as plugin from '../lib/index.js';

// Opt-in: no installation changes, sockets, profiles, or user data are touched.
const root = process.env.DSH_INSTALL_ROOT;
test('installed DSH: real Cordis lifecycle, prompt assembly, slot contract and package graph', { skip: !root && 'Set DSH_INSTALL_ROOT to the installed @deepseek-ai/dsh directory' }, async () => {
  const require = createRequire(resolve(root, 'package.json'));
  const load = async name => import(require.resolve(name));
  const { Context } = await load('@deepseek-ai/cordis');
  const { SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt');
  const { SlotCore } = await load('@deepseek-ai/dsh-client-ui-slots');
  const manifest = require(resolve('package.json'));
  for (const name of manifest.dsh.client.inject) assert(require.resolve(name + '/client'));
  const ctx = new Context();
  const promptFiber = await ctx.plugin(SystemPrompt, {});
  const fiber = await ctx.plugin(plugin);
  const assembled = await ctx.systemPrompt.assemble();
  const section = assembled.sections.find(section => section.name === 'plugin:dsh-deeplink');
  assert(section.text.includes('https://dsh.invalid/?session='));
  await fiber.dispose();
  assert(!(await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'plugin:dsh-deeplink'));
  await promptFiber.dispose();

  const core = new SlotCore();
  const offRoot = core.register({ name: 'root', children: {
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
  } }, () => null);
  const offPage = core.register({ name: 'plugins.bundle.config', key: manifest.name }, () => null);
  assert.equal(core.entriesOfSlot('plugins.bundle.config').length, 1);
  offPage();
  assert.equal(core.entriesOfSlot('plugins.bundle.config').length, 0);
  offRoot();
});
