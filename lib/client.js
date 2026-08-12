// dsh-deeplink browser half — hand-written client bundle (no build step).
// Registers through the DSH module-loader protocol; the loader materializes
// this factory once and calls apply() when the injected services exist.
//
// Deep links (read from the page URL, never rewritten):
//   ?session=<id>    open that conversation in this page.
//   ?workspace=<id>  connect that project in this page.
// The GUI's markdown renderer marks these http links target=_blank, so a
// click opens a fresh tab; this plugin then switches THAT tab to the target.
// session wins when both params are present.
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
      if (target === null) return;

      const sessions = ctx.get('sessions');
      const workspaces = ctx.get('workspaces');
      if (sessions === undefined || workspaces === undefined) return;

      let sessionOff = () => {};
      let workspaceOff = () => {};
      let settled = false;
      const settle = () => {
        settled = true;
        sessionOff();
        workspaceOff();
      };

      // Reconsider on every list projection; act once the baseline that can
      // answer the target is ready. Unknown ids fall back to the default
      // startup selection with a warning instead of failing loud.
      const consider = () => {
        if (settled) return;
        if (target.kind === 'session') {
          const sessionList = sessions.list.getSnapshot();
          if (sessionList.phase !== 'ready') return;
          if (sessionList.byId[target.id] === undefined) {
            console.warn(`[dsh-deeplink] 会话 '${target.id}' 不在会话列表中，忽略深链参数`);
            settle();
            return;
          }
          settle();
          sessions.open(target.id);
          return;
        }
        const workspaceList = workspaces.list.getSnapshot();
        if (workspaceList.phase !== 'ready') return;
        const workspace = workspaceList.items.find(item => item.workspaceId === target.id);
        if (workspace === undefined) {
          console.warn(`[dsh-deeplink] 工程 '${target.id}' 不在工程列表中，忽略深链参数`);
          settle();
          return;
        }
        settle();
        workspaces.connectWorkspace(target.id).then(sessionId => {
          sessions.open(sessionId);
        }).catch(err => {
          console.warn('[dsh-deeplink] 连接工程失败:', err);
        });
      };

      sessionOff = sessions.list.subscribe(consider);
      workspaceOff = workspaces.list.subscribe(consider);
      consider();
      ctx.effect(() => () => { sessionOff(); workspaceOff(); }, 'dsh-deeplink: list subscriptions');
    }

    return { apply, inject };
  },
});
