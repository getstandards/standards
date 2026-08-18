# Standards source cache

Defines the persistent cache for Git sources and the output that Standards
reports while it imports them.

## Purpose

Standards imports rules from other Git repositories through the `extends`
mechanism in [Standards configuration format](./configuration.md). Without a
cache, every `validate`, `lock`, or `review` run clones each Git source again,
even when the source has not changed. This wastes time and network for repeated runs and
in automation.

This document specifies:

- A persistent, machine-level cache for Git source content, keyed by the
  resolved commit object ID.
- The progress that the CLI reports while it resolves and imports Git sources.

It refines the caching clause in [Standards configuration format](./configuration.md).
That specification states that an implementation SHOULD cache Git sources by
repository and resolved commit and MUST verify cached content against the
requested commit object ID before use. This document makes that cache
persistent across runs and defines its layout, keys, and lifecycle. In this
cache, that verification happens when an entry is written, before any later
use. See [Cache correctness](#cache-correctness).

The key words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` in this
document are to be interpreted as described by RFC 2119.

## Scope

This document does not change the configuration format, the lock file format,
or the resolution algorithm. A cache hit and a cache miss MUST resolve to the
same rule set. The cache is an optimization and MUST NOT change which commit a
source resolves to. Commit resolution is defined by the lock file in
[Standards configuration format](./configuration.md).

The cache does not change reference resolution. `lock` always contacts a
repository to resolve a tag or branch. The cache avoids only repeated fetches
of commit content.

## Cache correctness

A Git source in a resolved configuration graph is always identified by a full
commit object ID. A commit object ID names immutable content. Therefore the
commit object ID is a complete and safe cache key, and a cache entry never needs
invalidation for content change. A moved tag or branch produces a new commit
during a lock update, which produces a new cache key.

A cache entry holds checked-out files without Git metadata, so its content
cannot be re-hashed against the commit object ID after checkout. Verification
therefore happens when an entry is written. The implementation MUST verify that
a fetched checkout matches the requested commit object ID before it stores that
checkout in the cache. A completion marker records that the verification and
the write completed. See [Cache read and write](#cache-read-and-write).

An entry without a completion marker is incomplete. The implementation MUST
treat it as a miss and MUST NOT use its content. An entry with a completion
marker is trusted as stored. The cache relies on the integrity of its file
system. See [Security considerations](#security-considerations).

## Cache location

The implementation MUST resolve the cache directory in this priority order:

1. A temporary directory used for a single invocation when the cache is
   disabled. See [Disabling the cache](#disabling-the-cache).
2. The value of a `--cache-dir` option.
3. The value of the `STANDARDS_CACHE_DIR` environment variable.
4. The `cache_dir` field of the settings file, defined in
   [Standards settings](./settings.md).
5. A platform default cache directory:
   - `$XDG_CACHE_HOME/standards`, or `$HOME/.cache/standards` when
     `XDG_CACHE_HOME` is unset, on macOS, Linux, and other Unix systems.
   - `%LOCALAPPDATA%\standards\cache` on Windows.

The implementation MUST create the cache directory when it does not exist. If
the cache directory cannot be created or written, the implementation MUST report
a diagnostic and continue for that invocation as if the cache were disabled. A
cache failure MUST NOT fail an otherwise valid run.

## Cache layout

The cache MUST be organized into versioned buckets. A bucket name MUST include a
format version, so that a future layout change cannot read an incompatible entry
written by an earlier version. The Git source bucket MUST be named `git-v1` in
this version.

Git source content MUST be stored under the Git source bucket, keyed by the full
commit object ID. An entry consists of a content directory and a completion
marker file:

```text
<cache-dir>/git-v1/<commit>/
<cache-dir>/git-v1/<commit>.ok
```

`<commit>` is the full commit object ID. The directory holds the checked-out
content of that commit, without the `.git` directory or other Git metadata.
The `<commit>.ok` file is the completion marker for the entry. Only its
presence is meaningful; it MAY be empty. Because the key is the commit alone,
two repositories or two configurations that reference the same commit share one
entry.

The cache format version is independent of the configuration and lock file
versions. An implementation MUST NOT read from or write to a bucket whose format
version it does not support.

## Cache read and write

When the implementation needs the content of a Git source at a resolved commit,
it MUST:

1. Look for the entry's content directory and completion marker in the `git-v1`
   bucket.
2. When both exist, treat the entry as a hit and use it without any network
   access.
3. Otherwise, treat the entry as a miss: fetch the commit from the source
   repository into a temporary location, verify that the checked-out commit
   matches the requested commit object ID exactly, and then publish the
   verified content into the cache.

To publish a verified checkout, the implementation MUST:

1. Populate a temporary sibling directory inside the bucket.
2. Remove any incomplete content directory at the entry path.
3. Rename the temporary directory to the entry path.
4. Create the completion marker.

The rename MUST be atomic with respect to readers, so that a concurrent run
never observes a partially written content directory.

Concurrent runs MAY populate the same entry at the same time. The implementation
MUST treat an entry whose completion marker exists as a hit and MUST discard its
own temporary copy in that case. Two writers can race between the rename and
the marker creation, and one writer can replace the just-renamed directory of
the other. This race is harmless: both writers verified the same commit, so
both directories hold identical content.

The implementation MUST NOT store credentials in the cache. The implementation
MUST NOT store any content that fails commit verification and MUST NOT create a
completion marker for such content.

## Disabling the cache

The implementation MUST support a `--no-cache` option and a `STANDARDS_NO_CACHE`
environment variable. The cache is disabled when the option is present or when
the environment variable is set to a non-empty value.

When the cache is disabled, the implementation MUST NOT
read from or write to the persistent cache. It MUST fetch each Git source into a
temporary location for that single invocation and remove that location when the
invocation ends. A disabled cache MUST produce the same rule set as an enabled
cache.

## Cache management commands

The CLI MUST provide a `standards cache` command with these subcommands:

| Command | Purpose |
| --- | --- |
| `standards cache clean` | Remove every entry in the cache. |
| `standards cache prune` | Remove entries that the current configuration does not reference. |

`standards cache clean` MUST remove all buckets under the resolved cache
directory. It MUST report the removed location and exit with status `0`. If the
cache directory does not exist, it MUST report that state and exit with status
`0`.

`standards cache prune` MUST load the entry file and, when present, its lock
file, compute the set of commit object IDs that the resolved configuration
graph references, and remove every `git-v1` entry whose commit is not in that
set. A configuration without mutable revisions does not require a lock file.
The command MUST report the number of removed entries and exit with status `0`.

The cache is machine-level and shared across projects. `standards cache prune`
computes its reference set from one repository, so it can remove entries that
other repositories on the same machine still reference. This removal is safe:
the next run for an affected repository fetches the source again.

A cache management command MUST NOT modify the configuration, the lock file, or
any other repository file.

## Import output

The CLI MUST report progress while it resolves and imports Git sources, so that
a user or an automation log can see which repositories are contacted and whether
the cache was used. Before this specification, the import phase was silent.

The implementation MUST report one line for each distinct repository and
revision that it resolves, and one line for each distinct repository and commit
that it imports. Sources that share a repository and commit but differ in
`path` share one line. A line uses the requested revision and the resolved
short commit. The short commit is a prefix of the commit object ID with at
least seven characters.

| Situation | Reported action |
| --- | --- |
| `lock` resolves a tag or branch to a commit. | Resolving the repository and revision. |
| An import reads a source from the persistent cache. | A cache hit for the repository and commit. |
| An import fetches a source over the network. | A fetch for the repository and commit. |

Progress output MUST be written to standard error, so that it does not mix with
the machine-readable results that a command writes to standard output. Progress
output MUST NOT include credentials or full repository URLs with embedded
credentials.

Progress lines are plain text and MUST NOT require a terminal. A spinner or
in-place update MAY be used when standard error is a terminal, but it MUST
degrade to plain lines otherwise.

The final summary that `lock` and `validate` already print is retained and is
defined by [Standards CLI](./cli.md). Progress output is additional and MUST NOT
replace that summary.

## Security considerations

- The cache stores only content that passed commit verification at write time.
  A commit object ID is a cryptographic content identifier, so the verification
  performed before an entry is published guarantees the content that was
  stored. The implementation does not re-verify an entry at read time; the
  completion marker records that write-time verification completed.
- The cache trusts the file system that holds it. An actor who can write to the
  cache directory can change rule content that a review agent later interprets.
  The cache MUST NOT be restored from or shared with a lower-trust context,
  such as a CI cache service or a shared runner, where another party can write
  entries.
- The cache MUST NOT store credentials, and progress output MUST NOT reveal
  credentials.
- The cache is machine-level and shared across projects. Because entries are
  keyed by commit and verified before they are published, sharing between
  projects is safe.

## Version 1 exclusions

This version does not define:

- A cache for local sources. Local sources are read directly from the file
  system.
- A shared or remote cache service.
- A size limit, an age limit, or automatic eviction. `cache clean` and
  `cache prune` are the only removal mechanisms.
- A quiet mode that suppresses progress output.
- A lock-free coordination protocol beyond the atomic rename described above.
