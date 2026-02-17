terraform {
  required_providers {
    vultr = {
      source  = "vultr/vultr"
      version = "~> 2.0"
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

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

data "external" "admin_password_hash" {
  count = var.admin_email != "" && var.admin_password != "" ? 1 : 0
  program = ["sh", "-c", "cd ${path.module}/../../../server && node scripts/hash-admin-password.mjs"]
  query = {
    password = var.admin_password
  }
}

# Derive os (debian-12, ubuntu-22, ubuntu-25, centos-9, etc.) from Vultr os_id via API
data "external" "os_from_id" {
  program = ["bash", "${path.module}/scripts/os-from-id.sh"]
  query = {
    os_id = var.os_id
  }
}

resource "random_id" "setup_id" {
  count       = var.admin_email == "" && var.setup_id == "" ? 1 : 0
  byte_length = 16
}

locals {
  admin_password_hash = length(data.external.admin_password_hash) > 0 ? data.external.admin_password_hash[0].result.hash : ""
  setup_id_export    = var.setup_id != "" ? var.setup_id : (var.admin_email != "" ? "" : random_id.setup_id[0].hex)
  os_derived         = data.external.os_from_id.result.os
  label              = var.label != "" ? var.label : "harborfm-${local.os_derived}-${var.deploy_type}"
  # Parse SSH CIDR for firewall rule (e.g. 0.0.0.0/0 -> subnet 0.0.0.0, size 0)
  ssh_cidr_parts    = split("/", var.ssh_allowed_cidr)
  ssh_fw_subnet     = length(local.ssh_cidr_parts) == 2 ? local.ssh_cidr_parts[0] : "0.0.0.0"
  ssh_fw_subnet_size = length(local.ssh_cidr_parts) == 2 ? tonumber(local.ssh_cidr_parts[1]) : 0
}

module "userdata" {
  source = "../modules/harborfm-userdata"

  os                       = local.os_derived
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
  data_volume_device        = var.data_volume_size > 0 ? "vdb" : ""
  # When set: fetch script at boot (useful for custom URLs or large scripts). Empty = inline full script.
  script_url = var.script_url
}

resource "vultr_firewall_group" "harborfm" {
  description = "Harbor FM instance firewall"
}

resource "vultr_firewall_rule" "http" {
  firewall_group_id = vultr_firewall_group.harborfm.id
  protocol          = "tcp"
  ip_type           = "v4"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  port              = "80"
  notes             = "HTTP"
}

resource "vultr_firewall_rule" "https" {
  firewall_group_id = vultr_firewall_group.harborfm.id
  protocol          = "tcp"
  ip_type           = "v4"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  port              = "443"
  notes             = "HTTPS"
}

resource "vultr_firewall_rule" "ssh" {
  firewall_group_id = vultr_firewall_group.harborfm.id
  protocol          = "tcp"
  ip_type           = "v4"
  subnet            = local.ssh_fw_subnet
  subnet_size       = local.ssh_fw_subnet_size
  port              = "22"
  notes             = "SSH"
}

resource "vultr_firewall_rule" "webrtc" {
  count             = var.webrtc_enabled == "1" ? 1 : 0
  firewall_group_id = vultr_firewall_group.harborfm.id
  protocol          = "udp"
  ip_type           = "v4"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  port              = "41000:41100"
  notes             = "WebRTC/mediasoup RTP"
}

resource "vultr_instance" "harborfm" {
  region            = var.region
  plan              = var.plan
  os_id             = var.os_id
  label             = local.label
  user_data         = module.userdata.user_data
  ssh_key_ids       = length(var.ssh_key_ids) > 0 ? var.ssh_key_ids : null
  backups           = var.backups
  firewall_group_id = vultr_firewall_group.harborfm.id
}

# Persistent data block storage: survives destroy so a new instance can reattach (lifecycle prevent_destroy).
# Same region as instance; attached at boot; user-data mounts at /mnt/harborfm-data.
# To destroy it too, remove the lifecycle block and run destroy.
resource "vultr_block_storage" "data" {
  count                  = var.data_volume_size > 0 ? 1 : 0
  region                 = var.region
  size_gb                = var.data_volume_size
  label                  = local.label
  attached_to_instance   = vultr_instance.harborfm.id

  lifecycle {
    prevent_destroy = true
  }
}

module "cloudflare" {
  source = "../modules/harborfm-cloudflare"

  # Enable only when API token is set and we have a zone (id, name, or domain)
  count = var.cloudflare_api_token != "" && (var.cloudflare_zone_id != "" || var.cloudflare_zone_name != "" || (var.domain != "" && var.domain != "localhost")) ? 1 : 0

  cloudflare_api_token = var.cloudflare_api_token
  cloudflare_zone_id   = var.cloudflare_zone_id
  cloudflare_zone_name = var.cloudflare_zone_name != "" ? var.cloudflare_zone_name : (var.domain != "" && var.domain != "localhost" ? var.domain : "")
  domains              = length(var.domains) > 0 ? var.domains : [var.domain]
  instance_ip          = vultr_instance.harborfm.main_ip
}
