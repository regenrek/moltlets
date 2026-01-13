#!/usr/bin/env node
import process from "node:process";
import { main } from "../../../scripts/agent-bootstrap-server.mjs";

main(process.argv.slice(2));
