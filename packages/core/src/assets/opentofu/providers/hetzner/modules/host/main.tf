terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.50.0"
    }
  }
}

variable "name" {
  type = string
}

variable "location" {
  type = string
  default = "fsn1"
}

variable "server_type" {
  type = string
  default = "cpx32"
}

variable "image" {
  type = string
  default = "debian-12"
}

variable "admin_cidr" {
  type = string
}

variable "admin_cidr_is_world_open" {
  type = bool
  default = false
  description = "Explicitly allow 0.0.0.0/0 or ::/0 when SSH exposure is enabled (not recommended)."
}

variable "ssh_key_id" {
  type = string
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
  default = "none"
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

locals {
  ssh_ingress_enabled = var.ssh_exposure_mode != "tailnet"
  tailscale_udp_enabled = var.tailnet_mode == "tailscale" && var.tailscale_udp_ingress_enabled
}

resource "hcloud_firewall" "base" {
  name = "${var.name}-base-fw"

  dynamic "rule" {
    for_each = local.tailscale_udp_enabled ? [1] : []
    content {
      direction   = "in"
      protocol    = "udp"
      port        = "41641"
      source_ips  = ["0.0.0.0/0", "::/0"]
      description = "Tailscale WireGuard UDP (direct connections)"
    }
  }
}

resource "hcloud_firewall" "ssh" {
  count = local.ssh_ingress_enabled ? 1 : 0
  name  = "${var.name}-ssh-fw"

  lifecycle {
    precondition {
      condition = (
        !local.ssh_ingress_enabled ||
        var.admin_cidr_is_world_open ||
        (var.admin_cidr != "0.0.0.0/0" && var.admin_cidr != "::/0")
      )
      error_message = "refusing to open SSH with admin_cidr=0.0.0.0/0 (or ::/0); set admin_cidr_is_world_open=true to override"
    }
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = [var.admin_cidr]
    description = "SSH ${var.ssh_exposure_mode} from admin CIDR"
  }
}

resource "hcloud_server" "vm" {
  name        = var.name
  server_type = var.server_type
  location    = var.location
  image       = var.image

  ssh_keys     = [var.ssh_key_id]
  firewall_ids = concat(
    [hcloud_firewall.base.id],
    local.ssh_ingress_enabled ? [hcloud_firewall.ssh[0].id] : [],
  )
}

resource "hcloud_volume" "state" {
  count    = var.volume_size_gb > 0 ? 1 : 0
  name     = "${var.name}-state"
  size     = var.volume_size_gb
  location = var.location
  format   = "ext4"
}

resource "hcloud_volume_attachment" "state" {
  count     = var.volume_size_gb > 0 ? 1 : 0
  volume_id = hcloud_volume.state[0].id
  server_id = hcloud_server.vm.id
  automount = false
}

output "ipv4" {
  value = hcloud_server.vm.ipv4_address
}

output "instance_id" {
  value = hcloud_server.vm.id
}

output "volume_id" {
  value = var.volume_size_gb > 0 ? hcloud_volume.state[0].id : ""
}

output "volume_linux_device" {
  value = var.volume_size_gb > 0 ? hcloud_volume.state[0].linux_device : ""
}
