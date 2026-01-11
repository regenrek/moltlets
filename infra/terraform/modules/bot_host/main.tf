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
  default = "nbg1"
}

variable "server_type" {
  type = string
  default = "cx43"
}

variable "image" {
  type = string
  default = "debian-12"
}

variable "admin_cidr" {
  type = string
}

variable "ssh_key_id" {
  type = string
}

variable "bootstrap_ssh" {
  type = bool
  default = true
}

resource "hcloud_firewall" "fw" {
  name = "${var.name}-fw"

  dynamic "rule" {
    for_each = var.bootstrap_ssh ? [1] : []
    content {
      direction   = "in"
      protocol    = "tcp"
      port        = "22"
      source_ips  = [var.admin_cidr]
      description = "Bootstrap SSH from admin CIDR"
    }
  }
}

resource "hcloud_server" "vm" {
  name        = var.name
  server_type = var.server_type
  location    = var.location
  image       = var.image

  ssh_keys     = [var.ssh_key_id]
  firewall_ids = [hcloud_firewall.fw.id]
}

output "ipv4" {
  value = hcloud_server.vm.ipv4_address
}
