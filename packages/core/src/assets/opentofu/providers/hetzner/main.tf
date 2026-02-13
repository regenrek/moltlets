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
# OpenTofu/Terraform resource. That caused re-provisioning failures (409 uniqueness) and
# could risk deleting a shared key on apply. We now pass `ssh_key_id` in.
removed {
  from = hcloud_ssh_key.admin
  lifecycle {
    destroy = false
  }
}

variable "host_name" {
  type = string
}

variable "ssh_key_id" {
  type = string
}

variable "admin_cidr" {
  type = string
}

variable "admin_cidr_is_world_open" {
  type = bool
  default = false
  description = "Explicitly allow 0.0.0.0/0 or ::/0 when SSH exposure is enabled (not recommended)."
}

variable "ssh_exposure_mode" {
  type = string
  default = "tailnet"
  validation {
    condition     = contains(["tailnet", "bootstrap", "public"], var.ssh_exposure_mode)
    error_message = "ssh_exposure_mode must be one of: tailnet, bootstrap, public"
  }
}

variable "tailnet_mode" {
  type = string
  default = "tailscale"
  validation {
    condition     = contains(["none", "tailscale"], var.tailnet_mode)
    error_message = "tailnet_mode must be one of: none, tailscale"
  }
}

variable "tailscale_udp_ingress_enabled" {
  type        = bool
  default     = true
  description = "Allow direct Tailscale WireGuard UDP ingress (port 41641) from the internet. Disable for relay-only mode."
}

variable "server_type" {
  type = string
  default = "cpx32"
}

variable "image" {
  type = string
  default = "debian-12"
}

variable "location" {
  type = string
  default = "fsn1"
}

variable "volume_size_gb" {
  type    = number
  default = 0
  validation {
    condition = (
      floor(var.volume_size_gb) == var.volume_size_gb &&
      (var.volume_size_gb == 0 || (var.volume_size_gb >= 10 && var.volume_size_gb <= 10240))
    )
    error_message = "volume_size_gb must be 0 (disabled) or an integer between 10 and 10240."
  }
}

provider "hcloud" {}

module "host" {
  source        = "./modules/host"
  name          = var.host_name
  admin_cidr    = var.admin_cidr
  admin_cidr_is_world_open = var.admin_cidr_is_world_open
  ssh_key_id    = var.ssh_key_id
  ssh_exposure_mode = var.ssh_exposure_mode
  tailnet_mode      = var.tailnet_mode
  tailscale_udp_ingress_enabled = var.tailscale_udp_ingress_enabled
  server_type   = var.server_type
  image         = var.image
  location      = var.location
  volume_size_gb = var.volume_size_gb
}
