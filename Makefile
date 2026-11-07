.PHONY: help dashboard dashboard-dev chronicles status verify review \
	app-verify rollback destroy \
	stop start restart down halt up reboot

help:
	@echo "Cluster Chronicles"
	@echo ""
	@echo "  make chronicles         One-click: Minikube + app + monitoring + logging + Jenkins"
	@echo "  make dashboard          Operator UI (http://127.10.10.10:3030)"
	@echo "  make dashboard-dev      Dashboard with Vite HMR (http://127.10.10.10:3030)"
	@echo "  make status             Minikube + pods + ingress + PVCs"
	@echo "  make verify             Non-destructive review checks"
	@echo "  make review             verify + app-verify"
	@echo "  make app-verify         Curl frontend/backend + custom metric"
	@echo "  make rollback           kubectl rollout undo (app)"
	@echo "  make start | up         Start existing Minikube profile (disks kept)"
	@echo "  make stop | down | halt Stop Minikube (disks kept)"
	@echo "  make restart | reboot   Stop then start Minikube"
	@echo "  make destroy            minikube delete (this profile)"

dashboard:
	@./scripts/ensure-dashboard-host.sh
	@./scripts/ensure-dashboard-deps.sh
	@./scripts/host-forwards.sh start || true
	@cd dashboard && npm_config_update_notifier=false npm run build && npm_config_update_notifier=false npm start

dashboard-dev:
	@./scripts/ensure-dashboard-host.sh
	@./scripts/ensure-dashboard-deps.sh
	@./scripts/host-forwards.sh start || true
	@cd dashboard && npm_config_update_notifier=false npm run dev

chronicles:
	./scripts/chronicles.sh

status:
	./scripts/status.sh

verify:
	./scripts/verify.sh

review:
	./scripts/review.sh

app-verify:
	./scripts/app-verify.sh

rollback:
	./scripts/rollback.sh

destroy:
	./scripts/destroy.sh

stop down halt:
	./scripts/stop.sh

start up:
	./scripts/start.sh

restart reboot:
	./scripts/restart.sh
