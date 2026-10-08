# Security Policy

SkySend promises one thing: the server never sees what is shared. Files and notes are encrypted in the browser or the CLI client, and the key lives only in the fragment of the share link, which never reaches the server. Anything that breaks this promise is a vulnerability, and a security report gets priority over everything else.

## Supported Versions

| Version | Security fixes |
| :--- | :--- |
| The latest release | ✅ |
| Older releases | ❌ Update to the latest release |

Fixes ship as a new release. There are no backports to older versions.

## Reporting a Vulnerability

Please **do not** open a public issue, discussion or pull request for a vulnerability.

Report it privately, in one of two ways:

- **GitHub**: [Report a vulnerability](https://github.com/Skyfay/SkySend/security/advisories/new) on the Security tab of the repository. This is the preferred way, since the fix can be prepared in a private advisory.
- **Email**: [security@skysend.app](mailto:security@skysend.app)

A good report contains:

- the version of SkySend and how it runs (Docker image, from source, or the CLI client)
- what an attacker can do and what they need for it, like a share link, a crafted upload or control of the server
- the steps to reproduce it, ideally with a proof of concept
- the affected files, endpoints or settings, if you know them

Only test against an instance you own. Do not access, change or delete data that is not yours, and do not test against public instances run by others.

## What Happens Next

1. You get a first answer within a few days.
2. The report is confirmed or explained, and its severity agreed with you.
3. The fix is prepared privately and ships in a new release.
4. The advisory is published once the release is out, and you are credited in it and in the changelog if you want to be.

Please keep the details private until the advisory is published.

## Scope

In scope:

- the code in this repository, including the web app, the server, the crypto library and both CLIs
- the official Docker images `skyfay/skysend` on Docker Hub and `ghcr.io/skyfay/skysend`
- the CLI client binaries on GitHub Releases and its install scripts

Out of scope:

- public instances run by others. Report a problem with such an instance to its operator
- a vulnerability in a dependency that cannot be reached through SkySend. Report it upstream, and tell us if SkySend is affected after all
- attacks that need an already compromised client device, or a share link the attacker was given on purpose
- the setup of your own instance, like running it without HTTPS or exposing it to the internet without a reverse proxy

How SkySend encrypts files and notes is documented in the [Cryptography](https://docs.skysend.app/developer-guide/crypto/) part of the developer guide.
