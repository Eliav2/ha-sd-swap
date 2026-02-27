ARG BUILD_FROM

# Extract containerd v2.2.1 binaries from the official Alpine-based image.
# This image is compiled on Alpine (musl), so the binaries are compatible with
# HA addon containers. Version must match HA OS (Docker 29.x → containerd 2.2.1)
# to ensure BoltDB schema compatibility when pre-caching Docker images.
FROM containerd/containerd:2.2.1 AS containerd-bins

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
#   mount:      full mount/umount (busybox version lacks ext4 support)
RUN apk add --no-cache \
    util-linux \
    coreutils \
    xz \
    gzip \
    pv \
    jq \
    e2fsprogs \
    curl \
    parted \
    mount

# Install crane for image manifest inspection (size estimation for progress reporting)
RUN ARCH=$(uname -m) && \
    CRANE_ARCH=$([ "$ARCH" = "aarch64" ] && echo "arm64" || echo "x86_64") && \
    curl -fsSL "https://github.com/google/go-containerregistry/releases/download/v0.21.1/go-containerregistry_Linux_${CRANE_ARCH}.tar.gz" -o /tmp/crane.tar.gz && \
    tar xzf /tmp/crane.tar.gz -C /usr/local/bin crane && \
    rm /tmp/crane.tar.gz && \
    chmod +x /usr/local/bin/crane

# Copy containerd + ctr from the versioned image (musl-compatible, version-matched)
COPY --from=containerd-bins /usr/local/bin/containerd /usr/local/bin/containerd
COPY --from=containerd-bins /usr/local/bin/ctr /usr/local/bin/ctr

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
