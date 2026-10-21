import { defineConfig } from "vite";

// Served from https://thorstein-games.github.io/mastermind/ and proxied to
// https://thorsteingames.com/mastermind, so every asset path is relative.
export default defineConfig({
  base: "./",
});
