import { defineCommand } from "citty";
import { releaseManifest } from "./manifest.js";
import { releasePointer } from "./pointer.js";

export const release = defineCommand({
  meta: {
    name: "release",
    description: "Signed desired-state release tooling (manifests, pointers, signing).",
  },
  subCommands: {
    manifest: releaseManifest,
    pointer: releasePointer,
  },
});
