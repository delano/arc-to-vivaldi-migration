import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { extractAccentStops, rgbToHex } from "../lib/arc-color.js";

test("rgbToHex: maps [0,1] floats to 8-bit hex", () => {
  strictEqual(rgbToHex({ r: 0, g: 0, b: 0 }), "#000000");
  strictEqual(rgbToHex({ r: 1, g: 1, b: 1 }), "#ffffff");
  strictEqual(rgbToHex({ r: 1, g: 0, b: 0 }), "#ff0000");
});

test("rgbToHex: clamps wide-gamut values outside [0,1]", () => {
  // Arc's extendedSRGB occasionally emits negative or >1 channels.
  strictEqual(rgbToHex({ r: -0.23, g: 0.5, b: 1.4 }), "#0080ff");
});

test("extractAccentStops: two-stop blendedGradient → two hex stops", () => {
  const customInfo = {
    windowTheme: {
      background: {
        single: {
          _0: {
            style: {
              color: {
                _0: {
                  blendedGradient: {
                    _0: {
                      baseColors: [
                        { red: 1, green: 0, blue: 0, alpha: 1 },
                        { red: 0, green: 0, blue: 1, alpha: 1 },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  deepStrictEqual(extractAccentStops(customInfo), ["#ff0000", "#0000ff"]);
});

test("extractAccentStops: single blendedSingleColor → one hex stop", () => {
  const customInfo = {
    windowTheme: {
      background: {
        single: {
          _0: {
            style: {
              color: {
                _0: {
                  blendedSingleColor: {
                    _0: { color: { red: 0, green: 1, blue: 0, alpha: 1 } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  deepStrictEqual(extractAccentStops(customInfo), ["#00ff00"]);
});

test("extractAccentStops: falls back to primaryColorPalette when no background", () => {
  const customInfo = {
    windowTheme: {
      primaryColorPalette: {
        midTone: { red: 1, green: 0, blue: 0 },
        shaded: { red: 0, green: 0, blue: 1 },
      },
    },
  };
  deepStrictEqual(extractAccentStops(customInfo), ["#ff0000", "#0000ff"]);
});

test("extractAccentStops: empty customInfo → no stops", () => {
  deepStrictEqual(extractAccentStops({}), []);
  deepStrictEqual(extractAccentStops(undefined), []);
  deepStrictEqual(extractAccentStops({ iconType: { emoji_v2: "💎" } }), []);
});
