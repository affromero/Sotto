# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Sotto, please report it responsibly.

**Email**: [security@example.com](mailto:security@example.com)

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
- Sotto API endpoints (`/api/*` on your configured deployment URL)
- Authentication and authorization flows
- Data handling and encryption (BYOK keys, user data)
- Voice marketplace payment processing

The following are **out of scope**:

- Third-party services (Stripe, OAuth providers, AI/TTS providers)
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

## Supported Versions

We only support the latest deployed version of Sotto. There are no legacy versions to maintain.
