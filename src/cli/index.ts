#!/usr/bin/env node

import { runCli } from "./cli-runner.js";

process.exitCode = await runCli();
