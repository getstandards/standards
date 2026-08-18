# Standards provider credentials

Defines how Standards stores and resolves model provider credentials.

## Purpose

The agent steps of [Standards review](./review.md) call a model provider, and
every provider call needs a credential. Users hold credentials in two ways:

- Automation, such as the GitHub Action, holds a provider API key as a
  secret.
- A person runs a review on their own machine with their own provider
  account, which can be a subscription account instead of an API key.

This document specifies the credential sources and their precedence, the
`login` and `logout` commands, credential storage, and the rules for
automation.

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Scope

This document covers only model provider credentials. Git credentials for
configuration sources are outside this document;
[Standards configuration format](./configuration.md) defines their
constraints. Model selection, the provider SDK, and default models are
defined in [Standards review](./review.md).

## Credential resolution

For each provider, the implementation MUST resolve a credential in this
priority order:

1. The stored credential that `standards login` saved for that provider.
2. The provider's API key environment variable.

A stored credential wins because `login` is an explicit user action on that
machine. An environment variable that another tool needs MUST NOT silently
override a subscription account that the user chose to use.

A provider has a usable credential when either source resolves. Model
selection in [Standards review](./review.md) uses this definition to pick a
default provider.

| Provider | Environment variable |
| --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| Other | The variable that the provider SDK defines for that provider. |

## `login`

`standards login <provider>` stores a credential for one provider:

- For a provider whose SDK integration supports a subscription account, the
  command MUST run the SDK's OAuth flow and store the resulting token,
  including the state needed to refresh it.
- For every other provider, the command MUST read an API key from an
  interactive prompt and store it. The prompt MUST NOT echo the key.

`standards login` without a provider, or with an unknown provider, MUST print
a diagnostic that lists the known providers and exit with status `1`. The
command MUST NOT print the stored secret. On success it MUST report the
provider and the credential kind, `oauth` or `api-key`, and exit with status
`0`.

## `logout`

`standards logout <provider>` MUST remove the stored credential for that
provider and report the removal. When no credential is stored for that
provider, it MUST report that state. Both cases exit with status `0`.

A `login` or `logout` command MUST NOT modify the configuration, the lock
file, or any other repository file.

## Credential storage

Stored credentials live in one file:

- `$XDG_CONFIG_HOME/standards/auth.json`, or `$HOME/.config/standards/auth.json`
  when `XDG_CONFIG_HOME` is unset, on macOS, Linux, and other Unix systems.
- `%APPDATA%\standards\auth.json` on Windows.

The file holds one entry per provider with the credential kind and its
secrets. On Unix systems the implementation MUST create it with permissions
that grant access only to the owning user. The file MUST NOT live in a
repository, in the source cache, or in any path that a Standards command
writes for another purpose.

## Automation

Automation MUST use an API key through the environment. The GitHub Action
supplies provider API keys as action inputs and forwards them to the review
process as the environment variables above; the inputs are defined in
[Standards GitHub Action](./github.md). An OAuth credential belongs to a
person's interactive session and SHOULD NOT be copied into automation.

## Security considerations

- Credentials MUST NOT be stored in the configuration, the lock file, or the
  source cache. [Standards configuration format](./configuration.md) and
  [Standards source cache](./cache.md) state the same constraints for their
  files.
- Diagnostics, progress output, and the report MUST NOT contain a credential.
- The credential file trusts the file system that holds it. It MUST NOT be
  committed, synced to a lower-trust context, or shared between users.

## Version 1 exclusions

This version does not define:

- Operating system keychain storage for credentials.
- A shared or remote credential service.
- An option that passes an API key on the command line. A command line
  argument leaks through shell history and process lists.
- Enforcement that blocks an OAuth credential in automation.
