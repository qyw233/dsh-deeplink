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
// no history pollution, no reload.
//
// Two independent toggles (Settings → 深链):
//   jump   — process ?session= / ?workspace= deep links on load (default on)
//   follow — keep the address bar following the current session (default on)
// Both persist in localStorage; follow is read on every sync so it takes
// effect immediately, jump is read once per page load.
window.__ModuleLoader__.load({
  id: '@dsh-community/dsh-deeplink',
  factory: (require) => {
    const React = require('react');
    const inject = ['slots', 'sessions', 'workspaces'];

    const JUMP_KEY = 'dsh-deeplink.jump';
    const FOLLOW_KEY = 'dsh-deeplink.follow';

    function readFlag(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return raw !== '0' && raw !== 'false';
      } catch { return fallback; }
    }

    function writeFlag(key, value) {
      try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage unavailable */ }
    }

    // Inject the settings-section styles once (the loader removes plugin-owned
    // tags on unload; re-injecting on HMR materialization is guarded).
    if (typeof document !== 'undefined'
      && document.querySelector('style[data-plugin-css="@dsh-community/dsh-deeplink"]') === null) {
      const style = document.createElement('style');
      style.dataset.plugin = '@dsh-community/dsh-deeplink';
      style.dataset.pluginCss = '@dsh-community/dsh-deeplink';
      style.textContent = [
        '.dshdl-settings{display:flex;flex-direction:column;gap:14px;width:100%;color:var(--dsw-alias-label-primary)}',
        '.dshdl-head{display:flex;flex-direction:column;gap:4px}',
        '.dshdl-title{font-size:15px;line-height:22px;font-weight:600}',
        '.dshdl-desc{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
        '.dshdl-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
        '.dshdl-text{display:flex;flex-direction:column;gap:2px;min-width:0}',
        '.dshdl-switch{position:relative;flex:none;width:40px;height:22px;border:0;border-radius:11px;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;padding:0;transition:background .15s ease}',
        '.dshdl-switch.dshdl-on{background:var(--dsw-alias-state-business-primary)}',
        '.dshdl-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s ease}',
        '.dshdl-switch.dshdl-on .dshdl-knob{left:20px}',
      ].join('\n');
      document.head.appendChild(style);
    }

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
      const jumpEnabled = readFlag(JUMP_KEY, true);
      const target = jumpEnabled ? readTarget() : null;

      const sessions = ctx.get('sessions');
      const workspaces = ctx.get('workspaces');
      if (sessions === undefined || workspaces === undefined) return;

      // ---- persistent link: address bar follows the current session ----
      let lastSyncedUrl = null;
      const syncUrl = (currentId) => {
        if (!readFlag(FOLLOW_KEY, true)) return;
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

      const offSessions = sessions.list.subscribe(onSessionList);
      const offWorkspaces = workspaces.list.subscribe(onWorkspaceList);
      onSessionList();
      onWorkspaceList();
      ctx.effect(() => () => { offSessions(); offWorkspaces(); }, 'dsh-deeplink: list subscriptions');

      // ---- Settings section: two independent toggles ----
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'deeplink',
        order: 30,
        label: () => '深链',
      }, DeeplinkSettings));
    }

    // Settings page component. Receives no data via inject (both toggles read
    // localStorage directly); renders two labelled switches.
    function DeeplinkSettings() {
      const [jump, setJump] = React.useState(() => readFlag(JUMP_KEY, true));
      const [follow, setFollow] = React.useState(() => readFlag(FOLLOW_KEY, true));

      const toggleJump = () => {
        const next = !jump;
        setJump(next);
        writeFlag(JUMP_KEY, next);
      };
      const toggleFollow = () => {
        const next = !follow;
        setFollow(next);
        writeFlag(FOLLOW_KEY, next);
      };

      const row = (title, desc, checked, onToggle) =>
        React.createElement('div', { className: 'dshdl-row' },
          React.createElement('div', { className: 'dshdl-text' },
            React.createElement('div', { className: 'dshdl-title' }, title),
            React.createElement('div', { className: 'dshdl-desc' }, desc)),
          React.createElement('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': checked,
            className: 'dshdl-switch' + (checked ? ' dshdl-on' : ''),
            onClick: onToggle,
          }, React.createElement('span', { className: 'dshdl-knob' })));

      return React.createElement('div', { className: 'dshdl-settings' },
        React.createElement('div', { className: 'dshdl-head' },
          React.createElement('div', { className: 'dshdl-title' }, '深链'),
          React.createElement('div', { className: 'dshdl-desc' },
            '控制 URL 参数（?session= / ?workspace=）跳转与地址栏跟随。')),
        row('跳转到指定对话', '读取 ?session= / ?workspace= 参数并打开对应会话或工程（页面加载时生效）', jump, toggleJump),
        row('地址栏跟随', '切换会话时用 replaceState 把地址栏更新为当前会话的链接', follow, toggleFollow));
    }

    return { apply, inject };
  },
});
