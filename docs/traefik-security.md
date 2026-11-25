# Traefik and Anubis security

The browser frontend has `traefik.enable=false`. Public requests for
`money.betz.coffee` pass through the central homelab Anubis instance, targeting
`splitledger-web:80`. Deploy homelab first. A priority-900 file-provider guard
blocks fallback to old backend routers if Anubis is unavailable; Anubis has
priority 1000. Recreate this application's container to remove its old direct
router. Do not add a public backend fallback.

The separate relay hostname retains its Cloudflare-verified API route and
protocol limits. Native clients, WebSockets, and app-link association files
must remain accessible without an interactive challenge on the relay. The web
frontend's Anubis policy permits standard `/.well-known/*` discovery paths.

Cloudflare peer verification precedes trust in `CF-Connecting-IP`. No changes
to application data or secrets are needed. Deployment remains manual for this
security branch; verify the central proxy before deploying backend label changes.
