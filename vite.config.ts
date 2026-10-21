import { defineConfig } from "vite";

// Served from https://thorstein-games.github.io/mastermind/ and proxied to
// https://thorsteingames.com/mastermind (no trailing slash). Asset paths must be
// absolute: relative ones would resolve to thorsteingames.com/assets/... there.
export default defineConfig({
  base: "/mastermind/",
});
