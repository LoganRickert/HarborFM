export const VULTR_OS_OPTIONS = [
  { value: "477", label: "Debian 11" },
  { value: "2136", label: "Debian 12" },
  { value: "2625", label: "Debian 13" },
  { value: "1743", label: "Ubuntu 22" },
  { value: "2284", label: "Ubuntu 24" },
  { value: "2657", label: "Ubuntu 25" },
  { value: "542", label: "CentOS 9" },
  { value: "2467", label: "CentOS 10" },
] as const;

export const AWS_OS_OPTIONS = [
  { value: "debian-11", label: "Debian 11" },
  { value: "debian-12", label: "Debian 12" },
  { value: "debian-13", label: "Debian 13" },
  { value: "ubuntu-22", label: "Ubuntu 22" },
  { value: "ubuntu-24", label: "Ubuntu 24" },
  { value: "ubuntu-25", label: "Ubuntu 25" },
  { value: "centos-9", label: "CentOS 9" },
  { value: "centos-10", label: "CentOS 10" },
] as const;

export const VULTR_REGIONS = ["ewr", "lax", "sfo", "ord", "dfw", "sea", "atl", "ams", "fra", "sjc", "syd"] as const;
export const AWS_REGIONS = ["us-east-1", "us-east-2", "us-west-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-northeast-1"] as const;
