import "server-only";
import atlas from "./atlas.json";
import catppuccinLatteMauve from "./catppuccin-latte-mauve.json";
import catppuccinMocha from "./catppuccin-mocha.json";
import dracula from "./dracula.json";
import flowers from "./flowers.json";
import nightAtlas from "./night-atlas.json";
import oneDark from "./one_dark.json";
import ucfKnights from "./ucf-knights.json";

// Static imports keep application bundles independent of writable theme storage.
export const bundledThemes = {
  atlas,
  "night-atlas": nightAtlas,
  "catppuccin-mocha": catppuccinMocha,
  "catppuccin-latte-mauve": catppuccinLatteMauve,
  "ucf-knights": ucfKnights,
  dracula,
  flowers,
  one_dark: oneDark,
};
