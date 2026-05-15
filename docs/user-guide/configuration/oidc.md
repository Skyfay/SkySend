# OIDC / SSO Authentication

SkySend supports optional single sign-on via any OIDC-compliant provider. When configured, file uploads and/or note creation require users to authenticate first. Downloads are always public - authentication only gates the upload action.

All OIDC endpoints (authorization, token, userinfo, end-session) are auto-discovered from the issuer URL. You never need to specify individual endpoint URLs manually.

For the full list of configuration variables, see [Environment Variables](/user-guide/configuration/environment-variables#sso-oidc-authentication).

## What to Register at Your Provider

You only need to configure **one redirect/callback URL** at your provider, regardless of whether users access SkySend via the web browser or the CLI client:

```
https://skysend.example.com/auth/callback
```

Replace `skysend.example.com` with your actual domain (the value of `BASE_URL`).

**No additional URLs are needed for the CLI.** The CLI piggybacks on the same server callback - SkySend handles the provider redirect first and then forwards the session token to the CLI's temporary local listener. The provider never talks to the CLI directly.

::: tip Grant type
Register the application as a **confidential client** with the **authorization code** grant type and PKCE support. You need both a client ID and a client secret.
:::

## Session Secret

::: tip Persist sessions across restarts
If `OIDC_SESSION_SECRET` is not set, SkySend generates a random secret at startup. Every server restart will sign out all logged-in users. Set a fixed value to persist sessions:

```sh
# generate once, then set as OIDC_SESSION_SECRET
openssl rand -base64 48
```
:::

## Provider Setup

::: tip No identity provider yet?
[PocketID](https://github.com/stonith404/pocket-id) is a lightweight, self-hostable OIDC provider that is easy to set up and pairs well with SkySend. It is a good starting point if you do not already have an IdP.
:::

### PocketID

Set `OIDC_ISSUER` to the root URL of your PocketID instance. PocketID exposes the discovery document at `/.well-known/openid-configuration` on the root, so the issuer URL is simply the base URL.

```yaml
environment:
  OIDC_PROVIDER: pocketid
  OIDC_ISSUER: "https://auth.example.com"
  OIDC_CLIENT_ID: "your-client-id"
  OIDC_CLIENT_SECRET: "your-client-secret"
```

Register the callback URL `https://skysend.example.com/auth/callback` in the PocketID application settings.

### Keycloak

Set `OIDC_ISSUER` to the realm-specific issuer URL. Find it in the Keycloak Admin Console under **Realm Settings** > **General** > **OpenID Endpoint Configuration** - use the `issuer` field.

```yaml
environment:
  OIDC_PROVIDER: keycloak
  OIDC_ISSUER: "https://keycloak.example.com/realms/myrealm"
  OIDC_CLIENT_ID: "skysend"
  OIDC_CLIENT_SECRET: "your-client-secret"
```

In Keycloak, create a new client with:
- **Client type**: OpenID Connect
- **Valid redirect URIs**: `https://skysend.example.com/auth/callback`
- **Client authentication**: On (confidential client)

### Authentik

Set `OIDC_ISSUER` to the application-specific path including the application slug. Find it in the Authentik admin panel under **Applications** > your application > **Edit** > **OpenID Configuration Issuer**.

```yaml
environment:
  OIDC_PROVIDER: authentik
  OIDC_ISSUER: "https://auth.example.com/application/o/skysend/"
  OIDC_CLIENT_ID: "your-client-id"
  OIDC_CLIENT_SECRET: "your-client-secret"
```

Set the redirect URI in the OAuth2/OIDC provider to `https://skysend.example.com/auth/callback`.

### Generic

Use `generic` for any other OIDC-compliant provider (Zitadel, Kanidm, Dex, etc.). Set `OIDC_ISSUER` to the issuer URL from your provider's OIDC configuration panel. The value must match the `issuer` field returned by `/.well-known/openid-configuration`.

```yaml
environment:
  OIDC_PROVIDER: generic
  OIDC_ISSUER: "https://auth.example.com"
  OIDC_CLIENT_ID: "your-client-id"
  OIDC_CLIENT_SECRET: "your-client-secret"
```

::: tip Finding the issuer URL
Open `{your-issuer}/.well-known/openid-configuration` in a browser. If you get a JSON document with an `authorization_endpoint` field, the URL is correct. SkySend reads this document automatically at login time.
:::

## Partial Protection

You can require login for one service type while allowing anonymous access to the other:

```yaml
# Require login for file uploads, but allow anonymous notes
OIDC_PROTECT_FILES: "true"
OIDC_PROTECT_NOTES: "false"
```
