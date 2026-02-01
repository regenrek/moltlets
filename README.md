<p align="center">
  <img src="public/clawlets_banner.png" alt="Clawlets Banner" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/clawlets"><img src="https://img.shields.io/npm/v/clawlets.svg" alt="npm version" /></a>
</p>

# Clawlets

Clawdlets is an unofficial hetzner infrastructure companion for openclaw and nix-openclaw. It provides the tooling to deploy and manage, reproducible bot fleets on Hetzner Cloud using NixOS.

## Official Templates
- Looking for official AWS Deploy? [clawdbot/clawdinators](https://github.com/clawdbot/clawdinators)
- Clawdbot [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot)

> 🚨🚨
> **Use at your own risk!** This project is under active development. You absolutely need to know what you're doing before deploying this. Misconfiguration can expose credentials, open security holes, or cause data loss.

> **Note:** Clawlets is an independent project and is **not affiliated with OpenClaw**. Please do not open issues or PRs on the OpenClaw repositories for Clawlets-related problems.

## Features

- **Discord bot fleet** – deploy multiple bots from one repo.
- **Options for Security** – Tailscale, lockdown, sops/age secrets.
- **Hetzner + NixOS** – immutable infra + reproducible deploys.
- **CLI-first** – bootstrap, deploy, ops, troubleshooting.
- **Atomic updates** – rollbacks via NixOS generations.

## Dashboard

<p align="center">
  <img src="public/clawlets_desktop.png" alt="Clawlets Dashboard" />
</p>

The Clawlets dashboard provides a unified interface for managing your infrastructure:

- **Host Overview** – status, location, and server type at a glance
- **Activity Monitoring** – visualize runs and deployments over time
- **Host Details** – Tailnet, SSH exposure, disk configuration, and network settings
- **Quick Actions** – Deploy, Updates, Logs, Audit, Restart, and Settings
- **Full Operations** – Agents, Bootstrap, Secrets, Skills management from the sidebar

## Quickstart

**Documentation:** https://docs.clawlets.com

## Documentation

- Start here: `apps/docs/content/docs/index.mdx` (Overview)
- Dashboard: `apps/docs/content/docs/dashboard/index.mdx`
- Configuration: `apps/docs/content/docs/configuration/index.mdx`
- Security: `apps/docs/content/docs/security/index.mdx`
- Operations: `apps/docs/content/docs/operations/index.mdx`
- CLI: `apps/docs/content/docs/cli/index.mdx`

## Notes & Credits

Clawlets started as a personal tool to organize fleet management, bootstrapping, and ops. All credit for the AI assistant and Nix packaging goes to the core projects:

- [nix-clawdbot](https://github.com/clawdbot/nix-clawdbot) by [joshp123](https://github.com/joshp123)
- [clawdbot](https://github.com/clawdbot/clawdbot) by [steipete](https://x.com/steipete)

## License

MIT

## Find me

[@kevinkernx](https://x.com/kevinkern)
