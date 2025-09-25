import { buildApplication, buildCommand, type CommandContext } from '@stricli/core'
import { resolveConfig, runKmzAnalysis } from './kmzAnalysis.ts'
import type { CliArguments, CliFlags, CliInputs, Config } from './types.ts'

const cliCommand = buildCommand<CliFlags, CliArguments, CommandContext>({
  func: async function kmzDistanceCommand(flags, kmzArg, referenceArg) {
    const positionals: CliArguments = [kmzArg, referenceArg]
    const inputs: CliInputs = { flags, positionals }
    const config: Config = resolveConfig(inputs, process.env)
    await runKmzAnalysis(config)
  },
  parameters: {
    flags: {
      kmz: {
        kind: 'parsed',
        brief: 'Path to the KMZ archive to analyze.',
        optional: true,
        placeholder: 'path',
        parse: (value) => value,
      },
      ref: {
        kind: 'parsed',
        brief: 'Reference point in "lat,lon" format.',
        optional: true,
        placeholder: 'lat,lon',
        parse: (value) => value,
      },
      verbose: {
        kind: 'boolean',
        brief: 'Print per-segment and per-point details.',
        optional: true,
      },
    },
    aliases: {
      k: 'kmz',
      r: 'ref',
      v: 'verbose',
    },
    positional: {
      kind: 'tuple',
      parameters: [
        {
          brief: 'KMZ archive path.',
          placeholder: 'kmz',
          optional: true,
          parse: (value) => value,
        },
        {
          brief: 'Reference point as "lat,lon".',
          placeholder: 'lat,lon',
          optional: true,
          parse: (value) => value,
        },
      ],
    },
  },
  docs: {
    brief: 'Calculate furthest distance between KMZ route and reference point.',
  },
})

export const application = buildApplication(cliCommand, {
  name: 'kmz-distance',
})
