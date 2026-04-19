#!/usr/bin/env node

import { buildStopPayload, printHookPayload, readHookInput } from "./claude-autopilot-hook-utils.js";

const input = await readHookInput();
const payload = await buildStopPayload(input);
printHookPayload(payload);
