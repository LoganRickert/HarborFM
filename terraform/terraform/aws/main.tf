terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    external = {
      source  = "hashicorp/external"
      version = "~> 2.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.region
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

data "aws_vpc" "default" {
  default = true
}

data "external" "admin_password_hash" {
  count = var.admin_email != "" && var.admin_password != "" ? 1 : 0
  program = ["sh", "-c", "cd ${path.module}/../../../server && node scripts/hash-admin-password.mjs"]
  query = {
    password = var.admin_password
  }
}

resource "random_id" "setup_id" {
  count       = var.admin_email == "" && var.setup_id == "" ? 1 : 0
  byte_length = 16
}

locals {
  vpc_id              = coalesce(var.vpc_id, data.aws_vpc.default.id)
  admin_password_hash = length(data.external.admin_password_hash) > 0 ? data.external.admin_password_hash[0].result.hash : ""
  setup_id_export     = var.setup_id != "" ? var.setup_id : (var.admin_email != "" ? "" : random_id.setup_id[0].hex)
}

module "userdata" {
  source = "../modules/harborfm-userdata"

  os                       = var.os
  deploy_type               = var.deploy_type
  domain                    = var.domain
  certbot_email             = var.certbot_email
  self_signed_cert          = var.self_signed_cert
  install_dir               = var.install_dir
  harborfm_repo             = var.harborfm_repo
  harborfm_branch           = var.harborfm_branch
  webrtc_enabled            = var.webrtc_enabled
  reverse_proxy             = var.reverse_proxy
  admin_email               = var.admin_email
  admin_password_hash       = local.admin_password_hash
  admin_registration_enabled = var.admin_registration_enabled
  admin_public_feeds_enabled = var.admin_public_feeds_enabled
  admin_hostname            = var.admin_hostname
  ssh_public_key            = var.ssh_public_key
  setup_id_export           = local.setup_id_export
  cookie_secure             = var.cookie_secure
  email_provider            = var.email_provider
  email_webhook_url         = var.email_webhook_url
  email_webhook_field_key   = var.email_webhook_field_key
  mediasoup_announced_ip    = var.mediasoup_announced_ip
  data_volume_device        = var.data_volume_size > 0 ? "sdf" : ""
  # Fetch script at boot to stay under AWS 16KB user_data limit
  script_url = var.script_url != "" ? var.script_url : "https://raw.githubusercontent.com/${var.harborfm_repo}/${var.harborfm_branch}/terraform/user-data/harborfm-user-data.sh"
}

data "aws_subnets" "selected" {
  filter {
    name   = "vpc-id"
    values = [local.vpc_id]
  }
}

data "aws_subnet" "first" {
  id = coalesce(var.subnet_id, tolist(data.aws_subnets.selected.ids)[0])
}

resource "aws_instance" "harborfm" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  key_name                    = var.key_name
  subnet_id                   = data.aws_subnet.first.id
  vpc_security_group_ids      = [aws_security_group.harborfm.id]
  user_data                   = module.userdata.user_data
  user_data_replace_on_change = true

  root_block_device {
    volume_size = var.root_volume_size
  }

  tags = merge(var.tags, {
    Name = var.environment != "" ? "harborfm-${var.environment}-${var.os}-${var.deploy_type}" : "harborfm-${var.os}-${var.deploy_type}"
  })
}

# Persistent data volume: survives destroy so a new instance can reattach (lifecycle prevent_destroy).
# Use the subnet's AZ (not the instance's) so when the instance is replaced the volume is not replaced.
# To destroy it too, remove the lifecycle block and run destroy.
resource "aws_ebs_volume" "data" {
  count             = var.data_volume_size > 0 ? 1 : 0
  availability_zone = data.aws_subnet.first.availability_zone
  size              = var.data_volume_size
  type              = "gp3"

  tags = merge(var.tags, {
    Name = var.environment != "" ? "harborfm-${var.environment}-data" : "harborfm-data"
  })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  count       = var.data_volume_size > 0 ? 1 : 0
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data[0].id
  instance_id = aws_instance.harborfm.id
}

resource "aws_security_group" "harborfm" {
  name_prefix = "harborfm-"
  description = "Harbor FM instance"
  vpc_id      = local.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS"
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_allowed_cidr]
    description = "SSH"
  }

  dynamic "ingress" {
    for_each = var.webrtc_enabled == "1" ? [1] : []
    content {
      from_port   = 41000
      to_port     = 41100
      protocol    = "udp"
      cidr_blocks = ["0.0.0.0/0"]
      description = "WebRTC/mediasoup RTP (required for group call audio)"
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = var.environment != "" ? "harborfm-${var.environment}-sg" : "harborfm-sg"
  })
}

module "cloudflare" {
  source = "../modules/harborfm-cloudflare"

  # Enable only when API token is set and we have a zone (id, name, or domain)
  count = var.cloudflare_api_token != "" && (var.cloudflare_zone_id != "" || var.cloudflare_zone_name != "" || (var.domain != "" && var.domain != "localhost")) && aws_instance.harborfm.public_ip != null ? 1 : 0

  cloudflare_api_token = var.cloudflare_api_token
  cloudflare_zone_id   = var.cloudflare_zone_id
  cloudflare_zone_name = var.cloudflare_zone_name != "" ? var.cloudflare_zone_name : (var.domain != "" && var.domain != "localhost" ? var.domain : "")
  domains              = length(var.domains) > 0 ? var.domains : [var.domain]
  instance_ip          = aws_instance.harborfm.public_ip
}
