# Standards

Engineering standards written so an agent can enforce them on every pull request.

## Why Standards?

Rules live in the wrong places — a wiki nobody opens, the head of the one person who reviews every schema change, an RFC that half the repos never adopted. They surface after the incident, when someone says *we knew about this.*

Most of them can't be caught by a linter either. "A numeric column whose value changes slowly between adjacent rows should use `DoubleDelta`" is a judgement call about intent, not a pattern match. That's the gap this fills: standards written precisely enough for a reviewing agent to apply, and auditable enough for a human to trust the result.
