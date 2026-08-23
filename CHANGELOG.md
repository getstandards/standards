# Changelog

## [0.1.0](https://github.com/getstandards/standards/compare/0.0.3...0.1.0) (2026-08-23)


### Features

* **review:** report the cost of a review and its cached token counts ([#12](https://github.com/getstandards/standards/issues/12)) ([3298e02](https://github.com/getstandards/standards/commit/3298e025f9a661401ff5d1646a2d3f8a5ee9fa58))


### Bug Fixes

* **action:** commit the dist bundle so the action runs from any ref ([#15](https://github.com/getstandards/standards/issues/15)) ([d688457](https://github.com/getstandards/standards/commit/d688457800740fb60027284aad5a8edb81004ca5))


### Miscellaneous Chores

* **assets:** remove unused assets ([9a05211](https://github.com/getstandards/standards/commit/9a0521118989e0d8186425e4c17733317c7004b2))
* **deps:** update pnpm to v11.23.0 ([#14](https://github.com/getstandards/standards/issues/14)) ([a7c4b87](https://github.com/getstandards/standards/commit/a7c4b875d2785f0e7f1c951e2361e50ecaf3fc74))
* **release-please:** update release-please configuration ([1714aae](https://github.com/getstandards/standards/commit/1714aaeafe6e91a066e92212167b0178f94de430))

## [0.0.3](https://github.com/getstandards/standards/compare/0.0.2...0.0.3) (2026-08-23)


### Miscellaneous Chores

* **action:** minify action build ([#4](https://github.com/getstandards/standards/issues/4)) ([94ed21e](https://github.com/getstandards/standards/commit/94ed21ebf3808f6d8dd3aaa3ff160bf2f8ff3c00))
* **deps:** update dependency @inquirer/prompts to v8.6.0 ([#10](https://github.com/getstandards/standards/issues/10)) ([afef467](https://github.com/getstandards/standards/commit/afef467fa26c055d1efcbadf8899fc2b5b484211))
* **deps:** update pnpm to v11.22.0 ([#11](https://github.com/getstandards/standards/issues/11)) ([2243301](https://github.com/getstandards/standards/commit/2243301c75e6c19259afc39f4e74a090b0420733))

## [0.0.2](https://github.com/getstandards/standards/compare/0.0.1...0.0.2) (2026-08-23)


### Features

* **action:** comment findings on the pull request diff instead of annotations ([3427f24](https://github.com/getstandards/standards/commit/3427f248a7b08d29b07207b5fe8dc95b1fec42b4))
* **action:** review pull requests with a check run, annotations, and a summary comment ([c101047](https://github.com/getstandards/standards/commit/c101047d44b613a275f9712c56d23ba0374dfd1a))
* **action:** set outputs for downstream workflow steps ([0b41ce3](https://github.com/getstandards/standards/commit/0b41ce3632bdacdb862f6ff6e3046bbf43e6c39a))
* add persistent Git source cache ([cc05368](https://github.com/getstandards/standards/commit/cc05368a8978e966bf3dad0ab9d60bfb98c280ac))
* add provider credentials with login and logout commands ([76773f2](https://github.com/getstandards/standards/commit/76773f2b4e4967fa930aabbb6245c5700d96c641))
* add review CLI command implementation ([79c27b2](https://github.com/getstandards/standards/commit/79c27b282121525b41559ccf525d0b56b30c191b))
* add standards settings ([2227bd7](https://github.com/getstandards/standards/commit/2227bd7120e610f21680e45aab3b72cb807180ed))
* **cli:** add init wizard, --version, login prompt, and verbose review ([d67161c](https://github.com/getstandards/standards/commit/d67161c640ad56c81b0e16bf1c8e45bb89f8dee2))
* **cli:** exit quietly when a prompt is ended with Ctrl+C ([e9249ae](https://github.com/getstandards/standards/commit/e9249aefe84864eb37b33b0057398e3f0d8fe11d))
* **cli:** group cache subcommands under a single command ([b4c6517](https://github.com/getstandards/standards/commit/b4c65173652f7202ce95d5914a5afc44c3ea91bf))
* **cli:** group credentials under auth and add the models command ([23649d0](https://github.com/getstandards/standards/commit/23649d06c860f272dea5d9ea979e0f398088de1c))
* **cli:** group credentials under auth and add the models command ([4a0a998](https://github.com/getstandards/standards/commit/4a0a9989b6cace99995d5ebfb9d0fd2783dc1c18))
* **cli:** show a review spinner with live step progress ([d6a4b6d](https://github.com/getstandards/standards/commit/d6a4b6df4035f593388bce605c337cb8a70495fb))
* **review:** compute changed files and hunks from git diff ([5ae4bad](https://github.com/getstandards/standards/commit/5ae4badbca012f595de48098a7b518e33d9026bb))
* **review:** evaluate changed files with a findings agent ([9b98f48](https://github.com/getstandards/standards/commit/9b98f487e074a863c3c0ab1579140ed2bb0228f2))
* **review:** evaluate with one verdict per rule at temperature 0 ([eecbb13](https://github.com/getstandards/standards/commit/eecbb13c4622e72ee19a7a236fd705db84aec8ac))
* **review:** plan evaluation tasks per changed file ([628746d](https://github.com/getstandards/standards/commit/628746d14b19bc9bce48e28ba1926202ac190bd4))
* **review:** render the report and run the review pipeline ([23f3f5f](https://github.com/getstandards/standards/commit/23f3f5f6d070819e753ab50a1e9876f835bd9992))
* **review:** resolve evaluation and verification models ([fe71a1b](https://github.com/getstandards/standards/commit/fe71a1b6146b71a888b5db76a0c1acfc317506e5))
* **review:** select rules per changed file with glob matching ([535d265](https://github.com/getstandards/standards/commit/535d265c38033bbe3cc5a38c026896de119f4250))
* **review:** verify findings before they reach the report ([603e137](https://github.com/getstandards/standards/commit/603e137c3c643cff9facebe448b4d9bc60a5674c))


### Bug Fixes

* **cli:** mark init as implemented in help text ([2001fa8](https://github.com/getstandards/standards/commit/2001fa8bb4fb0add8a86da91074ec2cf98c11f70))
* **cli:** mark init as implemented in help text ([5d87cfb](https://github.com/getstandards/standards/commit/5d87cfb3b85410ca8f1ddb96c879ec67c54e3d7e))
* **release-please:** add package.json to extra files ([0a0ed7d](https://github.com/getstandards/standards/commit/0a0ed7d6551521bfd9050e9b3c15be9e6a80049d))


### Code Refactoring

* migrate to a pnpm monorepo ([8adcce4](https://github.com/getstandards/standards/commit/8adcce440f30904c34ca3015f0acd285a27ecbe4))
* rename bare-role source files to domain-prefixed names ([796209a](https://github.com/getstandards/standards/commit/796209ae21d6754c5e1fc3d900e93ca1ba657448))


### Documentation

* add domain terms to TERMINOLOGY.md ([8dbcfd7](https://github.com/getstandards/standards/commit/8dbcfd71e7774db29e892340e05ad774184650af))
* **readme:** add the concurrency group to the workflow example ([6d3988e](https://github.com/getstandards/standards/commit/6d3988ead4814b74c72da36bfcf05250fc9287db))
* **readme:** show the terminal report and use a generic example ([b793fa9](https://github.com/getstandards/standards/commit/b793fa98a19564bec02cb23f0893c849d52689ff))
* **readme:** shrink the README and tighten its examples ([5e3e739](https://github.com/getstandards/standards/commit/5e3e73992f299be868081ae0d5111053088af8e2))


### Build System

* action ncc entry accordingly. ([796209a](https://github.com/getstandards/standards/commit/796209ae21d6754c5e1fc3d900e93ca1ba657448))


### Miscellaneous Chores

* add specs ([26c5037](https://github.com/getstandards/standards/commit/26c5037fdda150cae1b03cddac4eb3ec583b0172))
* add write-discoverable-skill ([3d2ac1f](https://github.com/getstandards/standards/commit/3d2ac1fdb29856d2df9504462d1d34991cf69e69))
* **ci:** add CI workflow ([9966304](https://github.com/getstandards/standards/commit/99663042c9ad1645a0dc322eb436b2a74e06b3fa))
* **ci:** add release workflow ([16f0ae3](https://github.com/getstandards/standards/commit/16f0ae3fbd5441978fd86a67c7a3a8e311f93fe4))
* **ci:** add release-please ([2243ad7](https://github.com/getstandards/standards/commit/2243ad7f819b86c37fb93f383717b339f42ae31f))
* **ci:** add renovate and run on ubunutu-24.04 ([558e909](https://github.com/getstandards/standards/commit/558e909969c64301cfa9311bcf551d52f0bcc542))
* delete plan.md ([07c174c](https://github.com/getstandards/standards/commit/07c174ce3696152f809c0827fb558dc09ba45c57))
* **deps:** update dependency @biomejs/biome to v2.5.10 ([f74a00e](https://github.com/getstandards/standards/commit/f74a00e70b475ec7c2cf73e87756919f40116a59))
* **deps:** update dependency @biomejs/biome to v2.5.10 ([fc03dfe](https://github.com/getstandards/standards/commit/fc03dfea5bee8333c35c37efbf2df2118b585210))
* **deps:** update dependency vitest to v4.1.11 ([b7f6a0d](https://github.com/getstandards/standards/commit/b7f6a0d5507a82e51141a8d14e18a071de579dd1))
* **deps:** update dependency vitest to v4.1.11 ([5a6c4b9](https://github.com/getstandards/standards/commit/5a6c4b9b654db08484c032ffd1ee94ed4fece8cb))
* **mise:** move to .mise directory ([fbcb2c7](https://github.com/getstandards/standards/commit/fbcb2c74b5b5d619c979dd780334c79fede3f95e))
* **mise:** update lock ([d7c0384](https://github.com/getstandards/standards/commit/d7c038430d197c1a9151595e0782098aaf0ec02c))
* remove unused src/index.ts ([a506999](https://github.com/getstandards/standards/commit/a5069990bd448d5d0a432d8b328ce7c2bb5aca63))
* shrink logo in README ([6102720](https://github.com/getstandards/standards/commit/6102720a7a3548c355bdf7f35cb5cadee62d3221))
* update AGENTS and TERMINOLOGY ([761c8e1](https://github.com/getstandards/standards/commit/761c8e174ac4bbe20f161a935cbc4602b49015ae))
* update LICENSE ([466af9a](https://github.com/getstandards/standards/commit/466af9a7ab34e3de8240f66cacbf4ed0c872e3e8))
* update README.md ([6f29724](https://github.com/getstandards/standards/commit/6f297245d4cf7869b3e076967e908b277604f07a))

## Changelog
