#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║            Установка CHAT PROXY на сервер (Ubuntu 24.04)               ║
# ╚══════════════════════════════════════════════════════════════════════╝
# Использование (на сервере, от root):
#   bash install-proxy.sh ДОМЕН АДРЕС_САЙТА [АДРЕС_WORKER_ИИ]
# Пример:
#   bash install-proxy.sh chatmusic.duckdns.org https://99999cent-bit.github.io https://old-tree-4f4b.99999cent.workers.dev
#
# Что делает: ставит Node.js и Caddy из репозиториев Ubuntu, копирует chat-proxy.js,
# запускает его как службу (автозапуск, перезапуск при сбое) и включает HTTPS
# (бесплатный сертификат Let's Encrypt выпускается автоматически).
set -euo pipefail

DOMAIN="${1:-}"; SITE="${2:-}"; AI="${3:-}"
if [[ -z "$DOMAIN" || -z "$SITE" ]]; then
  echo "Нужно: bash install-proxy.sh ДОМЕН АДРЕС_САЙТА [АДРЕС_WORKER_ИИ]"; exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "Запустите от root (sudo -i)"; exit 1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ ! -f "$HERE/chat-proxy.js" ]]; then echo "Положите chat-proxy.js рядом со скриптом"; exit 1; fi

echo "▶ Устанавливаю Node.js и Caddy…"
apt-get update -y
apt-get install -y nodejs caddy curl

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then echo "Нужен Node.js 18+ (у вас $NODE_MAJOR). Используйте Ubuntu 24.04."; exit 1; fi

echo "▶ Копирую прокси…"
mkdir -p /opt/chat-proxy
cp "$HERE/chat-proxy.js" /opt/chat-proxy/chat-proxy.js

cat > /etc/systemd/system/chat-proxy.service <<EOF
[Unit]
Description=Chat proxy (music + AI)
After=network-online.target
Wants=network-online.target

[Service]
Environment=PORT=8787
Environment=ALLOWED_ORIGIN=${SITE}
Environment=AI_UPSTREAM=${AI}
ExecStart=/usr/bin/node /opt/chat-proxy/chat-proxy.js
Restart=always
RestartSec=3
DynamicUser=yes
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF

echo "▶ Настраиваю HTTPS для ${DOMAIN}…"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
  encode gzip
  reverse_proxy 127.0.0.1:8787 {
    flush_interval -1
  }
}
EOF

systemctl daemon-reload
systemctl enable --now chat-proxy
systemctl restart chat-proxy
systemctl enable caddy
systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp || true; ufw allow 443/tcp || true
fi

echo "▶ Жду выпуска сертификата…"
for i in $(seq 1 30); do
  if curl -fsS "https://${DOMAIN}/health" -o /tmp/chat-proxy-health.json 2>/dev/null; then break; fi
  sleep 3
done
echo
if [[ -s /tmp/chat-proxy-health.json ]]; then
  echo "✅ Готово! Проверка связи:"
  cat /tmp/chat-proxy-health.json; echo
  echo
  echo "Вставьте в приложении (Админ-панель → Сервер → Прокси):  https://${DOMAIN}"
else
  echo "⚠️ Прокси запущен, но HTTPS ещё не ответил. Проверьте, что домен ${DOMAIN} указывает на IP этого сервера,"
  echo "   и посмотрите журнал:  journalctl -u caddy -n 50   и   journalctl -u chat-proxy -n 50"
fi
