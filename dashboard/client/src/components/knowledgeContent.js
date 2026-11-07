/**
 * Context-aware field guide drawn from Testing Q.md / docs/testing.md themes.
 * Commands are the practical kubectl/make demos used in this lab.
 */

const TOPICS = {
  overview: {
    title: "Cluster Chronicles field guide",
    intro:
      "Select a namespace card or a topology node to open a focused cheat sheet. Content mirrors the review checklist: architecture, networking, storage, CI/CD, monitoring, logging, and alerts.",
    sections: [
      {
        heading: "Lab bring-up",
        items: [
          {
            cmd: "make chronicles",
            why: "Start Minikube + app + monitoring + logging + Jenkins.",
          },
          {
            cmd: "make status",
            why: "Quick view of pods, Ingress, and PVCs.",
          },
          {
            cmd: "make verify",
            why: "Non-destructive checklist against project requirements.",
          },
          {
            cmd: "make app-verify",
            why: "Check replicas, curl frontend/backend, custom metrics.",
          },
        ],
      },
      {
        heading: "Architecture (review Q)",
        items: [
          {
            cmd: "kubectl get nodes -o wide",
            why: "See the single Minikube node and its addresses.",
          },
          {
            cmd: "kubectl get pods -n kube-system",
            why: "Control-plane and addons (API server, DNS, ingress).",
          },
          {
            cmd: "kubectl get ns",
            why: "Namespaces isolate app, monitoring, logging, cicd.",
          },
        ],
      },
    ],
  },

  host: {
    title: "Host · Docker Engine",
    intro:
      "The lab host provides CPU, memory, disk, and networking. Docker Engine is the container runtime Minikube uses (driver: docker). Assigned dashboard bind address is 127.10.10.10 — tunnel loopbacks (127.0.0.1 forwards) are separate.",
    sections: [
      {
        heading: "Useful checks",
        items: [
          {
            cmd: "docker info",
            why: "Confirm Docker Engine is running on the host.",
          },
          {
            cmd: "docker ps",
            why: "List containers — Minikube’s node runs as a container.",
          },
          {
            cmd: "make dashboard",
            why: "Serve the operator UI on the assigned host 127.10.10.10:3030.",
          },
        ],
      },
      {
        heading: "Learning note",
        items: [
          {
            cmd: "Why Docker here?",
            why: "Minikube’s docker driver nests the Kubernetes node inside a Docker container on this host.",
          },
        ],
      },
    ],
  },

  minikube: {
    title: "Minikube · local Kubernetes node",
    intro:
      "Minikube runs a single-node cluster (profile: chronicles). Review questions cover API server, etcd, scheduler, controller manager, kubelet, and Minikube’s limits vs production HA.",
    sections: [
      {
        heading: "Cluster commands",
        items: [
          {
            cmd: "minikube status -p chronicles",
            why: "Profile health: control plane, kubelet, apiserver.",
          },
          {
            cmd: "kubectl cluster-info",
            why: "API server endpoint for this cluster.",
          },
          {
            cmd: "kubectl get --raw /healthz",
            why: "API server liveness probe.",
          },
          {
            cmd: "kubectl get nodes -o wide",
            why: "Node IP and capacity (runtime value — not stored in the UI).",
          },
        ],
      },
      {
        heading: "Review themes",
        items: [
          {
            cmd: "Probes",
            why: "readiness / liveness / startup in Deployment manifests.",
          },
          {
            cmd: "Requests & limits",
            why: "Exceeding memory limit → OOMKilled.",
          },
        ],
      },
    ],
  },

  ingress: {
    title: "Ingress · external HTTP routing",
    intro:
      "Ingress routes external HTTP into Services. This lab uses the nginx addon and host chronicles.local (assigned DNS name). Service types: ClusterIP (internal), NodePort, LoadBalancer.",
    sections: [
      {
        heading: "Commands",
        items: [
          {
            cmd: "kubectl get ingress -n app",
            why: "List Ingress rules and hosts.",
          },
          {
            cmd: "kubectl describe ingress chronicles -n app",
            why: "See backends (frontend:80) and events.",
          },
          {
            cmd: "kubectl get svc -n ingress-nginx",
            why: "Ingress controller Service.",
          },
          {
            cmd: "curl -H 'Host: chronicles.local' http://$(minikube ip)/",
            why: "Hit frontend via Ingress using the assigned host header.",
          },
          {
            cmd: "kubectl exec -n ingress-nginx deploy/ingress-nginx-controller -- wget -qO- http://127.0.0.1:10254/metrics | head",
            why: "Controller metrics: process, request rate, latency, 4xx/5xx.",
          },
        ],
      },
      {
        heading: "What to watch",
        items: [
          {
            cmd: "Controller health",
            why: "Pod ready, restarts, CPU, memory, scrape up, request rate, latency, 4xx and 5xx.",
          },
          {
            cmd: "Ingress chronicles",
            why: "Host chronicles.local, class nginx, backend frontend:80, address, TLS (not enabled here), ready endpoints.",
          },
          {
            cmd: "End to end",
            why: "http://chronicles.local/ and /api/health. CoreDNS resolves the name to the controller. HTTPS is off until a tls block exists.",
          },
        ],
      },
    ],
  },

  app: {
    title: "Namespace · app",
    intro:
      "Application namespace: frontend (2 replicas + HPA) and backend (1 replica), Services, Ingress, and ServiceMonitor. Review: Deployments vs StatefulSets, probes, NetworkPolicy, troubleshooting CrashLoopBackOff / Pending.",
    sections: [
      {
        heading: "Inspect workloads",
        items: [
          {
            cmd: "kubectl get deploy,po,svc,ingress,hpa -n app",
            why: "One glance at app resources.",
          },
          {
            cmd: "kubectl logs -n app deploy/backend --tail=80",
            why: "Recent backend logs.",
          },
          {
            cmd: "kubectl describe pod -n app -l app=frontend",
            why: "Events, probes, and scheduling for frontend pods.",
          },
          {
            cmd: "kubectl rollout status deploy/frontend -n app",
            why: "Watch a rolling update.",
          },
        ],
      },
      {
        heading: "Troubleshoot (review Q)",
        items: [
          {
            cmd: "kubectl get po -n app",
            why: "Spot CrashLoopBackOff / Pending / ImagePullBackOff.",
          },
          {
            cmd: "kubectl describe po <pod> -n app",
            why: "Events explain why a pod is stuck.",
          },
          {
            cmd: "kubectl logs <pod> -n app --previous",
            why: "Logs from the previous crashed container.",
          },
        ],
      },
    ],
  },

  frontend: {
    title: "Workload · frontend",
    intro:
      "Frontend Deployment with Service :80, Ingress entry, and HPA. Review quality item: demonstrate HPA scaling under load.",
    sections: [
      {
        heading: "Commands",
        items: [
          {
            cmd: "kubectl get deploy,po,svc,hpa -n app -l app=frontend",
            why: "Frontend replicas and autoscaler status.",
          },
          {
            cmd: "kubectl describe hpa -n app",
            why: "CPU target and current metrics.",
          },
          {
            cmd: "make app-verify",
            why: "Curl path through Ingress/Service to frontend.",
          },
        ],
      },
    ],
  },

  backend: {
    title: "Workload · backend",
    intro:
      "Backend Deployment (1 replica) behind ClusterIP :3000. Scraped by Prometheus for app metrics. Frontend reaches it via in-cluster DNS.",
    sections: [
      {
        heading: "Commands",
        items: [
          {
            cmd: "kubectl get deploy,po,svc -n app -l app=backend",
            why: "Backend pods and Service.",
          },
          {
            cmd: "kubectl exec -n app deploy/frontend -- wget -qO- http://backend:3000/health",
            why: "Test internal Service DNS from frontend.",
          },
          {
            cmd: "kubectl logs -n app deploy/backend -f",
            why: "Follow API logs while exercising the UI.",
          },
        ],
      },
    ],
  },

  monitoring: {
    title: "Namespace · monitoring",
    intro:
      "Prometheus scrapes metrics; Grafana dashboards; Alertmanager routes alerts. Review: service discovery, custom metrics, node/pod/cluster alerts.",
    sections: [
      {
        heading: "Inspect stack",
        items: [
          {
            cmd: "kubectl get po,svc -n monitoring",
            why: "Prometheus, Grafana, Alertmanager pods.",
          },
          {
            cmd: "kubectl get prometheusrule -A",
            why: "Alert rules (CPU, disk, memory, restarts, Pending, API, ES, Fluent).",
          },
          {
            cmd: "kubectl get servicemonitor -A",
            why: "Which Services Prometheus is configured to scrape.",
          },
        ],
      },
      {
        heading: "Alert demos (Testing Q)",
        items: [
          {
            cmd: "stress-ng --cpu 8 --timeout 360s",
            why: "Drive node CPU >80% for the CPU alert (adjust as needed).",
          },
          {
            cmd: 'kubectl run test-pod --image=alpine --restart=Always -- /bin/sh -c "sleep 10; exit 1"',
            why: "Simulate restart-loop alert (>3 in 15m).",
          },
        ],
      },
      {
        heading: "Dashboards expected",
        items: [
          {
            cmd: "Grafana",
            why: "Cluster Performance · Pod/Container · Application Performance.",
          },
        ],
      },
    ],
  },

  logging: {
    title: "Namespace · logging (EFK)",
    intro:
      "Fluent Bit collects logs; Elasticsearch stores them; Kibana explores them. Review: log retention, ES yellow/red alerts, Fluent collection errors.",
    sections: [
      {
        heading: "Commands",
        items: [
          {
            cmd: "kubectl get po,svc,sts -n logging",
            why: "Fluent Bit, Elasticsearch StatefulSet, Kibana.",
          },
          {
            cmd: "kubectl logs -n logging -l app.kubernetes.io/name=fluent-bit --tail=50",
            why: "Collector errors and ship status.",
          },
          {
            cmd: "kubectl get pvc -n logging",
            why: "Persistent storage for Elasticsearch data.",
          },
        ],
      },
      {
        heading: "Kibana dashboards (review)",
        items: [
          {
            cmd: "Expected views",
            why: "Cluster Logs · Application Logs · Pod and Container Logs.",
          },
        ],
      },
    ],
  },

  cicd: {
    title: "Namespace · cicd (Jenkins)",
    intro:
      "Jenkins on the cluster builds, scans (Trivy), and deploys. Review: secrets handling, rolling updates/rollbacks, image scan failing on critical CVEs.",
    sections: [
      {
        heading: "Commands",
        items: [
          {
            cmd: "kubectl get po,svc,pvc -n cicd",
            why: "Jenkins pod, Service :8080, persistent home.",
          },
          {
            cmd: "kubectl logs -n cicd -l app.kubernetes.io/component=jenkins-controller --tail=80",
            why: "Controller startup and job errors.",
          },
          {
            cmd: "make rollback",
            why: "kubectl rollout undo for the app after a bad deploy.",
          },
        ],
      },
      {
        heading: "Review themes",
        items: [
          {
            cmd: "Secrets",
            why: "Mount as env/volumes; never commit API keys in manifests.",
          },
          {
            cmd: "Image scan",
            why: "Pipeline must fail on critical findings before deploy.",
          },
        ],
      },
    ],
  },
};

export function resolveKnowledgeTopic(topic) {
  if (topic && TOPICS[topic]) return topic;
  return "overview";
}

export function getKnowledgePage(topic) {
  const key = resolveKnowledgeTopic(topic);
  return { key, ...TOPICS[key] };
}

export const KNOWLEDGE_TOPICS = Object.keys(TOPICS);
