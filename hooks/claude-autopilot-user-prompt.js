#!/usr/bin/env node

import { buildUserPromptPayload, printHookPayload, readHookInput } from "./claude-autopilot-hook-utils.js";

const input = await readHookInput();
const payload = await buildUserPromptPayload(input);
printHookPayload(payload);
