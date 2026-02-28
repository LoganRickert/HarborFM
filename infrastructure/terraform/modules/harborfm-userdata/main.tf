locals {
  install_dir   = var.install_dir != "" ? var.install_dir : (var.deploy_type == "pm2" ? "/opt/harborfm" : "/opt/harborfm-docker")
  use_flarevault   = var.flarevault_url != "" && var.flarevault_redeem_token != ""
  use_inline_admin = var.flarevault_url == "" || var.flarevault_redeem_token == ""
  user_data_env = <<-EOT
export OS="${var.os}"
export DEPLOY_TYPE="${var.deploy_type}"
export DOMAIN="${var.domain}"
export CERTBOT_EMAIL="${var.certbot_email}"
export SELF_SIGNED_CERT="${var.self_signed_cert}"
export INSTALL_DIR="${local.install_dir}"
export HARBORFM_REPO="${var.harborfm_repo}"
export HARBORFM_BRANCH="${var.harborfm_branch}"
${var.deploy_type == "pm2" ? "export WEBRTC_ENABLED=\"${var.webrtc_enabled}\"" : ""}
${var.deploy_type == "pm2" ? "export REVERSE_PROXY=\"${var.reverse_proxy}\"" : ""}
${var.deploy_type != "pm2" ? "export WEBRTC_ENABLED=\"${var.webrtc_enabled}\"" : ""}
${local.use_flarevault ? "export FLAREVAULT_URL=\"${replace(var.flarevault_url, "\"", "\\\"")}\"" : ""}
${local.use_flarevault ? "export FLAREVAULT_REDEEM_TOKEN=\"${replace(var.flarevault_redeem_token, "\"", "\\\"")}\"" : ""}
${local.use_inline_admin && var.admin_email != "" ? "export ADMIN_EMAIL=\"${var.admin_email}\"" : ""}
${local.use_inline_admin && var.deploy_type == "pm2" && var.admin_email != "" && var.admin_password_hash != "" ? "export ADMIN_PASSWORD_HASH_B64=\"${base64encode(var.admin_password_hash)}\"" : ""}
${local.use_inline_admin && var.deploy_type != "pm2" && var.admin_email != "" && var.admin_password_hash != "" ? "export ADMIN_PASSWORD_HASH='${replace(var.admin_password_hash, "'", "'\\''")}'" : ""}
${var.admin_email != "" || local.use_flarevault ? "export ADMIN_REGISTRATION_ENABLED=\"${var.admin_registration_enabled}\"" : ""}
${var.admin_email != "" || local.use_flarevault ? "export ADMIN_PUBLIC_FEEDS_ENABLED=\"${var.admin_public_feeds_enabled}\"" : ""}
${(var.admin_email != "" || local.use_flarevault) && var.admin_hostname != "" ? "export ADMIN_HOSTNAME=\"${replace(var.admin_hostname, "\"", "\\\"")}\"" : ""}
${var.ssh_public_key != "" ? "export SSH_PUBLIC_KEY_B64=\"${base64encode(var.ssh_public_key)}\"" : ""}
${var.setup_id_export != "" ? "export SETUP_ID=\"${replace(var.setup_id_export, "\"", "\\\"")}\"" : ""}
${var.cookie_secure != "" ? "export COOKIE_SECURE=\"${var.cookie_secure}\"" : ""}
${var.email_provider == "webhook" && var.email_webhook_url != "" ? "export EMAIL_PROVIDER=\"webhook\"" : ""}
${var.email_provider == "webhook" && var.email_webhook_url != "" ? "export EMAIL_WEBHOOK_URL=\"${replace(var.email_webhook_url, "\"", "\\\"")}\"" : ""}
${var.email_provider == "webhook" && var.email_webhook_url != "" ? "export EMAIL_WEBHOOK_FIELD_KEY=\"${replace(var.email_webhook_field_key, "\"", "\\\"")}\"" : ""}
${var.mediasoup_announced_ip != "" ? "export MEDIASOUP_ANNOUNCED_IP=\"${replace(var.mediasoup_announced_ip, "\"", "\\\"")}\"" : ""}
${var.data_volume_device != "" ? "export DATA_VOLUME_DEVICE=\"${var.data_volume_device}\"" : ""}
EOT
  user_data_script = file("${path.module}/../../../user-data/harborfm-user-data.sh")
  # When script_url is set (AWS 16KB limit), output bootstrap only; otherwise inline full script.
  user_data = var.script_url != "" ? "#!/usr/bin/env bash\nset -e\n${local.user_data_env}\nF=/tmp/harborfm-userdata-bootstrap.sh\ncurl -sL \"${var.script_url}\" -o \"$F\" && chmod +x \"$F\" && \"$F\"" : "#!/usr/bin/env bash\n${local.user_data_env}\n${local.user_data_script}"
}
