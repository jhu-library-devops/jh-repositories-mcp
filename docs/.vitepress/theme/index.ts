/**
 * Site theme: VitePress's default theme with a Johns Hopkins brand layer.
 * Fonts are self-hosted so the public site makes no third-party requests.
 */

// External libraries
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/700.css";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/500.css";
import "@fontsource/work-sans/600.css";
import DefaultTheme from "vitepress/theme";
import { h } from "vue";

// Internal modules
import "./brand.css";

// Type imports
import type { Theme } from "vitepress";

const theme: Theme = {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      // Second line of the two-line brand mark in the header.
      "nav-bar-title-after": () => h("span", { class: "brand__network" }, "Developer reference"),
    }),
};

export default theme;
