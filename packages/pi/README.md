# @getstandards/pi

Run a [Standards](https://github.com/getstandards/standards) review from inside
the [pi coding agent](https://github.com/earendil-works/pi).

The review runs in the pi process, so it uses pi's own resolved authentication
and needs no separate login. It renders a summary and delivers the findings into
the agent conversation, so the agent can fix them.

## Install

```sh
pi install npm:@getstandards/pi          # for you
pi install -l npm:@getstandards/pi       # for this project, committed in .pi/settings.json
pi -e npm:@getstandards/pi               # for one run
```

## Use

The repository needs a `.standards.yml` at its root. Run `standards init` or
write one by hand; see
[the configuration spec](https://github.com/getstandards/standards/blob/main/specs/configuration.md).

```
/standards                       # review the working tree against the merge base
/standards --staged              # review the index
/standards --base main           # review against another base revision
/standards src/billing           # review only the changed files under a path
/standards --rule money.no-float # review with one rule
```

The review runs on the model you selected in pi, unless a `--model` option, a
`STANDARDS_*` environment variable, or your Standards settings file selects one.
Set the model in settings when you want the same models your CI uses.

## Documentation

- [pi extension specification](https://github.com/getstandards/standards/blob/main/specs/pi.md)
- [Review pipeline](https://github.com/getstandards/standards/blob/main/specs/review.md)

MIT licensed.
