[Unit]
Description=MatchLife YMQ Sync Watcher
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=__RUN_USER__
WorkingDirectory=__SYNC_RUNTIME_DIR__
ExecStart=__SYNC_RUNTIME_DIR__/start-watch-ymq.sh
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
