# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Sotto, please report it responsibly
and privately. Do not open a public issue for anything that could expose
learners or their keys.

Open a private report through GitHub's
[Report a vulnerability](https://github.com/affromero/Sotto/security/advisories/new)
flow (the **Security** tab, then **Report a vulnerability**). This keeps the
report confidential until a fix ships.

Please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Any relevant screenshots or proof-of-concept code
- Your assessment of the severity

## Response Timeline

- **Acknowledgment**: Within 72 hours of your report
- **Initial assessment**: Within 1 week
- **Resolution target**: Depends on severity, typically within 30 days

## Scope

The following are in scope:

- Self-hosted Sotto web applications
- Sotto API endpoints (`/api/v1/*` on your configured deployment URL)
- Authentication and authorization flows
- Data handling and encryption (BYOK keys, user data)

The following are **out of scope**:

- Third-party services (AI/TTS providers)
- Social engineering attacks against Sotto team members
- Denial of service attacks
- Issues in dependencies without a demonstrated exploit in Sotto

## Safe Harbor

We will not pursue legal action against researchers who:

- Act in good faith and follow this disclosure policy
- Avoid accessing or modifying other users' data
- Do not disrupt the service for other users
- Report vulnerabilities promptly and allow reasonable time for resolution

## Recognition

We appreciate the security research community. With your permission, we will acknowledge your contribution in our changelog when the vulnerability is resolved.

## Automated Safeguards

The repository runs continuous supply-chain and code-security checks:

- **CodeQL** static analysis (security-extended) on every pull request and weekly.
- **Dependency review** blocks pull requests that introduce high-severity advisories.
- **Dependabot** tracks npm, GitHub Actions, and Docker manifests for known vulnerabilities and version drift.
- A `min-release-age` guard in `.npmrc` keeps brand-new package versions from being pulled in automatically, reducing exposure to a compromised release.

## Supported Versions

We only support the latest deployed version of Sotto. There are no legacy versions to maintain.
