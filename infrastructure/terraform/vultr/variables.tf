# Vultr-specific variables. Shared variables are in variables-shared.tf (symlink to ../common/).

variable "region" {
  description = "Vultr region ID (e.g. ewr, lax, sfo)"
  type        = string
}

variable "plan" {
  description = "Vultr plan ID (e.g. vc2-1c-1gb)"
  type        = string
  default     = "vc2-1c-1gb"
}

variable "os_id" {
  description = "Vultr OS image ID. os (debian-12, ubuntu-22, etc.) is derived via Vultr API at plan time. See: curl -s -H 'Authorization: Bearer $VULTR_API_KEY' https://api.vultr.com/v2/os | jq '.os[] | {id, name}'"
  type        = string
}

variable "label" {
  description = "Label for the instance"
  type        = string
  default     = ""
}

variable "ssh_key_ids" {
  description = "List of Vultr SSH key IDs (UUIDs) to add to the instance. Use ssh_public_key instead to pass the raw key."
  type        = list(string)
  default     = []
}

variable "backups" {
  description = "Vultr automatic backups: enabled (default), disabled, or schedule"
  type        = string
  default     = "enabled"
}
