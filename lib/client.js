// Hand-authored DSH module-loader bundle; no build step or cross-plugin imports.
window.__ModuleLoader__.load({
  id: '@dsh-community/dsh-deeplink',
  factory: (require) => {
    const React = require('react');
    const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'layout'];
    const PACKAGE = '@dsh-community/dsh-deeplink';
    const JUMP_KEY = 'dsh-deeplink.jump';
    const FOLLOW_KEY = 'dsh-deeplink.follow';
    const flagListeners = new Set();

    function readFlag(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : raw !== '0' && raw !== 'false';
      } catch { return fallback; }
    }

    function writeFlag(key, value) {
      try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* storage unavailable */ }
      for (const listener of flagListeners) listener();
    }

    function readTarget() {
      const params = new URLSearchParams(location.search);
      const session = params.get('session');
      if (session) return { kind: 'session', id: session };
      const workspace = params.get('workspace');
      return workspace ? { kind: 'workspace', id: workspace } : null;
    }

    // Catalog membership is not selection. The UI owns the mainView reference;
    // background agents, sidebars, and inspector references must not change links.
    function currentSession(list) {
      return Object.values(list.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)?.id;
    }

    function apply(ctx) {
      const { sessions, workspaces, uiWorkspace, layout } = ctx;
      let target = readFlag(JUMP_KEY, true) ? readTarget() : null;
      let phase = target === null ? 'done' : 'waiting';
      let disposed = false;
      let navigationVersion = 0;

      const syncUrl = () => {
        if (disposed || phase !== 'done' || !readFlag(FOLLOW_KEY, true)) return;
        const list = sessions.list.getSnapshot();
        if (list.phase !== 'ready' || workspaces.list.getSnapshot().phase !== 'ready') return;
        try {
          const url = new URL(location.href);
          url.searchParams.delete('session');
          url.searchParams.delete('workspace');
          url.searchParams.delete('new'); // retired plugin parameter
          const current = currentSession(list);
          if (current !== undefined) url.searchParams.set('session', current);
          const next = url.pathname + url.search + url.hash;
          if (next !== location.pathname + location.search + location.hash) {
            history.replaceState(history.state, '', next);
          }
        } catch { /* unavailable history or same-origin restriction */ }
      };

      const reconcile = () => {
        if (disposed) return;
        if (phase === 'done') { syncUrl(); return; }
        if (phase === 'opening') return;
        const list = sessions.list.getSnapshot();
        const workspaceList = workspaces.list.getSnapshot();
        // Archive facts and the session catalog arrive independently.
        if (list.phase !== 'ready' || workspaceList.phase !== 'ready') return;
        phase = 'opening'; // one attempt, including synchronous reentrant notifications
        const request = ++navigationVersion;
        const finish = () => {
          if (disposed || request !== navigationVersion) return;
          phase = 'done'; syncUrl();
        };
        if (target.kind === 'session') {
          if (list.ids.includes(target.id) && !workspaceList.archivedSessionIds.includes(target.id)) {
            try {
              // Supersede any asynchronous default restoration before selecting.
              layout.beginNavigation();
              uiWorkspace.openSession(target.id);
            } catch (error) { console.warn('[dsh-deeplink] Cannot open session:', error); }
          }
          finish();
          return;
        }
        if (!workspaceList.items.some(item => item.workspaceId === target.id)) {
          finish();
          return;
        }
        // Do not let default restoration overwrite the requested URL while the
        // new/reusable blank is being resolved. The UI handles supersession.
        try {
          Promise.resolve(uiWorkspace.openWorkspace(target.id, () => {
            if (disposed || request !== navigationVersion) throw new Error('Deep-link navigation was disposed or superseded');
          })).catch(error => {
            if (!disposed && request === navigationVersion) console.warn('[dsh-deeplink] Cannot open workspace:', error);
          }).finally(finish);
        } catch (error) {
          console.warn('[dsh-deeplink] Cannot open workspace:', error);
          finish();
        }
      };
      // DSH Markdown only allows absolute URLs and delegates HTTP(S) clicks.
      // Normalize plugin links in the DOM, then intercept before that delegate.
      const localLink = (raw) => {
        try {
          const url = new URL(raw, location.href);
          const current = new URL(location.href);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
          const marker = url.origin === 'https://dsh.invalid' && url.pathname === '/';
          const sameApp = url.origin === current.origin && url.pathname === current.pathname;
          const legacy = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname === '/';
          if (!marker && !sameApp && !legacy) return null;
          const session = url.searchParams.get('session');
          const workspace = url.searchParams.get('workspace');
          const next = session ? { kind: 'session', id: session } : workspace ? { kind: 'workspace', id: workspace } : null;
          if (next === null) return null;
          // Legacy cross-origin links are only local if their target is known.
          if (legacy && !sameApp && !marker) {
            const known = next.kind === 'session'
              ? sessions.list.getSnapshot().ids.includes(next.id)
              : workspaces.list.getSnapshot().items.some(item => item.workspaceId === next.id);
            if (!known) return null;
          }
          current.searchParams.delete('session');
          current.searchParams.delete('workspace');
          current.searchParams.delete('new');
          current.searchParams.set(next.kind, next.id);
          return { target: next, href: current.href };
        } catch { return null; }
      };
      ctx.effect(() => {
        const originals = new Map();
        const normalize = anchor => {
          if (anchor.hasAttribute('download')) return null;
          const link = localLink(anchor.getAttribute('href'));
          if (!link) return null;
          if (!originals.has(anchor)) originals.set(anchor, {
            href: anchor.getAttribute('href'), target: anchor.getAttribute('target'),
          });
          if (anchor.getAttribute('href') !== link.href) anchor.setAttribute('href', link.href);
          if (anchor.getAttribute('target') !== '_self') anchor.setAttribute('target', '_self');
          return link;
        };
        const scan = node => {
          if (node.matches?.('a[href]')) normalize(node);
          node.querySelectorAll?.('a[href]').forEach(normalize);
        };
        const onClick = event => {
          const anchor = event.target?.closest?.('a[href]');
          if (!anchor || !readFlag(JUMP_KEY, true)) return;
          const link = normalize(anchor);
          if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          target = link.target;
          phase = 'waiting';
          reconcile();
        };
        const scanEnabled = node => { if (readFlag(JUMP_KEY, true)) scan(node); };
        scanEnabled(document);
        const observer = new MutationObserver(records => {
          for (const record of records) {
            if (record.type === 'attributes') scanEnabled(record.target);
            else record.addedNodes.forEach(scanEnabled);
          }
          for (const anchor of originals.keys()) if (!anchor.isConnected) originals.delete(anchor);
        });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
        document.addEventListener('click', onClick, true);
        // Baselines may make previously unknown legacy loopback links resolvable.
        const offLinks = sessions.list.subscribe(() => scanEnabled(document));
        const offWorkspaceLinks = workspaces.list.subscribe(() => scanEnabled(document));
        return () => {
          observer.disconnect();
          document.removeEventListener('click', onClick, true);
          offLinks(); offWorkspaceLinks();
          for (const [anchor, original] of originals) {
            anchor.setAttribute('href', original.href);
            if (original.target === null) anchor.removeAttribute('target');
            else anchor.setAttribute('target', original.target);
          }
        };
      }, 'dsh-deeplink: portable Markdown links');

      const onList = reconcile;
      ctx.effect(() => {
        const offSessions = sessions.list.subscribe(onList);
        const offWorkspaces = workspaces.list.subscribe(onList);
        flagListeners.add(syncUrl);
        window.addEventListener('storage', syncUrl);
        onList();
        return () => {
          disposed = true;
          offSessions();
          offWorkspaces();
          flagListeners.delete(syncUrl);
          window.removeEventListener('storage', syncUrl);
        };
      }, 'dsh-deeplink: navigation subscriptions');

      // Current Plugins detail-page API, not the removed settings.plugin.item.
      ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config', key: PACKAGE,
      }, DeeplinkSettings)), 'dsh-deeplink: settings page');

      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.pluginCss = PACKAGE;
        style.textContent = [
          '.dshdl-settings{color:var(--dsw-alias-label-primary);padding:16px}',
          '.dshdl-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0}',
          '.dshdl-text{display:flex;flex-direction:column;gap:4px}',
          '.dshdl-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
          '.dshdl-switch{position:relative;flex:none;width:40px;height:22px;border:0;border-radius:11px;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;padding:0}',
          '.dshdl-switch[aria-checked=true]{background:var(--dsw-alias-state-business-primary)}',
          '.dshdl-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff}',
          '.dshdl-switch[aria-checked=true] .dshdl-knob{left:20px}',
        ].join('\n');
        document.head.appendChild(style);
        return () => style.remove();
      }, 'dsh-deeplink: styles');
    }

    function DeeplinkSettings() {
      const [jump, setJump] = React.useState(() => readFlag(JUMP_KEY, true));
      const [follow, setFollow] = React.useState(() => readFlag(FOLLOW_KEY, true));
      const row = (title, description, checked, toggle) => React.createElement('div', { className: 'dshdl-row' },
        React.createElement('div', { className: 'dshdl-text' }, title,
          React.createElement('span', { className: 'dshdl-desc' }, description)),
        React.createElement('button', {
          type: 'button', role: 'switch', 'aria-label': title, 'aria-checked': checked,
          className: 'dshdl-switch', onClick: toggle,
        }, React.createElement('span', { className: 'dshdl-knob', 'aria-hidden': true })));
      return React.createElement('section', { className: 'dshdl-settings' },
        React.createElement('h3', null, 'Deep links'),
        React.createElement('p', { className: 'dshdl-desc' }, 'Saved immediately in this browser only.'),
        row('Open linked conversation', 'Read ?session= / ?workspace= when the page loads.', jump, () => {
          writeFlag(JUMP_KEY, !jump); setJump(!jump);
        }),
        row('Follow current conversation', 'Keep the address bar ready to copy or bookmark.', follow, () => {
          writeFlag(FOLLOW_KEY, !follow); setFollow(!follow);
        }));
    }

    return { apply, inject };
  },
});
