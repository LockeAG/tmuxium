# Security policy

Tmuxium runs a content script on every page you visit, so a hole in it matters.
If you find one, please report it privately rather than in a public issue.

## Reporting

Use GitHub's private reporting: the **Report a vulnerability** button under the
[Security tab](https://github.com/LockeAG/tmuxium/security/advisories/new).
Only the maintainer sees it.

Include the Chrome version, the page or a minimal HTML file that shows the
problem, and what a hostile page could learn or do. Expect a first reply within
a week.

## Scope

In scope: anything a web page can do to the extension or learn through it, such
as reading what you type into the overlay, triggering tab actions, or opening
URLs. Also the store package itself.

Out of scope: pages Chrome forbids extensions to touch (`chrome://`, the Web
Store, the PDF viewer), and attacks that need someone already running code on
your machine.

## Supported versions

Only the latest release on the Chrome Web Store gets fixes. Each GitHub release
from 0.5.1 on carries the store zip, its SHA-256 and a build attestation, so you
can check that the zip sent to the store was built from the tagged source.
