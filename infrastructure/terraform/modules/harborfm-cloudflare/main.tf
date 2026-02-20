terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

locals {
  dns_domains_raw = length(var.domains) > 0 ? var.domains : []
  dns_domains     = [for d in local.dns_domains_raw : trimspace(d) if trimspace(d) != "" && trimspace(d) != "localhost"]
  # Enable when we have a zone (by id or by name) and at least one domain
  cloudflare_enabled = (var.cloudflare_zone_id != "" || (var.cloudflare_zone_name != "" && length(local.dns_domains) > 0)) && length(local.dns_domains) > 0
}

# Look up zone by ID when provided
data "cloudflare_zone" "by_id" {
  count   = var.cloudflare_zone_id != "" ? 1 : 0
  zone_id = var.cloudflare_zone_id
}

# Look up zone by name when zone_id not set (Cloudflare provider v5 uses filter argument)
data "cloudflare_zone" "by_name" {
  count  = var.cloudflare_zone_id == "" && var.cloudflare_zone_name != "" && length(local.dns_domains) > 0 ? 1 : 0
  filter = { name = var.cloudflare_zone_name }
}

locals {
  resolved_zone_id    = var.cloudflare_zone_id != "" ? var.cloudflare_zone_id : (length(data.cloudflare_zone.by_name) > 0 ? data.cloudflare_zone.by_name[0].id : "")
  cloudflare_zone_name = var.cloudflare_zone_id != "" ? data.cloudflare_zone.by_id[0].name : (length(data.cloudflare_zone.by_name) > 0 ? data.cloudflare_zone.by_name[0].name : "")
  dns_record_names   = local.cloudflare_enabled ? distinct(flatten([
    for d in local.dns_domains : (
      trimspace(d) == local.cloudflare_zone_name ? ["@", "www"] : [trimspace(replace(trimspace(d), ".${local.cloudflare_zone_name}", ""))]
    )
  ])) : []
  # FQDN for API: @ -> zone, tfdev -> tfdev.zone
  dns_record_fqdns = [
    for n in local.dns_record_names : (n == "@" ? local.cloudflare_zone_name : "${n}.${local.cloudflare_zone_name}")
  ]
}

# Delete existing A records before create. Cloudflare allows duplicate A records (same name, different IP);
# Terraform cannot reliably update in place. Delete all matching records, then create the new one.
# Module is only invoked when parent has cloudflare_api_token; token is required for the script.
resource "null_resource" "delete_existing_dns_records" {
  for_each = local.cloudflare_enabled ? toset(local.dns_record_fqdns) : toset([])

  provisioner "local-exec" {
    command     = "${path.module}/scripts/delete-cloudflare-a-records.sh"
    when        = create
    environment = {
      CLOUDFLARE_API_TOKEN = var.cloudflare_api_token
      CLOUDFLARE_ZONE_ID   = local.resolved_zone_id
      CLOUDFLARE_FQDN     = each.key
    }
  }

  # Do NOT include instance_ip: we only delete duplicates before initial create.
  # If instance_ip were included, IP changes would recreate this resource, run the delete script
  # (removing the A record), then Terraform would try to PUT-update the now-missing record -> 404.
  triggers = {
    fqdn    = each.key
    zone_id = local.resolved_zone_id
  }
}

resource "cloudflare_dns_record" "a" {
  for_each = local.cloudflare_enabled ? toset(local.dns_record_names) : toset([])
  zone_id  = local.resolved_zone_id
  name     = each.key
  content  = var.instance_ip
  type     = "A"
  ttl      = 1

  depends_on = [null_resource.delete_existing_dns_records]
}
