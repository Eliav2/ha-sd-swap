ARG BUILD_FROM
FROM $BUILD_FROM

# Install system dependencies:
#   util-linux: lsblk, blkid, blockdev
#   coreutils:  dd with status=progress
#   xz/gzip:    decompress HA OS images
#   nginx:      ingress web server
#   pv:         progress during dd operations
#   jq:         JSON processing
RUN apk add --no-cache \
    util-linux \
    coreutils \
    xz \
    gzip \
    nginx \
    pv \
    jq

# Copy root filesystem overlay
COPY rootfs /
