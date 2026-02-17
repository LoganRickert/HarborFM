module "outputs" {
  source = "../modules/harborfm-outputs"

  public_ip       = aws_instance.harborfm.public_ip
  deploy_type     = var.deploy_type
  setup_id_export = local.setup_id_export
  domain          = var.domain
  use_https       = var.domain != "" && var.domain != "localhost" && var.domain != "_" && (var.certbot_email != "" || var.self_signed_cert == "1")
}

output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.harborfm.id
}

output "public_ip" {
  description = "Public IP of the instance"
  value       = aws_instance.harborfm.public_ip
}

output "public_dns" {
  description = "Public DNS name of the instance"
  value       = aws_instance.harborfm.public_dns
}

output "url" {
  description = "App URL (use https if domain is set and cert is ready)"
  value       = module.outputs.url
}

output "setup_id" {
  description = "Setup token for /setup?id=... (required when admin_email is not set; generated randomly if not provided). Use: terraform output -raw setup_id"
  value       = local.setup_id_export != "" ? local.setup_id_export : null
  sensitive   = true
}

output "setup_url" {
  description = "Full setup URL when admin_email was not set. Use this to complete initial setup. Use: terraform output -raw setup_url"
  value       = module.outputs.setup_url
  sensitive   = true
}
