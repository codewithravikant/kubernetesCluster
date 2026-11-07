#!/usr/bin/env bash
# One-click: Minikube + app + monitoring + logging + Jenkins
set -euo pipefail
# shellcheck source=_common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
lab_ui_log_tee "${ROOT}/logs/chronicles-ui.log"

install_tools() {
  write_progress "tools" "running" "Checking minikube, kubectl, helm"
  if ! command -v minikube >/dev/null 2>&1; then
    log "Installing minikube..."
    if [[ "$(uname -s)" == "Darwin" ]]; then
      if command -v brew >/dev/null 2>&1; then
        brew install minikube
      else
        curl -Lo /tmp/minikube https://storage.googleapis.com/minikube/releases/latest/minikube-darwin-"$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')"
        chmod +x /tmp/minikube
        sudo mv /tmp/minikube /usr/local/bin/minikube
      fi
    else
      curl -Lo /tmp/minikube https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
      chmod +x /tmp/minikube
      sudo mv /tmp/minikube /usr/local/bin/minikube
    fi
  fi
  if ! command -v kubectl >/dev/null 2>&1; then
    log "Installing kubectl..."
    if command -v brew >/dev/null 2>&1; then
      brew install kubectl
    else
      curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
      chmod +x kubectl && sudo mv kubectl /usr/local/bin/
    fi
  fi
  if ! command -v helm >/dev/null 2>&1; then
    log "Installing helm..."
    if command -v brew >/dev/null 2>&1; then
      brew install helm
    else
      curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    fi
  fi
  need_cmd docker
  need_cmd minikube
  need_cmd kubectl
  need_cmd helm
}

start_minikube() {
  validate_cluster_yml
  local profile cpus mem disk driver docker_cpus
  profile="$(cluster_profile)"
  cpus="$(cluster_cpus)"
  mem="$(cluster_memory_mb)"
  disk="$(cluster_disk_gb)g"
  driver="$(cluster_driver)"

  docker_cpus="$(docker info --format '{{.NCPU}}' 2>/dev/null || echo "$cpus")"
  if [[ "$docker_cpus" =~ ^[0-9]+$ ]] && (( cpus > docker_cpus )); then
    log "Clamping cpus ${cpus} → ${docker_cpus} (Docker Desktop available CPUs)"
    cpus="$docker_cpus"
  fi

  write_progress "minikube" "running" "Starting profile ${profile} (${cpus} CPU, ${mem} MB, disk ${disk})"
  if minikube status -p "$profile" >/dev/null 2>&1; then
    log "Minikube profile ${profile} already exists — ensuring it is running"
    minikube start -p "$profile" --cpus="$cpus" --memory="$mem" || true
  else
    minikube start \
      -p "$profile" \
      --driver="$driver" \
      --cpus="$cpus" \
      --memory="$mem" \
      --disk-size="$disk" \
      --kubernetes-version=stable
  fi
  minikube profile "$profile"
  minikube addons enable ingress -p "$profile"
  minikube addons enable metrics-server -p "$profile"
  # ES often needs this on the node
  minikube ssh -p "$profile" -- "sudo sysctl -w vm.max_map_count=262144" || true
}

build_images() {
  write_progress "images" "running" "Building chronicles-backend and chronicles-frontend into Minikube"
  local profile
  profile="$(cluster_profile)"
  # Default runtime is containerd. `minikube docker-env` is experimental there:
  # Docker Buildx falls back to a BuildKit container, and nerdctld returns 404
  # when that image is inspected. `minikube image build` uses in-cluster buildctl.
  minikube -p "$profile" image build -t chronicles-backend:latest "${ROOT}/app/backend"
  minikube -p "$profile" image build -t chronicles-frontend:latest "${ROOT}/app/frontend"
}

apply_secrets() {
  write_progress "secrets" "running" "Generating app secrets"
  local token pass
  token="$(openssl rand -hex 16)"
  pass="$(openssl rand -hex 12)"
  kubectl create namespace app --dry-run=client -o yaml | kubectl apply -f -
  kubectl create secret generic app-secrets \
    -n app \
    --from-literal=API_TOKEN="$token" \
    --from-literal=DB_PASSWORD="$pass" \
    --dry-run=client -o yaml | kubectl apply -f -
}

apply_base() {
  write_progress "manifests" "running" "Applying storage, security, app, logging"
  kubectl apply -k "${ROOT}/manifests/storage"
  kubectl apply -k "${ROOT}/manifests/security"
  # App without ServiceMonitor first (CRD may not exist yet)
  kubectl apply -f "${ROOT}/manifests/app/namespace.yaml"
  kubectl apply -f "${ROOT}/manifests/app/backend-pvc.yaml"
  kubectl apply -f "${ROOT}/manifests/app/backend-deployment.yaml"
  kubectl apply -f "${ROOT}/manifests/app/backend-service.yaml"
  kubectl apply -f "${ROOT}/manifests/app/frontend-deployment.yaml"
  kubectl apply -f "${ROOT}/manifests/app/frontend-service.yaml"
  kubectl apply -f "${ROOT}/manifests/app/ingress.yaml"
  kubectl apply -f "${ROOT}/manifests/app/hpa.yaml"
  kubectl apply -k "${ROOT}/manifests/logging"
}

install_monitoring() {
  write_progress "monitoring" "running" "Installing kube-prometheus-stack"
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts >/dev/null
  helm repo update >/dev/null
  helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
    -n monitoring --create-namespace \
    -f "${ROOT}/manifests/monitoring/kube-prometheus-values.yaml" \
    --wait --timeout 15m
  kubectl apply -f "${ROOT}/manifests/monitoring/prometheus-rules.yaml"
  kubectl apply -f "${ROOT}/manifests/monitoring/grafana-dashboards.yaml"
  kubectl apply -f "${ROOT}/manifests/monitoring/elasticsearch-servicemonitor.yaml"
  kubectl apply -f "${ROOT}/manifests/monitoring/elasticsearch-exporter.yaml"
  kubectl apply -f "${ROOT}/manifests/app/servicemonitor.yaml" || true
  "${ROOT}/scripts/enable-ingress-monitor.sh"
}

apply_jenkins_local_ci() {
  local profile dest
  profile="$(cluster_profile)"
  dest="/mnt/data/chronicles-src"

  kubectl create namespace cicd --dry-run=client -o yaml | kubectl apply -f -
  kubectl create configmap jenkins-pipelines \
    -n cicd \
    --from-file=Jenkinsfile="${ROOT}/cicd/Jenkinsfile" \
    --from-file=Jenkinsfile.rollback="${ROOT}/cicd/Jenkinsfile.rollback" \
    --dry-run=client -o yaml | kubectl apply -f -
  log "ConfigMap cicd/jenkins-pipelines updated from cicd/"

  minikube ssh -p "$profile" -- "sudo rm -rf '${dest}' && sudo mkdir -p '${dest}' && sudo chmod 777 '${dest}'"
  tar -C "${ROOT}" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist' \
    -cf - app scripts \
    | minikube ssh -p "$profile" -- "tar -C '${dest}' -xf - && sudo chmod -R a+rX '${dest}'"
  log "Synced local app/scripts to Minikube ${dest} (no remote SCM)"
}

prepare_jenkins_volume() {
  local profile
  profile="$(cluster_profile)"
  # pv-jenkins is a hostPath. DirectoryOrCreate makes it root:root, and the
  # Jenkins image writes as uid 1000, so the init container crash-loops.
  minikube ssh -p "$profile" -- "sudo mkdir -p /mnt/data/jenkins && sudo chown -R 1000:1000 /mnt/data/jenkins && sudo chmod 775 /mnt/data/jenkins"
}

install_cicd() {
  write_progress "cicd" "running" "Installing registry + Jenkins"
  apply_jenkins_local_ci
  kubectl apply -f "${ROOT}/manifests/cicd/registry.yaml"
  helm repo add jenkins https://charts.jenkins.io >/dev/null
  helm repo update >/dev/null
  if ! kubectl get pvc jenkins -n cicd >/dev/null 2>&1; then
    kubectl apply -f "${ROOT}/manifests/storage/pvs.yaml"
    kubectl apply -f "${ROOT}/manifests/storage/pvcs.yaml"
  fi
  prepare_jenkins_volume
  # Keep the pre-created claim. Clearing existingClaim makes Helm try to adopt
  # that PVC and fail ownership checks.
  helm upgrade --install jenkins jenkins/jenkins \
    -n cicd --create-namespace \
    -f "${ROOT}/manifests/cicd/jenkins-values.yaml" \
    --set persistence.existingClaim=jenkins \
    --wait --timeout 15m
  fix_jenkins_plugin_copy
  "${ROOT}/scripts/configure-registry-pull.sh"
}

# The Jenkins chart copies plugins with `yes n | cp -i`. GNU cp exits 1 when
# the files already exist, so the init container crash-loops on every restart.
fix_jenkins_plugin_copy() {
  kubectl -n cicd get configmap jenkins -o json | python3 -c '
import json, sys
doc = json.load(sys.stdin)
script = doc["data"].get("apply_config.sh", "")
fixed = script.replace("yes n | cp -i ", "cp -f ")
if fixed == script:
    sys.exit(0)
doc["data"]["apply_config.sh"] = fixed
json.dump(doc, sys.stdout)
' | kubectl apply -f -
  log "Jenkins init copies plugins with cp -f so a restart does not crash"
}

wait_rollouts() {
  write_progress "ready" "running" "Waiting for rollouts"
  kubectl rollout status deployment/backend -n app --timeout=300s
  kubectl rollout status deployment/frontend -n app --timeout=300s
  kubectl wait --for=condition=ready pod -l app=elasticsearch -n logging --timeout=300s || true
  kubectl wait --for=condition=ready pod -l app=kibana -n logging --timeout=300s || true
}

print_urls() {
  local ip
  ip="$(minikube ip -p "$(cluster_profile)" 2>/dev/null || echo "127.0.0.1")"
  log "Cluster is ready."
  log "Dashboard: http://127.10.10.10:3030"
  log "Ingress: http://chronicles.local/  address ${ip}  (frontend:80, two endpoints)"
  log "  curl -H 'Host: chronicles.local' http://${ip}/"
  log "Grafana, Prometheus, Kibana, and Jenkins stay on their ClusterIP Services."
  write_progress "ready" "done" "Cluster is ready"
}

main() {
  mkdir -p "${ROOT}/logs"
  install_tools
  start_minikube
  build_images
  apply_secrets
  apply_base
  install_monitoring
  install_cicd
  wait_rollouts
  "${ROOT}/scripts/host-forwards.sh" start || true
  print_urls
}

main "$@"
