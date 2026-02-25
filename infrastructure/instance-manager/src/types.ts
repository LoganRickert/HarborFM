/**
 * Config shape for instance-manager (config.json).
 * Single source of truth for backend and frontend.
 */
export interface ConfigState {
  plan: string;
  os_id: string;
  os: string;
  region: string;
  cloudflare_zone_name: string;
  ssh_allowed_cidr: string;
  ssh_public_key: string;
  backups: string;
  harborfm_repo: string;
  harborfm_branch: string;
  setup_id: string;
  cookie_secure: boolean;
  deploy_type: string;
  data_volume_size: number;
  instance_type: string;
  certbot_email: string;
  script_url: string;
  generate_admin_api_key_by_default: boolean;
  default_admin_email: string;
}

export const DEFAULT_CONFIG: ConfigState = {
  plan: "vhf-2c-2gb",
  os_id: "2136",
  os: "debian-12",
  region: "ewr",
  cloudflare_zone_name: "",
  ssh_allowed_cidr: "192.168.1.1/32",
  ssh_public_key: "",
  backups: "enabled",
  harborfm_repo: "loganrickert/harborfm",
  harborfm_branch: "main",
  setup_id: "",
  cookie_secure: false,
  deploy_type: "pm2",
  data_volume_size: 0,
  instance_type: "t3.small",
  certbot_email: "",
  script_url: "",
  generate_admin_api_key_by_default: true,
  default_admin_email: "",
};
