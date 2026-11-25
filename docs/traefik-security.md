# Traefik security

The web frontend uses `public-browser@file` before its no-cache response
headers (10 requests/second per visitor, burst 100). The relay uses
`public-api@file` (50/second, burst 200); no browser challenges are added to the
relay, app invitations or WebSocket handshakes. Both chains verify Cloudflare's
socket peer before using `CF-Connecting-IP`. Established WebSocket messages still
need the relay's existing protocol limits. The homelab Compose file selects
`CF-Connecting-IP` for those limits too, so a forged forwarding chain cannot
select a different relay bucket. Deploy homelab first.

Cloudflare must preserve `CF-Connecting-IP`; do not enable the Remove visitor IP
headers transform. For IPv6 visitor identities use Pseudo IPv4 Off or Add Header,
not Overwrite Headers. Peer allowlists must match https://www.cloudflare.com/ips/.
Direct origin/LAN requests to these public routers are rejected, even with forged
Cloudflare headers. Use the Cloudflare public hostname or a separate internal
route. Missing visitor headers share an empty-header rate bucket rather than
being assigned to a Cloudflare edge bucket.

This policy does not enable Authenticated Origin Pulls/mTLS; server certificates
and Cloudflare peer allowlists are distinct controls. Application authorization
remains necessary. Clients sharing a public IP also share a proxy rate budget.

Changes are prepared on a security branch to avoid automatically deploying to
production. Merge/deploy only after the shared homelab middlewares are available
(where used), then recreate the affected containers. Check normal browser/app
access, existing authentication and unexpected 403/429 responses. These are
request limits, not bandwidth or volumetric DDoS protection.
