#!/usr/bin/env bash
# Load .env (if present) and run Helm. Use: ./run.sh install, ./run.sh upgrade, etc.
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

CHART="./harborfm"
RELEASE="${HELM_RELEASE:-harborfm}"

case "${1:-upgrade}" in
  install)
    exec helm install "$RELEASE" "$CHART" -f "${CHART}/values.yaml" "${@:2}"
    ;;
  upgrade)
    exec helm upgrade --install "$RELEASE" "$CHART" -f "${CHART}/values.yaml" "${@:2}"
    ;;
  uninstall)
    exec helm uninstall "$RELEASE" "${@:2}"
    ;;
  *)
    exec helm "${@:-upgrade --install $RELEASE $CHART -f ${CHART}/values.yaml}"
    ;;
esac
