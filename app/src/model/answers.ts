// What a blocked agent asks, from its status report (`kind`, `msg`). Its choices come off its screen (model/menu.ts);
// a digit picks one. What the keys did, as measured:
//
// Claude Code 2.1.314, measured 2026-10-31 in a scratch herdr-core session (hc 0.1.14):
// - permission (status {kind:'permission', msg:'approve Write: <path>'}): the menu is "1. Yes / 2. Yes, and … / 3. No";
//   key 1 wrote the file at once, Esc and 3 each answered "User rejected write".
// - question (AskUserQuestion, {kind:'question', msg:'answer: Which color do you like? (Red · Blue)'}): key 2 picked
//   the second option at once; key 3 (the option after the listed ones, "Type something.") moved to the text answer,
//   and `terminal.send` with `force` then typed "green" and submitted it.
// - The same version later showed a four-option menu (… 3. auto mode, 4. No, "Esc to cancel"); through the phone
//   app, Approve (1) wrote the file and Deny (Esc) answered "User rejected write".
export type Status = { state?: string; app?: string; kind?: string | null; msg?: string } | null | undefined

/** What a blocked agent asks, as its report says it: "approve Write: …" reads "Write: …". */
export function asks(s: Status): string {
  if (s?.state !== 'blocked') return ''
  return (s.msg ?? '').replace(/^(approve|answer):?\s+/i, '').trim()
}

/** The line that says what an agent is doing or did, in its own words. Claude Code 2.1.318, measured 2026-11-05: working,
 *  its report has no words and its title is its summary of the task ("Sleep and read nsh.json"; at first only
 *  "Claude Code"); done, a few seconds later, the report's msg says what it did. Empty when it says nothing new. */
export function activity(s: Status, title: string, program: string): string {
  const asked = asks(s)
  if (asked) return asked
  const said = (s?.msg ?? '').trim() || title
  return said === program ? '' : said
}
