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

    server {
        listen %%INGRESS_PORT%% default_server;

        root /var/www;
        index index.html;

        # Static files for the web UI
        location / {
            try_files $uri $uri/ /index.html;
        }

        # API endpoints (placeholder — will proxy to a real backend later)
        location /api/ {
            default_type application/json;
            return 200 '{"status": "ok", "message": "SD Swap API — not yet implemented"}';
        }
    }
}
