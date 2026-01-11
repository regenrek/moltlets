terraform {
  required_version = ">= 1.6.0"

  required_providers {
    hcloud = {
      source = "hetznercloud/hcloud"
      version = ">= 1.50.0"
    }
  }
}

# State migration: older versions of this repo managed the Hetzner SSH key as a
# Terraform resource. That caused re-provisioning failures (409 uniqueness) and
# could risk deleting a shared key on apply. We now pass `ssh_key_id` in.
removed {
  from = hcloud_ssh_key.admin
  lifecycle {
    destroy = false
  }
}

variable "hcloud_token" {
  type = string
}

variable "ssh_key_id" {
  type = string
}

variable "admin_cidr" {
  type = string
}

variable "bootstrap_ssh" {
  type = bool
  default = true
}

variable "server_type" {
  type = string
  default = "cx43"
}

variable "location" {
  type = string
  default = "nbg1"
}

variable "wireguard_port" {
  type = string
  default = "51820"
}

provider "hcloud" {
  token = var.hcloud_token
}

module "clawdbot_fleet_host" {
  source        = "./modules/bot_host"
  name          = "clawdbot-fleet-host"
  admin_cidr    = var.admin_cidr
  ssh_key_id    = var.ssh_key_id
  bootstrap_ssh = var.bootstrap_ssh
  server_type   = var.server_type
  location      = var.location
  wireguard_port = var.wireguard_port
}
