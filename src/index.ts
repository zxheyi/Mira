#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("mira")
  .description("Local project memory for coding agents")
  .version("0.1.0");

program
  .command("health")
  .description("Check that Mira is installed")
  .action(() => {
    console.log("mira:ok");
  });

program.parse();
