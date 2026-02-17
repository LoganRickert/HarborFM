variable "cloudflare_api_token" {
  description = "Cloudflare API token (for deleting existing records before create). Required when cloudflare_enabled."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID (optional if cloudflare_zone_name is set)"
  type        = string
  default     = ""
}

variable "cloudflare_zone_name" {
  description = "Cloudflare zone name (e.g. example.com). Looked up via API when zone_id is not set."
  type        = string
  default     = ""
}

variable "domains" {
  description = "List of domains for A records"
  type        = list(string)
}

variable "instance_ip" {
  description = "Instance public IP for A records"
  type        = string
}
