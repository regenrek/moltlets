import { describe, it, expect } from "vitest";
import { removeSopsCreationRule, upsertSopsCreationRule } from "../src/lib/sops-config";

describe("sops-config", () => {
  it("upserts a creation rule", () => {
    const existing = `
creation_rules:
  - path_regex: ^other\\.yaml$
    key_groups:
      - age:
          - age1other
`;
    const out = upsertSopsCreationRule({
      existingYaml: existing,
      pathRegex: "^clawdbot-fleet-host\\.yaml$",
      ageRecipients: ["age1a", "age1b", "age1a"],
    });
    expect(out).toContain("path_regex: ^clawdbot-fleet-host\\.yaml$");
    expect(out).toContain("key_groups:");
    expect(out).toContain("- age:");
    expect(out).toContain("- age1a");
    expect(out).toContain("- age1b");
    expect(out).toContain("path_regex: ^other\\.yaml$");
  });

  it("updates an existing rule", () => {
    const existing = `
creation_rules:
  - path_regex: ^clawdbot-fleet-host\\.yaml$
    key_groups:
      - age:
          - age1old
`;
    const out = upsertSopsCreationRule({
      existingYaml: existing,
      pathRegex: "^clawdbot-fleet-host\\.yaml$",
      ageRecipients: ["age1new"],
    });
    expect(out).toContain("- age1new");
    expect(out).toContain("- age1old");
  });

  it("upgrades legacy 'age' rules to key_groups", () => {
    const existing = `
creation_rules:
  - path_regex: ^clawdbot-fleet-host\\.yaml$
    age: age1old, age1other
`;
    const out = upsertSopsCreationRule({
      existingYaml: existing,
      pathRegex: "^clawdbot-fleet-host\\.yaml$",
      ageRecipients: ["age1new"],
    });
    expect(out).toContain("key_groups:");
    expect(out).toContain("- age1old");
    expect(out).toContain("- age1other");
    expect(out).toContain("- age1new");
    expect(out).not.toContain("age: age1old");
  });

  it("requires recipients", () => {
    expect(() =>
      upsertSopsCreationRule({
        existingYaml: "",
        pathRegex: "^clawdbot-fleet-host\\.yaml$",
        ageRecipients: [],
      }),
    ).toThrow(/no age recipients/);
  });

  it("removes a creation rule by exact path_regex", () => {
    const existing = `
creation_rules:
  - path_regex: ^clawdbot-fleet-host\\.yaml$
    key_groups:
      - age:
          - age1old
  - path_regex: ^other\\.yaml$
    key_groups:
      - age:
          - age1other
`;
    const out = removeSopsCreationRule({ existingYaml: existing, pathRegex: "^clawdbot-fleet-host\\.yaml$" });
    expect(out).not.toContain("path_regex: ^clawdbot-fleet-host\\.yaml$");
    expect(out).toContain("path_regex: ^other\\.yaml$");
  });
});
