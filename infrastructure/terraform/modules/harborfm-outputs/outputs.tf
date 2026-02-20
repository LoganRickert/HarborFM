locals {
  # Host for URL: domain if set and real, else public IP (app is reached via reverse proxy 80/443, not :3001)
  url_host = (var.domain != "" && var.domain != "localhost" && var.domain != "_") ? var.domain : var.public_ip
  scheme   = var.use_https ? "https" : "http"
}

output "url" {
  description = "App URL: http(s)://<host>/ with host = domain or public IP; https when cert is configured"
  value       = "${local.scheme}://${local.url_host}/"
}

output "setup_url" {
  description = "Full setup URL when admin_email was not set"
  value       = var.setup_id_export != "" ? "${local.scheme}://${local.url_host}/setup?id=${var.setup_id_export}" : null
}
