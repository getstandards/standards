# Standards settings

Defines the settings file that stores a user's personal defaults.

## Purpose

Some command inputs repeat on every run for one user: the cache directory and
the model selection. Without a place to save them, the user passes the same
options or exports the same environment variables for every invocation. The
settings file stores these defaults once, per user and per machine.

The settings file holds personal defaults. The repository configuration,
`.standards.yml`, holds the shared rule set. The two documents never overlap:
a rule set is shared between repositories and organizations that run
different providers and machines, so `.standards.yml` MUST NOT contain a
setting, and the settings file MUST NOT contain rules.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Scope

This document specifies the settings file: its location, format, fields, and
place in each precedence order. It does not change the configuration format,
the review pipeline, or credential storage. Credentials have their own file
and rules, defined in [Standards provider credentials](./credentials.md).

## Location

The settings file lives next to the credential file:

- `$XDG_CONFIG_HOME/standards/settings.yml`, or
  `$HOME/.config/standards/settings.yml` when `XDG_CONFIG_HOME` is unset, on
  macOS, Linux, and other Unix systems.
- `%APPDATA%\standards\settings.yml` on Windows.

A missing settings file is valid and means that no defaults are set. Users
edit the file with a text editor.

## Format

The settings file MUST contain one YAML document:

```yaml
---
version: 1
cache_dir: /data/standards-cache
model: anthropic/claude-sonnet-5
evaluation_model: google/gemini-3.1-pro
verification_model: anthropic/claude-opus-5
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | integer | Yes | Settings format version. Version 1 requires the value `1`. |
| `cache_dir` | string | No | Default cache directory. See [Standards source cache](./cache.md). |
| `model` | string | No | Default model reference for both agent steps. |
| `evaluation_model` | string | No | Default model reference for the evaluation step. |
| `verification_model` | string | No | Default model reference for the verification step. |

Every field except `version` is optional. A model field MUST hold a valid
model reference, as defined in [Standards review](./review.md). Unknown
fields MUST cause validation to fail.

The `cache_dir` field MAY start with `~/` on Unix systems or `~\\` on
Windows. The implementation expands this prefix to the user's home directory.
It MUST NOT expand a `~` followed by a user name.

## Precedence

A settings field is a saved default, so an input given on the invocation
always wins: first the command option, then the environment variable, then
the settings field, then the built-in behavior.

For the cache directory, the settings field sits between the environment
variable and the platform default, as specified in
[Standards source cache](./cache.md).

For model selection, `evaluation_model` and `verification_model` sit below
the step's option and environment variable, and `model` sits below those
per-step fields. The complete order is specified in
[Standards review](./review.md).

## Validation

A command reads the settings file only when the file exists. A settings file
that fails to parse, fails validation, or holds an invalid value MUST fail
the command with a diagnostic that names the settings file path, the field,
and the problem. A command MUST NOT silently ignore a broken settings file:
a run that ignored it would use different defaults than the user saved.

A command that does not use any settings value MAY skip reading the file.

## Security considerations

- The settings file MUST NOT contain credentials. Credentials live in the
  credential file, defined in
  [Standards provider credentials](./credentials.md).
- The settings file trusts the file system that holds it. An actor who can
  write it can redirect the cache directory or downgrade the review models.
- Diagnostics MAY print settings values; none of them is a secret.

## Version 1 exclusions

This version does not define:

- A `standards settings` command that reads or writes the file.
- A project-level settings file or per-repository overrides.
- Settings for options other than the fields above.
- A machine-readable JSON Schema for the settings file.
