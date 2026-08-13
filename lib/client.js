// dsh-deeplink browser half — hand-written client bundle (no build step).
// Registers through the DSH module-loader protocol; the loader materializes
// this factory once and calls apply() when the injected services exist.
//
// Deep links (read from the page URL):
//   ?session=<id>    open that conversation in this page.
//   ?workspace=<id>  connect that project in this page.
// The GUI's markdown renderer marks these http links target=_blank, so a
// click opens a fresh tab; this plugin then switches THAT tab to the target.
// session wins when both params are present.
//
// Persistent link: after the deep-link switch settles (or when there is no
// deep-link param at all), the address bar follows the current conversation.
// Every change of the current session rewrites the URL to `?session=<id>`
// (or drops the params when no session is current) via history.replaceState —
// no history pollution, no reload. The `workspace`/`new` params are consumed
// and removed once the target session is known.
window.__ModuleLoader__.load({
  id: '@dsh-community/dsh-deeplink',
  factory: (require) => {
    const inject = ['sessions', 'workspaces'];

    // One-shot deep-link target from the page URL.
    function readTarget() {
      if (typeof location === 'undefined') return null;
      const params = new URLSearchParams(location.search);
      const session = params.get('session');
      if (session !== null && session !== '') return { kind: 'session', id: session };
      const workspace = params.get('workspace');
      if (workspace !== null && workspace !== '') return { kind: 'workspace', id: workspace };
      return null;
    }

    function apply(ctx) {
      const target = readTarget();

      const sessions = ctx.get('sessions');
      const workspaces = ctx.get('workspaces');
      if (sessions === undefined || workspaces === undefined) return;

      // ---- persistent link: address bar follows the current session ----
      // Compare the target URL string, not the session id, so an undefined
      // current (no session) is also detected as a change; the initial null
      // sentinel guarantees the first pass writes once.
      let lastSyncedUrl = null;
      const syncUrl = (currentId) => {
        try {
          const params = new URLSearchParams(location.search);
          params.delete('session');
          params.delete('workspace');
          params.delete('new');
          if (currentId !== undefined) params.set('session', currentId);
          const query = params.toString();
          const next = location.pathname + (query === '' ? '' : `?${query}`);
          if (next === lastSyncedUrl) return;
          lastSyncedUrl = next;
          history.replaceState(null, '', next);
        } catch { /* same-origin only */ }
      };

      // ---- one-shot deep-link switch; URL following starts once settled ----
      let settled = target === null;

      const onSessionList = () => {
        if (settled) {
          syncUrl(sessions.list.getSnapshot().current);
          return;
        }
        if (target.kind !== 'session') return;
        const sessionList = sessions.list.getSnapshot();
        if (sessionList.phase !== 'ready') return;
        if (sessionList.byId[target.id] === undefined) {
          console.warn(`[dsh-deeplink] 会话 '${target.id}' 不在会话列表中，忽略深链参数`);
          settled = true;
          syncUrl(sessions.list.getSnapshot().current);
          return;
        }
        settled = true;
        sessions.open(target.id);
        // open() selects synchronously; sync immediately so the address bar
        // reflects the target without waiting for the next projection.
        syncUrl(sessions.list.getSnapshot().current);
      };

      const onWorkspaceList = () => {
        if (settled || target.kind !== 'workspace') return;
        const workspaceList = workspaces.list.getSnapshot();
        if (workspaceList.phase !== 'ready') return;
        const workspace = workspaceList.items.find(item => item.workspaceId === target.id);
        if (workspace === undefined) {
          console.warn(`[dsh-deeplink] 工程 '${target.id}' 不在工程列表中，忽略深链参数`);
          settled = true;
          syncUrl(sessions.list.getSnapshot().current);
          return;
        }
        settled = true;
        workspaces.connectWorkspace(target.id).then(sessionId => {
          sessions.open(sessionId);
          syncUrl(sessions.list.getSnapshot().current);
        }).catch(err => {
          console.warn('[dsh-deeplink] 连接工程失败:', err);
          syncUrl(sessions.list.getSnapshot().current);
        });
      };

      // Subscriptions live for the whole plugin lifetime: the deep-link switch
      // is one-shot (settled flag), but URL sync keeps following every later
      // current change (manual switches included).
      const offSessions = sessions.list.subscribe(onSessionList);
      const offWorkspaces = workspaces.list.subscribe(onWorkspaceList);
      onSessionList();
      onWorkspaceList();
      ctx.effect(() => () => { offSessions(); offWorkspaces(); }, 'dsh-deeplink: list subscriptions');
    }

    return { apply, inject };
  },
});
