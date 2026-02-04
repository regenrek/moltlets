export function assertNoLegacyHostKeys(parsed: unknown): void {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const hostsRaw = (parsed as { hosts?: unknown }).hosts;
  if (!hostsRaw || typeof hostsRaw !== "object" || Array.isArray(hostsRaw)) return;
  for (const [host, hostCfg] of Object.entries(hostsRaw as Record<string, unknown>)) {
    if (!hostCfg || typeof hostCfg !== "object" || Array.isArray(hostCfg)) continue;
    if ("bots" in hostCfg || "botsOrder" in hostCfg) {
      throw new Error(
        `hosts.${host}.bots/botsOrder were renamed to hosts.${host}.gateways/gatewaysOrder (schema v18). Update your config.`,
      );
    }
    if ("publicSsh" in hostCfg) {
      throw new Error(`legacy host config key publicSsh found for ${host}; use sshExposure.mode`);
    }
    if ("opentofu" in hostCfg) {
      throw new Error(`legacy host config key opentofu found for ${host}; use provisioning`);
    }
    if ("sshAuthorizedKeys" in hostCfg || "sshKnownHosts" in hostCfg) {
      throw new Error(
        `host SSH keys are now project-scoped; move hosts.${host}.sshAuthorizedKeys/sshKnownHosts to fleet.sshAuthorizedKeys/sshKnownHosts`,
      );
    }
  }
}

export function assertNoLegacyEnvSecrets(parsed: unknown): void {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
  const fleet = (parsed as { fleet?: unknown }).fleet as any;
  if (fleet && typeof fleet === "object" && !Array.isArray(fleet)) {
    if ("envSecrets" in fleet) {
      throw new Error("fleet.envSecrets was removed; use fleet.secretEnv (ENV_VAR -> sops secret name)");
    }
    if ("modelSecrets" in fleet) {
      throw new Error("fleet.modelSecrets was removed; use fleet.secretEnv (e.g. OPENAI_API_KEY -> openai_api_key)");
    }
    if ("guildId" in fleet) {
      throw new Error("fleet.guildId was removed; configure Discord in hosts.<host>.gateways.<gatewayId>.channels.discord");
    }
  }

  const hosts = (parsed as { hosts?: unknown }).hosts;
  if (hosts && typeof hosts === "object" && !Array.isArray(hosts)) {
    for (const [host, hostCfg] of Object.entries(hosts as Record<string, unknown>)) {
      if (!hostCfg || typeof hostCfg !== "object" || Array.isArray(hostCfg)) continue;
      const gateways = (hostCfg as any).gateways;
      if (!gateways || typeof gateways !== "object" || Array.isArray(gateways)) continue;
      for (const [gatewayId, gatewayCfg] of Object.entries(gateways as Record<string, unknown>)) {
        if (!gatewayCfg || typeof gatewayCfg !== "object" || Array.isArray(gatewayCfg)) continue;
        const profile = (gatewayCfg as any).profile;
        if (profile && typeof profile === "object" && !Array.isArray(profile)) {
          if ("envSecrets" in profile) {
            throw new Error(
              `hosts.${host}.gateways.${gatewayId}.profile.envSecrets was removed; use profile.secretEnv (ENV_VAR -> sops secret name)`,
            );
          }
          if ("discordTokenSecret" in profile) {
            throw new Error(
              `hosts.${host}.gateways.${gatewayId}.profile.discordTokenSecret was removed; use profile.secretEnv.DISCORD_BOT_TOKEN`,
            );
          }
          if ("modelSecrets" in profile) {
            throw new Error(
              `hosts.${host}.gateways.${gatewayId}.profile.modelSecrets was removed; use profile.secretEnv (OPENAI_API_KEY/ANTHROPIC_API_KEY/etc)`,
            );
          }
          const skills = (profile as any).skills;
          const entries = skills?.entries;
          if (entries && typeof entries === "object" && !Array.isArray(entries)) {
            for (const [skill, entry] of Object.entries(entries as Record<string, unknown>)) {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
              if ("envSecrets" in (entry as any)) {
                throw new Error(
                  `hosts.${host}.gateways.${gatewayId}.profile.skills.entries.${skill}.envSecrets was removed; use hosts.${host}.gateways.${gatewayId}.skills.entries.${skill}.apiKeySecret or apiKey`,
                );
              }
            }
          }
        }

        const gatewaySkills = (gatewayCfg as any).skills;
        const gatewaySkillEntries = gatewaySkills?.entries;
        if (gatewaySkillEntries && typeof gatewaySkillEntries === "object" && !Array.isArray(gatewaySkillEntries)) {
          for (const [skill, entry] of Object.entries(gatewaySkillEntries as Record<string, unknown>)) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
            if ("envSecrets" in (entry as any)) {
              throw new Error(
                `hosts.${host}.gateways.${gatewayId}.skills.entries.${skill}.envSecrets was removed; use hosts.${host}.gateways.${gatewayId}.skills.entries.${skill}.apiKeySecret or apiKey`,
              );
            }
          }
        }
      }
    }
  }
}
