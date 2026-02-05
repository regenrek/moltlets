import { describe, it, expect } from "vitest";
import { getSopsCreationRuleAgeRecipients, removeSopsCreationRule, upsertSopsCreationRule } from "../src/lib/security/sops-config";

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
      pathRegex: "^openclaw-fleet-host\\.yaml$",
      ageRecipients: ["age1a", "age1b", "age1a"],
    });
    expect(out).toContain("path_regex: ^openclaw-fleet-host\\.yaml$");
    expect(out).toContain("key_groups:");
    expect(out).toContain("- age:");
    expect(out).toContain("- age1a");
    expect(out).toContain("- age1b");
    expect(out).toContain("path_regex: ^other\\.yaml$");
  });

  it("updates an existing rule", () => {
    const existing = `
creation_rules:
  - path_regex: ^openclaw-fleet-host\\.yaml$
    key_groups:
      - age:
          - age1old
`;
    const out = upsertSopsCreationRule({
      existingYaml: existing,
      pathRegex: "^openclaw-fleet-host\\.yaml$",
      ageRecipients: ["age1new"],
    });
    expect(out).toContain("- age1new");
    expect(out).toContain("- age1old");
  });

  it("upgrades legacy 'age' rules to key_groups", () => {
    const existing = `
creation_rules:
  - path_regex: ^openclaw-fleet-host\\.yaml$
    age: age1old, age1other
`;
    const out = upsertSopsCreationRule({
      existingYaml: existing,
      pathRegex: "^openclaw-fleet-host\\.yaml$",
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
        pathRegex: "^openclaw-fleet-host\\.yaml$",
        ageRecipients: [],
      }),
    ).toThrow(/no age recipients/);
  });

  it("removes a creation rule by exact path_regex", () => {
    const existing = `
creation_rules:
  - path_regex: ^openclaw-fleet-host\\.yaml$
    key_groups:
      - age:
          - age1old
  - path_regex: ^other\\.yaml$
    key_groups:
      - age:
          - age1other
`;
    const out = removeSopsCreationRule({ existingYaml: existing, pathRegex: "^openclaw-fleet-host\\.yaml$" });
    expect(out).not.toContain("path_regex: ^openclaw-fleet-host\\.yaml$");
    expect(out).toContain("path_regex: ^other\\.yaml$");
  });

  it("removes creation_rules when the last rule is removed", () => {
    const existing = `
creation_rules:
  - path_regex: ^only\\.yaml$
    key_groups:
      - age:
          - age1only
`;
    const out = removeSopsCreationRule({ existingYaml: existing, pathRegex: "^only\\.yaml$" });
    expect(out).not.toContain("creation_rules:");
  });

  it("upserts when creation_rules is not an array", () => {
    const existing = `
creation_rules:
  foo: bar
`;
    const out = upsertSopsCreationRule({
      existingYaml: existing,
      pathRegex: "^alpha\\.yaml$",
      ageRecipients: ["age1a"],
    });
    expect(out).toContain("path_regex: ^alpha\\.yaml$");
    expect(out).toContain("- age1a");
  });

  it("adds an age group when key_groups contains no age entries", () => {
    const existing = `
creation_rules:
  - path_regex: ^alpha\\.yaml$
    key_groups:
      - pgp:
          - pgp1
`;
    const out = upsertSopsCreationRule({
      existingYaml: existing,
      pathRegex: "^alpha\\.yaml$",
      ageRecipients: ["age1a"],
    });
    expect(out).toContain("pgp:");
    expect(out).toContain("- age1a");
  });

  it("extracts age recipients from key_groups and legacy age", () => {
    const existing = `
creation_rules:
  - path_regex: ^alpha\\.yaml$
    key_groups:
      - age:
          - age1a
          - " age1a "
          - age1b
      - pgp:
          - pgp1
    age: age1legacy, age1b
`;
    const out = getSopsCreationRuleAgeRecipients({ existingYaml: existing, pathRegex: "^alpha\\.yaml$" });
    expect(out).toEqual(["age1a", "age1b", "age1legacy"]);
  });

  it("returns [] for empty or invalid yaml", () => {
    expect(getSopsCreationRuleAgeRecipients({ existingYaml: "", pathRegex: "^alpha\\.yaml$" })).toEqual([]);
    expect(getSopsCreationRuleAgeRecipients({ existingYaml: ":\n-", pathRegex: "^alpha\\.yaml$" })).toEqual([]);
  });

  it("returns [] when creation_rules is not an array or no matching rule", () => {
    const existing = `
creation_rules:
  foo: bar
`;
    expect(getSopsCreationRuleAgeRecipients({ existingYaml: existing, pathRegex: "^alpha\\.yaml$" })).toEqual([]);
    const noMatch = `
creation_rules:
  - path_regex: ^other\\.yaml$
    key_groups:
      - age:
          - age1other
`;
    expect(getSopsCreationRuleAgeRecipients({ existingYaml: noMatch, pathRegex: "^alpha\\.yaml$" })).toEqual([]);
  });
});
