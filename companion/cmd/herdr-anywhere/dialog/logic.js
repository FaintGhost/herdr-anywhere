// What the Add phone dialog decides, without drawing anything: tested by logic.test.mjs.

function json(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// A finished `pair --json` as what the dialog shows.
export function parsePair({ code, stdout, stderr }) {
  const reply = json(stdout);
  if (reply?.error === "not-running") return { kind: "not-running" };
  if (reply?.error) return { kind: "error", message: reply.error };
  if (code === 0 && Array.isArray(reply?.qr) && reply.expires) {
    return { kind: "code", expires: Date.parse(reply.expires), rows: reply.qr };
  }
  return { kind: "error", message: stderr?.trim() || "herdr-anywhere gave an answer the dialog cannot read." };
}

// null when the list could not be read: that is not the same as no phones.
export function parseDevices({ code, stdout }) {
  if (code !== 0) return null;
  const list = json(stdout);
  return Array.isArray(list) ? list : null;
}

// One row of the code as [dark, length] runs, so a row takes as few divs as it can.
export function runs(row) {
  const out = [];
  for (const c of row) {
    const dark = c === "1";
    const last = out[out.length - 1];
    if (last && last[0] === dark) last[1] += 1;
    else out.push([dark, 1]);
  }
  return out;
}

export function addedSince(before, after) {
  if (!before) return [];
  const known = new Set(before.map((d) => d.id));
  return after.filter((d) => !known.has(d.id));
}

export function remaining(expires, now) {
  const seconds = Math.max(0, Math.round((expires - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ago(lastSeen, now) {
  if (!lastSeen) return "Never connected";
  const minutes = Math.floor((now - Date.parse(lastSeen)) / 60000);
  if (minutes < 1) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  return `Last seen ${Math.floor(hours / 24)}d ago`;
}
