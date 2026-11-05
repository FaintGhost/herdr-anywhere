// What agents print that the terminal must draw. Claude Code: ⎿ under a tool call, ⏺ ⏵ ⏸, and its working star. Pi 1.4.0:
// its loader's frames (pi-tui dist/components/loader.js). e2e/ios-glyphs.sh fails if any of these is the "missing" box.
export const AGENT_GLYPHS = ['⎿', '⏺', '⏵', '⏸', '❯', '·', '✢', '✳', '✶', '✻', '✽', '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
// Also reported, so a gap in the symbols near them shows before an agent prints one: arrows, technical symbols, Braille, and a few emoji.
export const SCANNED_BLOCKS: [number, number][] = [[0x2190, 0x21ff], [0x2300, 0x23ff], [0x2800, 0x28ff], [0x2705, 0x2705], [0x274c, 0x274c], [0x1f389, 0x1f389], [0x1f680, 0x1f680]]
// Technical symbols that come with the page too, so these do not depend on the phone's fonts either.
export const MORE_GLYPHS: string[] = []
for (const [from, to] of [[0x23b0, 0x23bd], [0x23dc, 0x23e1]]) for (let c = from; c <= to; c++) MORE_GLYPHS.push(String.fromCodePoint(c))
// Emoji stay the phone's own colour font: the probe wants colour, and compares with a plain system font to tell the
// page's fault from a phone that draws no emoji anywhere.
export const EMOJI = ['⏳', '✅', '❌', '🎉', '🚀']
