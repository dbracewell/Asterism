import "server-only";
import palette0 from "./catppuccin-mocha.json";
import palette1 from "./catppuccin-latte-mauve.json";
import palette2 from "./ucf-knights.json";
import palette3 from "./dracula.json";
import palette4 from "./light.json";
import palette5 from "./flowers.json";
import palette6 from "./one_dark.json";
import palette7 from "./dark.json";

// Static imports keep application bundles independent of writable theme storage.
export const bundledThemes = {
  "catppuccin-mocha": palette0,
  "catppuccin-latte-mauve": palette1,
  "ucf-knights": palette2,
  dracula: palette3,
  light: palette4,
  flowers: palette5,
  one_dark: palette6,
  dark: palette7,
};
