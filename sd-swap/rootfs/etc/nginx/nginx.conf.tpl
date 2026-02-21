worker_processes 1;
pid /run/nginx/nginx.pid;
error_log /dev/stderr;

events {
    worker_connections 128;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /dev/stdout;
    sendfile on;
    keepalive_timeout 65;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    server {
        listen %%INGRESS_PORT%% default_server;

        root /var/www;
        index index.html;

        # Static files for the web UI
        location / {
            try_files $uri $uri/ /index.html;
        }

        # API proxy to Bun backend
        location /api/ {
            proxy_pass http://127.0.0.1:8080;
            proxy_set_header Host $host;
            proxy_read_timeout 3600s;
        }

        # WebSocket proxy for real-time progress
        location /ws/ {
            proxy_pass http://127.0.0.1:8080;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_read_timeout 3600s;
        }
    }
}
