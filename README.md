<p align="center">
  <img src="public/clawlets_banner.png" alt="Clawlets Banner" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/clawlets"><img src="https://img.shields.io/npm/v/clawlets.svg" alt="npm version" /></a>
</p>

# Clawlets

Clawlets is an unofficial infrastructure wrapper for running OpenClaw gateway fleets on NixOS (Hetzner-focused). It provides
a local-first dashboard and a CLI to bootstrap, deploy, and operate fleets over time.

## Official Templates

- Looking for official AWS Deploy? [openclaw/clawdinators](https://github.com/openclaw/clawdinators)
- Openclaw [nix-openclaw](https://github.com/openclaw/nix-openclaw)

> 🚨🚨
> **Use at your own risk!** This project is under active development. You absolutely need to know what you're doing
> before deploying this. Misconfiguration can expose credentials, open security holes, or cause data loss.

> **Note:** Clawlets is an independent project and is **not affiliated with OpenClaw**. Please do not open issues or
> PRs on the OpenClaw repositories for Clawlets-related problems.

## Features

- **Discord gateway fleet** - deploy multiple gateways from one repo.
- **Dashboard + CLI** - local UI for setup/ops, CLI for automation and recovery.
- **Hetzner + NixOS** - reproducible builds and declarative host config.
- **Secrets** - SOPS/age (sops-nix) and runtime boundaries.
- **Updates** - pull-based updates with rollbacks via NixOS generations.

## Dashboard

<p align="center">
  <img src="public/clawlets_desktop.png" alt="Clawlets Dashboard" />
</p>

The dashboard is the primary interface for managing a fleet:

- **Host overview** - status, location, and server type at a glance
- **Activity monitoring** - visualize runs and deployments over time
- **Host details** - tailnet, SSH exposure, disk configuration, network settings
- **Quick actions** - deploy, updates, logs, audit, restart, settings

## Documentation

**Docs:** https://docs.clawlets.com

Source: `apps/docs/content/docs/`

## Notes & Credits

Clawlets is strictly an infrastructure wrapper. All credit for the AI assistant and Nix packaging goes to the core
projects:

- [nix-openclaw](https://github.com/openclaw/nix-openclaw) by [joshp123](https://github.com/joshp123)
- [openclaw](https://github.com/openclaw/openclaw) by [steipete](https://x.com/steipete)

## License

MIT

## Find me

[@kevinkernx](https://x.com/kevinkern)
