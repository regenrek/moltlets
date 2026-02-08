// Wrapper for @tanstack/eslint-plugin-query to work with oxlint jsPlugins.
// Scoped package names (@tanstack/*) have rough edges in jsPlugins,
// so we rename meta.name to a flat identifier.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const mod = require("@tanstack/eslint-plugin-query");
const plugin = mod.default ?? mod;

if (plugin.meta) plugin.meta.name = "tanstack-query";
export default plugin;
