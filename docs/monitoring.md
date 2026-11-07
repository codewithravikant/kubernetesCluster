# Monitoring, logging, alerting

## Stack

- **Prometheus Operator** via kube-prometheus-stack ([`manifests/monitoring/kube-prometheus-values.yaml`](../manifests/monitoring/kube-prometheus-values.yaml))
- **ServiceMonitor** on backend `/metrics/prom` ([`manifests/app/servicemonitor.yaml`](../manifests/app/servicemonitor.yaml))
- Retention **15 days**
- **Grafana** dashboards: Cluster Performance (CPU, memory, pods, Disk I/O), Pod and Container (CPU, memory, restarts, network), Application Performance ([`manifests/monitoring/grafana-dashboards.yaml`](../manifests/monitoring/grafana-dashboards.yaml)), and Ingress ([`manifests/monitoring/ingress-dashboard.yaml`](../manifests/monitoring/ingress-dashboard.yaml))
- **Ingress**: controller metrics ServiceMonitor on port 10254 ([`manifests/monitoring/ingress-nginx-metrics.yaml`](../manifests/monitoring/ingress-nginx-metrics.yaml)) and blackbox probes for `http://chronicles.local/`, `/api/health`, and DNS ([`manifests/monitoring/ingress-blackbox.yaml`](../manifests/monitoring/ingress-blackbox.yaml)). `scripts/enable-ingress-monitor.sh` turns metrics on and publishes the hostname inside the cluster
- **EFK**: Elasticsearch StatefulSet ×2, Fluent Bit DaemonSet, Kibana
- Fluent Bit writes through write alias **`chronicles`** (ILM-managed `chronicles-*` indices)
- ILM policy `chronicles-logs-policy` — rollover + delete after **14 days** ([`manifests/logging/ilm-job.yaml`](../manifests/logging/ilm-job.yaml))
- **Kibana** dashboards imported by Job [`manifests/logging/kibana-dashboards.yaml`](../manifests/logging/kibana-dashboards.yaml): Cluster / Application / Pod and Container Logs
- **elasticsearch-exporter** scrapes cluster health for `ElasticsearchYellow` and `ElasticsearchRed` ([`manifests/monitoring/elasticsearch-exporter.yaml`](../manifests/monitoring/elasticsearch-exporter.yaml))
- Observe UI searches `chronicles*` with Fluent Bit `kubernetes.*` / `level` fields

## Alert rules

Defined in [`manifests/monitoring/prometheus-rules.yaml`](../manifests/monitoring/prometheus-rules.yaml). Alertmanager groups by `alertname` + `namespace` with `group_wait` / long `repeat_interval` to reduce fatigue. Alerts stay in-cluster (Prometheus / Alertmanager / Grafana); there is no external webhook.

| Alert | Demo idea |
|-------|-----------|
| Node CPU > 80% 5m | `minikube ssh -- stress-ng --cpu 4 --timeout 360s` (size to free CPU) |
| Disk < 20% | `minikube ssh` + `fallocate` sized from `df` |
| Memory > 90% 5m | `stress-ng --vm` sized from free mem inside the node |
| Pod restarts > 3 / 15m | `kubectl apply -f manifests/testing/crashloop-pod.yaml` |
| Container mem > 80% limit | `kubectl apply -f manifests/testing/memory-hog.yaml` |
| Pending > 5m | `kubectl apply -f manifests/testing/pending-pod.yaml` |
| API server down | stop/pause API briefly (careful) or block scrape |
| Elasticsearch yellow/red | `kubectl delete pod elasticsearch-1 -n logging` (2 replicas); needs exporter scraped |
| Fluent Bit errors | patch ConfigMap Path to a bad path, then restore |
| Jenkins off | `kubectl scale statefulset jenkins -n cicd --replicas=0`, then restore |
| Jenkins crash | force CrashLoopBackOff on `jenkins-0`, then restore |
| Jenkins restarted | delete the Jenkins pod once and watch the restart alert |
| Ingress controller down | scale the controller to 0, then restore |
| Frontend via Ingress down | `probe_success{check="frontend"}` — break the frontend Service, then restore |
| Frontend → backend via Ingress | `probe_success{check="frontend_backend"}` on `/api/health` |
| `chronicles.local` does not resolve | remove the CoreDNS rewrite, then run `scripts/enable-ingress-monitor.sh` |
| Ingress 5xx | more than 5 HTTP 5xx responses in 5 minutes |
| Frontend endpoints empty | scale frontend to 0, then restore |

Always delete demo objects when finished. `make verify` does not fire these demos.
