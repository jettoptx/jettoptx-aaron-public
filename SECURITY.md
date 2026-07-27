# Security Policy — jettoptx

## Supported versions

Security fixes target the default branch (`main` / `master`) of this repository.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: **joe@jettoptics.ai**

Please include:
- Affected repository and commit SHA (if known)
- Description and impact
- Reproduction steps or proof-of-concept
- Whether you plan public disclosure and preferred timeline

We aim to acknowledge within **72 hours** and provide a status update within **7 days**.

## Scope

In scope: authentication bypass, injection, secret leakage, privilege escalation, critical dependency CVEs in first-party code paths.

Out of scope: denial of service against public free tiers, social engineering, issues in third-party dependencies without a fixed release available (please open a dependency-update PR instead when a fix exists).

## Safe harbor

Good-faith security research that does not degrade production availability or access non-public user data is welcome. Contact us before automated scanning of production endpoints.