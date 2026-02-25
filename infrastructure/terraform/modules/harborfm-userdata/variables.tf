variable "os" {
  description = "OS identifier (debian-11, debian-12, debian-13, ubuntu-22, ubuntu-24, ubuntu-25, centos-9, centos-10)"
  type        = string
}

variable "deploy_type" {
  description = "Deploy type: nginx, caddy, or pm2"
  type        = string
}

variable "domain" {
  description = "Primary domain"
  type        = string
  default     = "localhost"
}

variable "certbot_email" {
  type    = string
  default = ""
}

variable "self_signed_cert" {
  type    = string
  default = "0"
}

variable "install_dir" {
  type    = string
  default = ""
}

variable "harborfm_repo" {
  type    = string
  default = "loganrickert/harborfm"
}

variable "harborfm_branch" {
  type    = string
  default = "main"
}

variable "webrtc_enabled" {
  type    = string
  default = "0"
}

variable "reverse_proxy" {
  type    = string
  default = "nginx"
}

variable "admin_email" {
  type    = string
  default = ""
}

variable "admin_password_hash" {
  type    = string
  default = ""
  sensitive = true
}

variable "admin_registration_enabled" {
  type    = string
  default = "0"
}

variable "admin_public_feeds_enabled" {
  type    = string
  default = "1"
}

variable "admin_hostname" {
  type    = string
  default = ""
}

variable "ssh_public_key" {
  type    = string
  default = ""
  sensitive = true
}

variable "setup_id_export" {
  type    = string
  default = ""
}

variable "cookie_secure" {
  type    = string
  default = ""
}

variable "email_provider" {
  type    = string
  default = "none"
}

variable "email_webhook_url" {
  type      = string
  default   = ""
  sensitive = true
}

variable "email_webhook_field_key" {
  type    = string
  default = "content"
}

variable "script_url" {
  description = "When set (e.g. for AWS 16KB user_data limit), output a short bootstrap that fetches and runs the script from this URL instead of inlining it. Leave empty for full inline script (Vultr, etc.)."
  type        = string
  default     = ""
}

variable "mediasoup_announced_ip" {
  description = "Public IP to advertise for mediasoup (MEDIASOUP_ANNOUNCED_IP). When set, passed into user-data; when empty, the script auto-detects (metadata/ifconfig). Use e.g. Elastic IP or terraform output -raw public_ip when you know it."
  type        = string
  default     = ""
}

variable "data_volume_device" {
  description = "Block device name for persistent data volume (e.g. sdf). When set, user-data mounts it at /mnt/harborfm-data and uses it for DATA_DIR, SECRETS_DIR, WEBRTC_DIR. Empty = use default paths on root."
  type        = string
  default     = ""
}

variable "flarevault_url" {
  description = "FlareVault base URL including route prefix. When set with flarevault_redeem_token, script redeems at boot instead of using inline admin creds."
  type        = string
  default     = ""
}

variable "flarevault_redeem_token" {
  description = "FlareVault redeem token. When set with flarevault_url, script redeems at boot to get admin creds."
  type        = string
  default     = ""
  sensitive   = true
}
