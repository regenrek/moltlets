terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0"
    }
  }
}

variable "host_name" {
  type = string
}

variable "admin_cidr" {
  type = string
}

variable "admin_cidr_is_world_open" {
  type        = bool
  default     = false
  description = "Explicitly allow 0.0.0.0/0 or ::/0 when SSH exposure is enabled (not recommended)."
}

variable "ssh_exposure_mode" {
  type    = string
  default = "tailnet"
  validation {
    condition     = contains(["tailnet", "bootstrap", "public"], var.ssh_exposure_mode)
    error_message = "ssh_exposure_mode must be one of: tailnet, bootstrap, public"
  }
}

variable "tailnet_mode" {
  type    = string
  default = "tailscale"
  validation {
    condition     = contains(["none", "tailscale"], var.tailnet_mode)
    error_message = "tailnet_mode must be one of: none, tailscale"
  }
}

variable "region" {
  type = string
}

variable "instance_type" {
  type = string
}

variable "ami_id" {
  type = string
}

variable "ssh_public_key" {
  type = string
}

variable "vpc_id" {
  type    = string
  default = ""
}

variable "subnet_id" {
  type    = string
  default = ""
}

variable "use_default_vpc" {
  type    = bool
  default = false
}

provider "aws" {
  region = var.region
}

module "host" {
  source                  = "./modules/host"
  name                    = var.host_name
  admin_cidr              = var.admin_cidr
  admin_cidr_is_world_open = var.admin_cidr_is_world_open
  ssh_exposure_mode       = var.ssh_exposure_mode
  tailnet_mode            = var.tailnet_mode
  instance_type           = var.instance_type
  ami_id                  = var.ami_id
  ssh_public_key          = var.ssh_public_key
  vpc_id                  = var.vpc_id
  subnet_id               = var.subnet_id
  use_default_vpc         = var.use_default_vpc
}
