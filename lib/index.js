import z from '@deepseek-ai/schemastery';

/**
 * dsh-deeplink host half: registers the deep-link prompt section so the model
 * knows the Web GUI accepts `?session=` / `?workspace=` deep links and can
 * surface links to other conversations/projects in its replies. It also
 * registers a settings namespace so the browser's 插件配置 tab enumerates this
 * plugin and dispatches its card (settings.plugin.item, key = the namespace).
 * The browser half ships via exports["./client"], discovered through the
 * package.json dsh.client declaration.
 */
export const name = 'dsh-deeplink';

/** Services required before the prompt section can be registered. */
export const inject = ['systemPrompt', 'webServer'];

/** Settings namespace whose card appears in 插件配置. */
const DEEPLINK_SETTINGS_NAMESPACE = 'dsh-deeplink';
/** Schema: the two browser-side toggles surfaced on the card. */
const DEEPLINK_SETTINGS_SCHEMA = z.object({
  jump: z.boolean().default(true),
  follow: z.boolean().default(true),
});

/**
 * The model-visible prompt section text. Static per process (the port is a
 * boot fact), so it does not invalidate the KV cache across turns.
 * @param webUrl - the canonical loopback URL of this Web GUI.
 * @returns the section text telling the model about deep links and how to
 *   discover real session/workspace ids on disk.
 */
export function deeplinkPrompt(webUrl) {
  return `A deep-link plugin is active in this GUI (${webUrl}). You can include links in your reply that jump the user directly to another conversation or project:
- ${webUrl}/?session=<sessionId> — open that conversation (a click opens it in a new browser tab).
- ${webUrl}/?workspace=<workspaceId> — connect that project's latest/blank conversation (same new-tab behavior).
Use these when the user's request refers to another conversation or project (an earlier discussion, a different workspace, a follow-up of another session), so the user can reach it in one click. To discover real ids, read $DSH_HOME/storages/workspace.json (keys of tables.workspaces are workspace ids; each record's sessionIds lists its session ids) or list $DSH_HOME/sessions/<project>/ directories (each directory is one session id). Only link ids that actually exist; never invent one.`;
}

/**
 * Register the deep-link prompt section and the settings namespace.
 * @param ctx - plugin context carrying systemPrompt and webServer.
 */
export function apply(ctx) {
  const webUrl = `http://127.0.0.1:${String(ctx.webServer.port)}`;
  ctx.effect(
    () => ctx.systemPrompt.section({
      name: 'plugin:dsh-deeplink',
      order: -97,
      text: deeplinkPrompt(webUrl),
    }),
    'dsh-deeplink: prompt section',
  );

  // Register only the namespace needed by 插件配置. The browser owns both
  // toggle values in localStorage, so the host has no settings source to track.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(DEEPLINK_SETTINGS_NAMESPACE, DEEPLINK_SETTINGS_SCHEMA);
  });
}
