import { BlockList, isIP } from "node:net";

/**
 * The networks a reverse proxy may connect from when TRUSTED_PROXIES is unset: loopback, the
 * private ranges (Docker, Kubernetes, a LAN), shared address space (carrier NAT, Tailscale,
 * NetBird), link-local, and IPv6 unique local addresses. A proxy on the same host, in the same
 * Docker network, in the cluster or in the cloud network reaches the server from one of them.
 */
export const DEFAULT_TRUSTED_PROXIES = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

/**
 * The addresses and networks of `entries` ("10.0.0.5", "10.0.0.0/8", "fd00::/8") as one list.
 * Throws on an entry that is neither.
 */
export function trustedProxyList(entries: string[]): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = "", prefix, extra] = entry.split("/");
    const family = isIP(address);
    const bits = family === 4 ? 32 : 128;
    const length = prefix === undefined ? bits : Number(prefix);
    if (!family || extra !== undefined || !/^\d*$/.test(prefix ?? "") || prefix === "" || length > bits) {
      throw new Error(`"${entry}" is not an IP address or a network like 10.0.0.0/8`);
    }
    list.addSubnet(address, length, family === 4 ? "ipv4" : "ipv6");
  }
  return list;
}
