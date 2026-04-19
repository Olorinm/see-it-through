#!/usr/bin/env node

import { buildSessionStartPayload, printHookPayload, readHookInput } from "./claude-autopilot-hook-utils.js";

const input = await readHookInput();
const payload = await buildSessionStartPayload(input);
printHookPayload(payload);
