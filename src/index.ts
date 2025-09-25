import { type CommandContext, run, type StricliDynamicCommandContext } from '@stricli/core'

import { application } from './cli.ts'

const context: StricliDynamicCommandContext<CommandContext> = {
  process,
}

await run(application, process.argv.slice(2), context)
