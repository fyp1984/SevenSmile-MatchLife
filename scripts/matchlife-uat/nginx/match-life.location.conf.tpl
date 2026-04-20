location = /match-life {
    return 301 /match-life/;
}

location ^~ /match-life/assets/ {
    alias __REMOTE_WWW_DIR__/assets/;
    expires 30d;
    access_log off;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
}

location ^~ /match-life/ {
    alias __REMOTE_WWW_DIR__/;
    index index.html;
    expires -1;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    try_files $uri $uri/ /match-life/index.html;
}
