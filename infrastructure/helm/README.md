# Helm

Helm charts for deploying HarborFM to Kubernetes.

## Chart

- **[harborfm/](harborfm/)** – Main chart: HarborFM app, Whisper ASR, optional WebRTC. Ingress-based; no nginx/caddy pods. Works on local, AWS EKS, and Vultr VKE.

## Quick start

```bash
# From this directory
helm upgrade --install harborfm ./harborfm -f harborfm/values.yaml

# With custom values (see harborfm/values.example.yaml)
helm upgrade --install harborfm ./harborfm -f harborfm/values.yaml -f myvalues.yaml
```

Optional: use `run.sh` to load `.env` and run helm (similar to Terraform’s run.sh):

```bash
./run.sh upgrade
```

See [harborfm/README.md](harborfm/README.md) for full options and TLS/persistence notes.
