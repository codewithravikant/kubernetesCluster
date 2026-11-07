# Screenshots

Lab captures from the running Cluster Chronicles stack. Files are numbered in capture order.

| File | Description |
|------|-------------|
| `01-dashboard-cluster-overview.png` | Cluster Chronicles Cluster tab. Namespaces `app`, `monitoring`, `logging`, and `cicd` are RUNNING. Topology: Host → Minikube → Ingress → frontend/backend. Terminal · cluster runs `minikube status`, `kubectl cluster-info`, and `kubectl get nodes -o wide` (node `chronicles` Ready). Field guide open on Host · Docker Engine. |
| `02-dashboard-observe-metrics-ingress.png` | Observe → Metrics. Ingress healthy (nginx, 2/2 frontend endpoints). `chronicles.local` returns HTTP 200; frontend → backend `/api/health` returns HTTP 200. CPU/memory low; probe success at 1.00. |
| `03-grafana-dashboards-inventory.png` | Grafana Dashboards list. Loaded boards include Cluster Performance, Application Performance, Kubernetes compute/network mixins, Ingress, etcd, CoreDNS, and Prometheus Overview. |
| `04-grafana-prometheus-overview.png` | Grafana Prometheus / Overview. Instance `kps-prometheus` 3.15.1. Active targets, stable scrape intervals, ~55K head series, steady query rate. |
| `05-grafana-k8s-compute-resources.png` | Grafana Kubernetes / Compute Resources / Multi-Cluster. Low CPU utilisation; memory around 25%. Usage graphs show short spikes on the Minikube node. |
| `06-kibana-dashboards-inventory.png` | Kibana Dashboards list. Three boards: Cluster Logs, Application Logs, Pod and Container Logs. |
| `07-kibana-cluster-logs.png` | Kibana Cluster Logs. Filter: `kube-system`, `logging`, `monitoring`. Volume by namespace; coredns leads top pods; document table shows DNS query lines. |
| `08-kibana-pod-container-logs.png` | Kibana Pod and Container Logs. All pods. stdout ~58% / stderr ~42%. Table includes frontend HTTP 200 lines and storage-provisioner stderr warnings. |
| `09-kibana-application-logs.png` | Kibana Application Logs. Namespace `app`. stdout ~92%. Frontend pods dominate volume. Table shows GET `/` and `/api/health` with 200. |
| `10-prometheus-alerts-rules.png` | Prometheus Alerts. Groups: `chronicles.cluster`, `chronicles.logging`, `chronicles.node`, `chronicles.pods`, plus Alertmanager and etcd. Most chronicles rules inactive; `PodPendingTooLong` pending; etcd mixin shows firing on single-node Minikube. |
| `11-jenkins-pipeline-stage-view.png` | Jenkins `chronicles-app` Stage View. Stages: Checkout → Resolve tag → Lint & test → Audit → Build & push → Trivy → Deploy → Smoke → Post. Trivy runs before Deploy. Builds #8 and #9 fully green. |
| `12-dashboard-topology-host-detail.png` | Cluster Chronicles topology Host overlay. Docker Engine healthy; Docker API available; dashboard bind `127.10.10.10`. Focus path: Ingress → frontend → backend. |
