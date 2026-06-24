// Arc stores per-Space accent colors deep inside `customInfo.windowTheme`.
// The components are extendedSRGB floats nominally in [0,1], but the wide-gamut
// source occasionally pushes a channel slightly out of range (negative or >1).
// We clamp before quantizing to an 8-bit sRGB hex string.
//
// The structure is enum-encoded by Arc's Swift model: the `_0` keys are
// associated-value tags. Two background shapes occur in the wild — a two-stop
// `blendedGradient` and a single `blendedSingleColor` — plus a flat
// `primaryColorPalette` we use as a last resort.

export interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number): string =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function asColor(v: unknown): RGB | undefined {
  if (!isRecord(v)) return undefined;
  const r = v["red"];
  const g = v["green"];
  const b = v["blue"];
  if (typeof r === "number" && typeof g === "number" && typeof b === "number") {
    return { r, g, b };
  }
  return undefined;
}

// Safe nested lookup; returns undefined if any link in the chain is absent or
// not an object.
function dig(root: unknown, ...keys: readonly string[]): unknown {
  let cur: unknown = root;
  for (const k of keys) {
    if (!isRecord(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Extract 0, 1, or 2 sRGB hex accent stops from an Arc Space's `customInfo`.
 * Order of preference: two-stop gradient -> single background color ->
 * primaryColorPalette (midTone, then shaded). Returns `[]` when no theme is
 * present, leaving the caller to pick a deterministic fallback.
 */
export function extractAccentStops(customInfo: unknown): string[] {
  const colorNode = dig(
    customInfo,
    "windowTheme",
    "background",
    "single",
    "_0",
    "style",
    "color",
    "_0",
  );

  const baseColors = dig(colorNode, "blendedGradient", "_0", "baseColors");
  if (Array.isArray(baseColors)) {
    const stops = baseColors
      .map(asColor)
      .filter((c): c is RGB => c !== undefined)
      .map(rgbToHex);
    if (stops.length > 0) return stops.slice(0, 2);
  }

  const single = asColor(dig(colorNode, "blendedSingleColor", "_0", "color"));
  if (single !== undefined) return [rgbToHex(single)];

  const midTone = asColor(
    dig(customInfo, "windowTheme", "primaryColorPalette", "midTone"),
  );
  const shaded = asColor(
    dig(customInfo, "windowTheme", "primaryColorPalette", "shaded"),
  );
  const palette = [midTone, shaded]
    .filter((c): c is RGB => c !== undefined)
    .map(rgbToHex);
  if (palette.length > 0) return palette;

  return [];
}
