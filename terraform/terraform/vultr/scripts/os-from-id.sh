#!/usr/bin/env bash
# Derive Harbor FM os identifier (debian-12, ubuntu-22, ubuntu-25, centos-9, etc.) from Vultr os_id.
# Reads os_id from stdin (JSON query from Terraform external data).
# Outputs JSON: {"os": "debian-12"} or {"os": "", "error": "..."}
# Requires: curl, jq, VULTR_API_KEY in environment
set -e

API_KEY="${VULTR_API_KEY:-}"
[ -z "$API_KEY" ] && echo "{\"os\":\"\",\"error\":\"VULTR_API_KEY not set\"}" && exit 1

# Terraform external passes query as JSON on stdin
query="$(cat)"
os_id="$(echo "$query" | jq -r '.os_id // empty')"
[ -z "$os_id" ] && echo "{\"os\":\"\",\"error\":\"os_id required\"}" && exit 1

# Fetch OS list from Vultr API (paginate to find os_id)
name=""
cursor=""
while true; do
  if [ -n "$cursor" ]; then
    resp="$(curl -s -H "Authorization: Bearer $API_KEY" "https://api.vultr.com/v2/os?per_page=100&cursor=$cursor")"
  else
    resp="$(curl -s -H "Authorization: Bearer $API_KEY" "https://api.vultr.com/v2/os?per_page=100")"
  fi
  name="$(echo "$resp" | jq -r --arg id "$os_id" '
    (.os // [])[] |
    select(.id == ($id | tonumber) or (.id | tostring) == $id) |
    .name
  ' | head -1)"
  [ -n "$name" ] && break
  next="$(echo "$resp" | jq -r '.meta.links.next // empty')"
  [ -z "$next" ] && break
  cursor="$(echo "$next" | sed -n 's/.*cursor=\([^&"]*\).*/\1/p')"
  [ -z "$cursor" ] && break
done
[ -z "$name" ] && echo "{\"os\":\"\",\"error\":\"os_id $os_id not found in Vultr API\"}" && exit 1

# Map Vultr name to Harbor FM os format (debian-11, debian-12, ubuntu-22, ubuntu-24, centos-9)
case "$name" in
  Debian\ 11*)     os="debian-11" ;;
  Debian\ 12*)     os="debian-12" ;;
  Debian\ 13*)     os="debian-13" ;;
  Ubuntu\ 22*)     os="ubuntu-22" ;;
  Ubuntu\ 24*)     os="ubuntu-24" ;;
  Ubuntu\ 25*)     os="ubuntu-25" ;;
  CentOS\ 9*|CentOS\ Stream\ 9*)  os="centos-9" ;;
  CentOS\ 10*|CentOS\ Stream\ 10*) os="centos-10" ;;
  Rocky\ 9*)       os="centos-9" ;;
  AlmaLinux\ 9*)   os="centos-9" ;;
  *)
    # Fallback: try to derive (e.g. "Debian 12 x64" -> debian-12)
    lower="$(echo "$name" | tr '[:upper:]' '[:lower:]')"
    if echo "$lower" | grep -q 'debian 11'; then os="debian-11"
    elif echo "$lower" | grep -q 'debian 12'; then os="debian-12"
    elif echo "$lower" | grep -q 'debian 13'; then os="debian-13"
    elif echo "$lower" | grep -q 'ubuntu 22'; then os="ubuntu-22"
    elif echo "$lower" | grep -q 'ubuntu 24'; then os="ubuntu-24"
    elif echo "$lower" | grep -q 'ubuntu 25'; then os="ubuntu-25"
    elif echo "$lower" | grep -q 'centos 9\|centos stream 9\|rocky 9\|almalinux 9'; then os="centos-9"
    elif echo "$lower" | grep -q 'centos 10'; then os="centos-10"
    else
      echo "{\"os\":\"\",\"error\":\"Unknown OS: $name\"}" && exit 1
    fi
    ;;
esac

echo "{\"os\":\"$os\"}"
