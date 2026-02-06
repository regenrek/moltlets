terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0"
    }
  }
}

variable "name" {
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

locals {
  admin_cidr_is_ipv6    = strcontains(var.admin_cidr, ":")
  ssh_ingress_enabled   = var.ssh_exposure_mode != "tailnet"
  tailscale_udp_enabled = var.tailnet_mode == "tailscale" && var.tailscale_udp_ingress_enabled
}

data "aws_vpc" "default" {
  count   = var.use_default_vpc ? 1 : 0
  default = true
}

data "aws_subnet" "selected" {
  count = var.subnet_id != "" ? 1 : 0
  id    = var.subnet_id
}

locals {
  selected_vpc_id = var.use_default_vpc
    ? data.aws_vpc.default[0].id
    : (
      var.vpc_id != ""
      ? var.vpc_id
      : (var.subnet_id != "" ? data.aws_subnet.selected[0].vpc_id : "")
    )
}

data "aws_subnets" "in_vpc" {
  count = var.subnet_id == "" ? 1 : 0
  filter {
    name   = "vpc-id"
    values = [local.selected_vpc_id]
  }
}

locals {
  selected_subnet_id = var.subnet_id != "" ? var.subnet_id : try(one(data.aws_subnets.in_vpc[0].ids), "")
}

resource "aws_key_pair" "admin" {
  key_name   = "${var.name}-clawlets-admin"
  public_key = var.ssh_public_key

  tags = {
    Name      = "${var.name}-admin-key"
    ManagedBy = "clawlets"
  }
}

resource "aws_security_group" "host" {
  name_prefix = "${var.name}-clawlets-"
  description = "clawlets host security group for ${var.name}"
  vpc_id      = local.selected_vpc_id

  dynamic "ingress" {
    for_each = local.ssh_ingress_enabled ? [1] : []
    content {
      description      = "SSH ${var.ssh_exposure_mode} from admin CIDR"
      from_port        = 22
      to_port          = 22
      protocol         = "tcp"
      cidr_blocks      = local.admin_cidr_is_ipv6 ? [] : [var.admin_cidr]
      ipv6_cidr_blocks = local.admin_cidr_is_ipv6 ? [var.admin_cidr] : []
    }
  }

  dynamic "ingress" {
    for_each = local.tailscale_udp_enabled ? [1] : []
    content {
      description      = "Tailscale WireGuard UDP (direct connections)"
      from_port        = 41641
      to_port          = 41641
      protocol         = "udp"
      cidr_blocks      = ["0.0.0.0/0"]
      ipv6_cidr_blocks = ["::/0"]
    }
  }

  egress {
    description      = "Allow all outbound"
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }

  lifecycle {
    precondition {
      condition = (
        !local.ssh_ingress_enabled ||
        var.admin_cidr_is_world_open ||
        (var.admin_cidr != "0.0.0.0/0" && var.admin_cidr != "::/0")
      )
      error_message = "refusing to open SSH with admin_cidr=0.0.0.0/0 (or ::/0); set admin_cidr_is_world_open=true to override"
    }

    precondition {
      condition     = local.selected_vpc_id != ""
      error_message = "unable to determine AWS VPC for host security group"
    }
  }

  tags = {
    Name      = "${var.name}-sg"
    ManagedBy = "clawlets"
  }
}

resource "aws_instance" "vm" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = local.selected_subnet_id
  key_name                    = aws_key_pair.admin.key_name
  vpc_security_group_ids      = [aws_security_group.host.id]
  associate_public_ip_address = true

  metadata_options {
    http_tokens = "required"
  }

  lifecycle {
    precondition {
      condition     = local.selected_subnet_id != ""
      error_message = "unable to determine AWS subnet for host instance"
    }
  }

  tags = {
    Name      = var.name
    ManagedBy = "clawlets"
  }
}

output "ipv4" {
  value = aws_instance.vm.public_ip
}

output "instance_id" {
  value = aws_instance.vm.id
}

output "security_group_id" {
  value = aws_security_group.host.id
}
