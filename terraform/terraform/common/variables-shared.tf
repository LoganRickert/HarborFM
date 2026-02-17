# Shared variables across AWS, Vultr, and future providers.
# This file is included via symlink from each provider directory.

variable "os" {
  description = "OS identifier; must match the user-data script (debian-11, debian-12, debian-13, ubuntu-22, ubuntu-24, ubuntu-25, centos-9, centos-10)"
  type        = string
  default     = "debian-12"
}

variable "deploy_type" {
  description = "Deploy type: nginx, caddy, or pm2"
  type        = string
}

variable "domain" {
  description = "Primary domain for the app (passed to user-data, used for certbot). When domains is empty, also used for Cloudflare DNS."
  type        = string
  default     = "localhost"
}

variable "domains" {
  description = "List of domains for Cloudflare A records (e.g. [\"www.example.com\", \"example.com\"]). Root domains get both @ and www. When empty, uses [domain]. Requires cloudflare_api_token."
  type        = list(string)
  default     = []
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token. When set with a zone (by id or name), creates/updates A records for domains pointing to the instance IP. Leave empty to skip."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID (optional). If not set, zone is looked up by cloudflare_zone_name (defaults to domain)."
  type        = string
  default     = ""
}

variable "cloudflare_zone_name" {
  description = "Cloudflare zone name (e.g. example.com). Looked up via API when zone_id is not set. Defaults to domain when empty."
  type        = string
  default     = ""
}

variable "certbot_email" {
  description = "Email for Let's Encrypt (nginx profile). Leave empty for HTTP or use self_signed_cert for HTTPS."
  type        = string
  default     = ""
}

variable "self_signed_cert" {
  description = "When certbot_email is blank: use self-signed cert for HTTPS (1) or HTTP only (0, default)."
  type        = string
  default     = "0"
}

variable "install_dir" {
  description = "Install directory on the instance (passed to user-data)"
  type        = string
  default     = ""
}

variable "harborfm_repo" {
  description = "GitHub repo for Harbor FM (owner/name)"
  type        = string
  default     = "loganrickert/harborfm"
}

variable "harborfm_branch" {
  description = "Branch to use for configs/clone"
  type        = string
  default     = "main"
}

variable "script_url" {
  description = "Override URL for user-data script (fetched at boot). Empty = inline full script (Vultr) or use default GitHub raw URL (AWS 16KB limit). Set to use a custom URL."
  type        = string
  default     = ""
}

variable "ssh_public_key" {
  description = "Raw SSH public key (e.g. ssh-rsa AAAAB3... user@host). Added to root/harborfm authorized_keys on first boot. Alternative or addition to key_name/ssh_key_ids."
  type        = string
  default     = ""
  sensitive   = true
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to connect via SSH (port 22). Default 192.168.1.1/32 effectively closes SSH; set e.g. 0.0.0.0/0 to allow all or 1.2.3.4/32 for your IP only."
  type        = string
  default     = "192.168.1.1/32"
}

variable "setup_id" {
  description = "Pre-set setup token for /setup?id=... URL. When admin_email is not set, a setup_id is required-provide one here or leave empty to have Terraform generate a random one (shown in outputs). When admin_email is set, leave empty to skip setup token."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cookie_secure" {
  description = "Set cookie Secure flag. false = allow HTTP; true or empty = Secure cookies for HTTPS."
  type        = string
  default     = ""
}

variable "admin_email" {
  description = "Admin email for bootstrap. When set with admin_password, creates admin on first boot."
  type        = string
  default     = ""
}

variable "admin_password" {
  description = "Admin password (hashed before sending). Requires admin_email."
  type        = string
  default     = ""
  sensitive   = true
}

variable "admin_registration_enabled" {
  description = "When bootstrapping admin: allow new account registration. 1 = enabled, 0 = disabled."
  type        = string
  default     = "0"
}

variable "admin_public_feeds_enabled" {
  description = "When bootstrapping admin: allow public podcast feeds. 1 = enabled, 0 = disabled."
  type        = string
  default     = "1"
}

variable "admin_hostname" {
  description = "When bootstrapping admin: public base URL (e.g. https://podcasts.example.com). Empty = derive from domain."
  type        = string
  default     = ""
}

variable "webrtc_enabled" {
  description = "Enable WebRTC/group calls. 1 = enabled, 0 (default) = disabled."
  type        = string
  default     = "0"

  validation {
    condition     = contains(["0", "1"], var.webrtc_enabled)
    error_message = "webrtc_enabled must be \"0\" or \"1\"."
  }
}

variable "mediasoup_announced_ip" {
  description = "Public IP for mediasoup (MEDIASOUP_ANNOUNCED_IP). When set, passed into user-data; when empty, the script auto-detects at boot. Use e.g. your Elastic IP if known."
  type        = string
  default     = ""
}

variable "reverse_proxy" {
  description = "Reverse proxy for PM2: nginx (default) or caddy"
  type        = string
  default     = "nginx"
}

variable "email_provider" {
  description = "Email provider for sending mail. none (default) or webhook. When webhook, set email_webhook_url."
  type        = string
  default     = "none"
}

variable "email_webhook_url" {
  description = "Webhook URL for email (when email_provider = webhook). Server POSTs { [email_webhook_field_key]: \"Subject: ...\\n\\nBody\" }. Often contains secrets; use -var or TF_VAR to avoid tfvars."
  type        = string
  default     = ""
  sensitive   = true
}

variable "email_webhook_field_key" {
  description = "JSON key for webhook body (default content). Use 'content' for Discord."
  type        = string
  default     = "content"
}

variable "data_volume_size" {
  description = "Size in GB of the persistent data volume (data, secrets, webrtc). When > 0, a volume is attached and user-data mounts it; survives destroy so a new instance can reattach. Set to 0 to use root disk only."
  type        = number
  default     = 20
}
