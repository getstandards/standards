# Standards suppressions

Defines the in-change marker that suppresses one rule for one finding.

## Purpose

Verification reduces false findings, but no reviewer is perfect, and a rule
can be genuinely wrong for one line of one file. Without an escape hatch, a
false `MUST` finding blocks a merge until someone edits a shared rule
repository. A suppression is that escape hatch: a marker in the change that
names the rule, states a reason, and is visible to every human reviewer in
the same diff.

A suppression is deliberately louder than the alternative designs. It lives
in the reviewed change, not in a config file, so approving the suppression
is part of approving the change. It requires a reason, and the reason is
quoted in the report.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Marker

A suppression is one line of a changed file that contains:

```text
standards-allow <rule-id>: <reason>
```

- `standards-allow` is the literal token.
- `<rule-id>` is one rule identifier from the resolved rule set, or one of a
  rule's aliases. An alias is the derived id of a superseded knowledge
  document, as defined in
  [Standards configuration format](./configuration.md); a marker that names
  an alias suppresses the final rule of the chain.
- `<reason>` is required, non-empty free text that ends at the end of the
  line.

The marker is matched as text, so it works inside any comment syntax:

```ts
// standards-allow payments.no-floating-point-money: display-only estimate, PAY-421
const estimate = subtotal * 1.2;
```

```sql
-- standards-allow clickhouse.nullable-columns: upstream schema requires NULL here
ALTER TABLE events ADD COLUMN region Nullable(String);
```

The implementation MUST match the marker with text search, not language
grammars. A marker with a missing or empty reason MUST NOT suppress
anything; the report MUST list it as invalid.

## Scope

The implementation MUST read suppressions from the head revision of each
changed file. A suppression applies to a finding when all of these hold:

- The finding's rule `id`, or one of that rule's aliases, equals the
  marker's `<rule-id>`.
- The finding is in the same file as the marker.
- The finding's line range includes the marker's line or the line directly
  after it.

One marker suppresses one rule. Two violated rules on the same line need two
markers. There is no file-level or repository-level form in this version.

## Pipeline integration

Suppression matching is deterministic and MUST NOT use a model. It runs in
the verification step of [Standards review](./review.md), after
deduplication and before any verifier is invoked. A suppressed finding MUST
NOT be verified: its outcome cannot change the conclusion, so verifying it
would spend tokens on nothing.

A suppressed finding MUST NOT change the conclusion, regardless of its rule
level.

## Reporting

Suppressions are visible, or they are a hole. The report defined in
[Standards review](./review.md) MUST include:

- Each suppressed finding with its rule `id`, `level`, `path`, `lines`, and
  the marker's reason.
- Each invalid marker: a missing reason, or a `<rule-id>` that names neither
  a resolved rule nor an alias. A dead or misspelled suppression must be
  seen, not skipped.

On GitHub, suppressed findings appear in the check run summary and the
summary comment through the report, but MUST NOT produce finding comments,
as specified in [Standards GitHub Action](./github.md).

## Security considerations

- A suppression is not a bypass of review; it is a visible artifact of the
  change. Anyone who can write the change can write a suppression, and the
  same human reviewers who approve the change see the marker and its reason
  in the diff. The report repeats them so the record survives the diff view.
- Matching is deterministic. An agent never decides whether a suppression
  applies, so a persuasive comment cannot suppress a finding — only the
  exact marker can, and the marker is visible.
- Suppressed findings are not verified. The reported entry carries the
  evaluation's claim without a verifier's confirmation; it is informational,
  not a confirmed finding.

## Version 1 exclusions

This version does not define:

- File-level, directory-level, or repository-level suppressions.
- An expiry date or review cycle for suppressions.
- Rules that opt out of suppressibility.
- A baseline mechanism that suppresses all pre-existing findings at
  adoption.
