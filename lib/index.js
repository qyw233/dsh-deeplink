/** Host half: portable Markdown links resolved by the browser plugin. */
export const name = 'dsh-deeplink';
export const inject = ['systemPrompt'];

/** The reserved .invalid origin is a marker, never a network destination. */
export function deeplinkPrompt() {
  return `A deep-link plugin is active in this GUI. For in-GUI Markdown links use this portable format:
- [Open conversation](https://dsh.invalid/?session=<sessionId>) — open that conversation.
- [Open workspace](https://dsh.invalid/?workspace=<workspaceId>) — open a new or reusable blank conversation in that workspace.
The browser plugin resolves the reserved https://dsh.invalid/ marker to the CURRENT browser origin, port and application path, and opens it in the SAME tab by default. Do not substitute localhost, 127.0.0.1, a server-advertised URL, or a guessed public hostname. Bare relative query links are not supported by the current Markdown renderer. The marker requires this plugin; it is not a public/shareable URL. For a shareable link, use the address bar after navigation. Ctrl/Cmd/Shift-click and the context menu can open the resolved local link in another tab/window.
Use these when the user's request refers to another conversation or workspace.
Find conversations and supporting context through the indexed session tools when available, respecting their declared access scope:
- session_search({ query: "distinctive literal phrase" }) searches prior sessions in the caller workspace and returns the strongest matching event per session. It is literal full-text search, not semantic search; use short distinctive phrases and refine with supported filters. It does not search the current conversation. No matches do not prove that a conversation does not exist or that other workspaces were searched.
- session_event_search({ query: "distinctive literal phrase" }) searches earlier events in the current conversation when session_id is omitted. Supply a discovered session_id to search within that authorized session; event_types and sequence/time filters can narrow results.
- Follow a useful hit with session_event_read({ session_id, seq }) for the exact, unabridged event instead of treating a snippet as the full context. For a current-session hit, session_id may be omitted.
- session_trace({ session_id }) shows ancestors and descendants, not the conversation transcript. Omit session_id to identify and trace this conversation. Use session_event_trace({ session_id, seq }) when replacements, source relationships, or supersession matter; a search hit can refer to a shadowed historical event.
Use workspace-listing tools when available for workspace ids. Only call tools actually exposed in this session; if the needed search/listing capability is unavailable or returns no useful match, state the limitation or ask the user for the id instead of scanning private storage files. Use only ids actually returned by tools or explicitly provided by the user; never invent an id or assume a private on-disk storage layout. URL-encode ids in query parameters. Links do not grant access: the destination browser still needs permission to access this DSH instance.`;
}

/** No server URL is needed: only the browser knows its current access URL. */
export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'plugin:dsh-deeplink',
    order: -97,
    text: deeplinkPrompt(),
  }), 'dsh-deeplink: prompt section');
}
