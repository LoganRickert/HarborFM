variable "public_ip" {
  description = "Instance public IP"
  type        = string
}

variable "deploy_type" {
  description = "Deploy type (pm2, nginx, caddy); used for display only"
  type        = string
}

variable "setup_id_export" {
  description = "Setup token for /setup URL"
  type        = string
  default     = ""
}

variable "domain" {
  description = "Primary domain; when set and not localhost/_, URL uses this as host instead of public_ip"
  type        = string
  default     = ""
}

variable "use_https" {
  description = "When true, URL uses https (e.g. domain has certbot or self-signed cert)"
  type        = bool
  default     = false
}
