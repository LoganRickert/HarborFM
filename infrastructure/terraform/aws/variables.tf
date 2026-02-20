# AWS-specific variables. Shared variables are in variables-shared.tf (symlink to ../common/).

variable "ami_id" {
  description = "AMI ID for the instance (must match os; e.g. Debian 12 for debian-12)"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "root_volume_size" {
  description = "Size in GB of the root EBS volume (OS only)"
  type        = number
  default     = 8
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-2"
}

variable "key_name" {
  description = "Name of the EC2 key pair for SSH access"
  type        = string
  default     = null
}

variable "vpc_id" {
  description = "VPC ID; if null, default VPC is used"
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Subnet ID; if null, default subnet in the VPC is used"
  type        = string
  default     = null
}

variable "backups" {
  description = "Ignored on AWS (Vultr-only). Present to avoid undeclared variable warnings when using shared tfvars."
  type        = string
  default     = "disabled"
}

variable "tags" {
  description = "Tags to apply to the instance"
  type        = map(string)
  default     = {}
}

variable "environment" {
  description = "Environment label (e.g. dev, prod). When set, included in instance/sg Name tag so multiple deployments are easy to tell apart in the console."
  type        = string
  default     = ""
}
