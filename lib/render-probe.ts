export function renderProbeScript(): string {
  return `(() => {
  const result = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    vivaldi: { available: false },
  };

  try {
    if (typeof vivaldi !== "undefined" && vivaldi) {
      result.vivaldi.available = true;
      result.vivaldi.keys = Object.keys(vivaldi).sort();
      result.vivaldi.namespaces = {};

      const candidates = [
        "workspaces",
        "workspacesPrivate",
        "tabsPrivate",
        "bookmarksPrivate",
        "sessionsPrivate",
      ];

      for (const ns of candidates) {
        const obj = vivaldi[ns];
        if (!obj) continue;
        const members = {};
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (typeof v === "function") {
            try {
              members[k] = v.toString().slice(0, 200);
            } catch (e) {
              members[k] = "<function (toString failed)>";
            }
          } else {
            members[k] = typeof v;
          }
        }
        result.vivaldi.namespaces[ns] = members;
      }

      result.workspacesProbe = {};
      const readAttempts = [
        ["vivaldi.workspaces.getAll", () =>
          vivaldi.workspaces && vivaldi.workspaces.getAll && vivaldi.workspaces.getAll()],
        ["vivaldi.workspacesPrivate.getAll", () =>
          vivaldi.workspacesPrivate && vivaldi.workspacesPrivate.getAll && vivaldi.workspacesPrivate.getAll()],
      ];

      const pending = [];

      for (const [name, fn] of readAttempts) {
        try {
          const r = fn();
          if (r && typeof r.then === "function") {
            result.workspacesProbe[name] = { ok: true, async: true, pending: true };
            pending.push(
              r.then(
                (value) => {
                  result.workspacesProbe[name] = { ok: true, async: true, result: value };
                },
                (err) => {
                  result.workspacesProbe[name] = { ok: false, async: true, error: String(err) };
                }
              )
            );
          } else {
            result.workspacesProbe[name] = { ok: true, async: false, result: r };
          }
        } catch (e) {
          result.workspacesProbe[name] = { ok: false, error: String(e) };
        }
      }

      // Wait for all async probes to settle before logging the final JSON,
      // so the user can copy-paste a complete blob without stale pending entries.
      Promise.allSettled(pending).then(() => {
        console.log(JSON.stringify(result, null, 2));
      });
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (e) {
    result.error = String(e);
    console.log(JSON.stringify(result, null, 2));
  }

  return result;
})();
`;
}
