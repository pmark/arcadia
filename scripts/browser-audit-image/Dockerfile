FROM mcr.microsoft.com/playwright@sha256:824f1a789072e648c62541c2cfa4479c4061a290d5c27766d67dc1dcbc19b321
WORKDIR /audit
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force \
    && printf 'SYNTHETIC-NOT-A-CREDENTIAL' > /credential-sentinel \
    && chown root:root /credential-sentinel && chmod 0400 /credential-sentinel
COPY worker.mjs ./worker.mjs
ENV HOME=/tmp/home TMPDIR=/tmp
USER 1000:1000
ENTRYPOINT ["node", "/audit/worker.mjs"]
