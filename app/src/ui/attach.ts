// How paths go in the composer. The files themselves: link.ts fileApi.

/** A path as one word in what is sent to an agent. */
export const asWord = (path: string) => (/\s/.test(path) ? `'${path.replace(/'/g, "'\\''")}'` : path)

/** The composer's text with a path added after it, ready for more words. */
export const withPath = (text: string, path: string) => [text.trim(), asWord(path)].filter(Boolean).join(' ') + ' '
