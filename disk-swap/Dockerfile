ARG BUILD_FROM
FROM $BUILD_FROM

# Install system dependencies:
#   util-linux: lsblk, findmnt, blkid, blockdev
#   coreutils:  dd with conv=fdatasync
#   xz/gzip:    decompress HA OS images
#   pv:         progress during dd operations
#   jq:         JSON processing
#   e2fsprogs:  ext4 tools for backup injection
#   curl:       image download + Bun installer
#   parted:     partprobe (re-read partition table)
RUN apk add --no-cache \
    util-linux \
    coreutils \
    xz \
    gzip \
    pv \
    jq \
    e2fsprogs \
    curl \
    parted

# Install Bun runtime
ARG BUN_VERSION=1.2.4
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v${BUN_VERSION}"

# Copy backend source code and install dependencies
COPY server/ /usr/src/server/
COPY shared/ /usr/src/shared/
COPY package.json bun.lock /usr/src/
RUN cd /usr/src && bun install --frozen-lockfile --production

# Runtime directories
RUN mkdir -p /mnt/newsd

# Copy root filesystem overlay (s6 services, static web UI)
COPY rootfs /
