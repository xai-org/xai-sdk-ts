#!/usr/bin/env node

import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(fileURLToPath(new URL("..", import.meta.url)));
await rm(path.join(ROOT, "dist"), { recursive: true, force: true });
