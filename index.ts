import {
  buildApplication,
  buildCommand,
  type CommandContext,
  run,
  type StricliDynamicCommandContext,
} from '@stricli/core'
import AdmZip, { type IZipEntry } from 'adm-zip'
import { parseStringPromise } from 'xml2js'

type ReferencePoint = {
  latitude: number
  longitude: number
}

type Coordinate = ReferencePoint & {
  altitude: number | null
}

type RouteSegment = {
  name: string
  coordinates: Coordinate[]
}

type Config = {
  kmzPath: string
  reference: ReferencePoint
}

type KmlNode = Record<string, unknown>

type FurthestCoordinate = {
  distanceKm: number
  coordinate: Coordinate
  segment: RouteSegment
  index: number
}

const DEFAULT_KMZ = 'new_zealand.kmz'
const DEFAULT_KML = 'doc.xml'
const DEFAULT_REFERENCE: ReferencePoint = {
  latitude: 48.13978407641908,
  longitude: 17.104469028329717,
}
type CliFlags = {
  kmz?: string
  ref?: string
}

type CliArguments = [string | undefined, string | undefined]

type CliInputs = {
  flags: CliFlags
  positionals: CliArguments
}

const cliCommand = buildCommand<CliFlags, CliArguments, CommandContext>({
  func: async function kmzDistanceCommand(flags, kmzArg, referenceArg) {
    const positionals: CliArguments = [kmzArg, referenceArg]
    const config = resolveConfig({ flags, positionals }, process.env)
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
    },
    aliases: {
      k: 'kmz',
      r: 'ref',
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
    brief: 'Inspect a KMZ archive and list route coordinates.',
  },
})

const application = buildApplication(cliCommand, {
  name: 'kmz-distance',
})

void main()

async function main(): Promise<void> {
  const context: StricliDynamicCommandContext<CommandContext> = {
    process,
  }
  await run(application, process.argv.slice(2), context)
}

async function runKmzAnalysis(config: Config): Promise<void> {
  try {
    const kmz = new AdmZip(config.kmzPath)

    const kmlEntry = findKmlEntry(kmz)
    if (!kmlEntry) {
      throw new Error(`No KML document found inside ${config.kmzPath}`)
    }

    const kmlText = kmlEntry.getData().toString('utf8')
    const kml = (await parseStringPromise(kmlText, { trim: true })) as unknown

    const segments = collectRouteSegments(kml)
    if (segments.length === 0) {
      console.log(`No LineString routes found in ${kmlEntry.entryName}`)
      return
    }

    console.log(
      `Reference point → lat ${config.reference.latitude.toFixed(6)}, lon ${config.reference.longitude.toFixed(6)}`,
    )

    let furthest: FurthestCoordinate | undefined

    segments.forEach((segment, segmentIndex) => {
      console.log(`${segmentIndex + 1}. ${segment.name} — ${segment.coordinates.length} points`)

      segment.coordinates.forEach((coordinate, coordinateIndex) => {
        const distanceKm = haversineDistanceKm(config.reference, coordinate)

        if (!furthest || distanceKm > furthest.distanceKm) {
          furthest = {
            distanceKm,
            coordinate,
            segment,
            index: coordinateIndex,
          }
        }

        const altitude = coordinate.altitude != null ? `, alt ${coordinate.altitude.toFixed(2)}` : ''
        console.log(`   lat ${coordinate.latitude.toFixed(5)}, lon ${coordinate.longitude.toFixed(5)}${altitude}`)
      })

      console.log('')
    })

    if (furthest) {
      const coordinate = furthest.coordinate
      console.log('Furthest coordinate from reference:')
      console.log(` - Segment: ${furthest.segment.name} (point #${furthest.index + 1})`)
      console.log(` - Location: lat ${coordinate.latitude.toFixed(6)}, lon ${coordinate.longitude.toFixed(6)}`)
      if (coordinate.altitude != null) {
        console.log(` - Altitude: ${coordinate.altitude.toFixed(2)} m`)
      }
      console.log(` - Distance: ${furthest.distanceKm.toFixed(2)} km`)
    }
  } catch (unknownError) {
    const message = unknownError instanceof Error ? unknownError.message : String(unknownError)
    console.error(`Failed to read route: ${message}`)
    process.exitCode = 1
  }
}

function resolveConfig(cli: CliInputs, env: NodeJS.ProcessEnv): Config {
  const envReference = parseReference(env.REF ?? env.REFERENCE ?? env.KMZ_REFERENCE) ?? null

  const config: Config = {
    kmzPath: env.KMZ_PATH ?? DEFAULT_KMZ,
    reference: envReference ?? DEFAULT_REFERENCE,
  }

  let referenceProvided = envReference !== null

  if (cli.flags.kmz) {
    config.kmzPath = cli.flags.kmz
  }

  if (cli.flags.ref) {
    const reference = parseReference(cli.flags.ref)
    if (!reference) {
      throw new Error('Invalid --ref value, expected "lat,lon"')
    }
    config.reference = reference
    referenceProvided = true
  }

  const [firstArg, secondArg] = cli.positionals

  if (firstArg) {
    if (!cli.flags.kmz && !env.KMZ_PATH && config.kmzPath === DEFAULT_KMZ) {
      config.kmzPath = firstArg
    } else if (!referenceProvided) {
      const reference = parseReference(firstArg)
      if (!reference) {
        throw new Error(`Unexpected argument: ${firstArg}`)
      }
      config.reference = reference
      referenceProvided = true
    } else {
      throw new Error(`Unexpected argument: ${firstArg}`)
    }
  }

  if (secondArg) {
    if (!referenceProvided) {
      const reference = parseReference(secondArg)
      if (!reference) {
        throw new Error(`Unexpected argument: ${secondArg}`)
      }
      config.reference = reference
      referenceProvided = true
    } else {
      throw new Error(`Unexpected argument: ${secondArg}`)
    }
  }

  return config
}

function findKmlEntry(kmz: AdmZip): IZipEntry | null {
  const direct = kmz.getEntry(DEFAULT_KML)
  if (direct) return direct

  const entries = kmz.getEntries()
  const lowerCaseMatch = entries.find((entry: IZipEntry) => entry.entryName.toLowerCase().endsWith('.xml'))
  if (lowerCaseMatch) return lowerCaseMatch

  return entries.find((entry: IZipEntry) => entry.entryName.toLowerCase().endsWith('.kml')) ?? null
}

function collectRouteSegments(kml: unknown): RouteSegment[] {
  if (!isRecord(kml)) return []
  const root = kml.kml
  if (!isRecord(root)) return []

  const documents = toArray<KmlNode>(root.Document as KmlNode | KmlNode[] | undefined)
  const segments: RouteSegment[] = []

  for (const document of documents) {
    traverseContainer(document, [])
  }

  return segments

  function traverseContainer(container: KmlNode, ancestors: string[]): void {
    const scopedAncestors = appendName(ancestors, container)

    const placemarks = toArray<KmlNode>(container.Placemark as KmlNode | KmlNode[] | undefined)
    for (const placemark of placemarks) {
      const breadcrumb = appendName(scopedAncestors, placemark)
      const lineStrings = collectLineStrings(placemark)

      lineStrings.forEach((lineString, lineIndex) => {
        const coordinates = parseCoordinates(lineString.coordinates)
        if (coordinates.length === 0) return

        const label =
          lineStrings.length > 1 ? `${breadcrumb.join(' / ')} (segment ${lineIndex + 1})` : breadcrumb.join(' / ')

        segments.push({ name: label || 'Unnamed route', coordinates })
      })
    }

    const folders = toArray<KmlNode>(container.Folder as KmlNode | KmlNode[] | undefined)
    folders.forEach((folder) => {
      traverseContainer(folder, scopedAncestors)
    })
  }
}

function collectLineStrings(node: KmlNode | undefined): KmlNode[] {
  if (!node) return []

  const direct = toArray<KmlNode>(node.LineString as KmlNode | KmlNode[] | undefined)
  const nested = toArray<KmlNode>(node.MultiGeometry as KmlNode | KmlNode[] | undefined).flatMap((child) =>
    collectLineStrings(child),
  )

  return [...direct, ...nested]
}

function parseCoordinates(raw: unknown): Coordinate[] {
  const text = asString(raw)
  if (!text) return []

  const coordinates: Coordinate[] = []
  const tokens = text.split(/\s+/)

  for (const token of tokens) {
    const trimmed = token.trim()
    if (trimmed.length === 0) continue

    const [longitudePart, latitudePart, altitudePart] = trimmed.split(',')
    if (longitudePart === undefined || latitudePart === undefined) continue

    const longitude = Number.parseFloat(longitudePart)
    const latitude = Number.parseFloat(latitudePart)
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue

    const altitudeNumber = altitudePart ? Number.parseFloat(altitudePart) : Number.NaN
    const altitude = Number.isFinite(altitudeNumber) ? altitudeNumber : null

    coordinates.push({ latitude, longitude, altitude })
  }

  return coordinates
}

function parseReference(value: string | undefined | null): ReferencePoint | null {
  if (!value) return null

  const [latPart, lonPart] = value.split(',').map((part) => part.trim())

  if (latPart === undefined || lonPart === undefined) {
    return null
  }

  const latitude = Number.parseFloat(latPart)
  const longitude = Number.parseFloat(lonPart)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }

  return { latitude, longitude }
}

function haversineDistanceKm(pointA: ReferencePoint, pointB: ReferencePoint): number {
  const radiusKm = 6371.0088

  const lat1 = degreesToRadians(pointA.latitude)
  const lon1 = degreesToRadians(pointA.longitude)
  const lat2 = degreesToRadians(pointB.latitude)
  const lon2 = degreesToRadians(pointB.longitude)

  const deltaLat = lat2 - lat1
  const deltaLon = lon2 - lon1

  const sinLat = Math.sin(deltaLat / 2)
  const sinLon = Math.sin(deltaLon / 2)

  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return radiusKm * c
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}

function appendName(parts: string[], candidate: KmlNode | undefined): string[] {
  const nameValue = candidate ? asString(candidate.name) : null
  if (nameValue) {
    return [...parts, nameValue]
  }

  return [...parts]
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value

  if (Array.isArray(value) && value.length > 0) {
    const first = value[0]
    if (typeof first === 'string') return first
    if (isRecord(first) && typeof first._ === 'string') return first._
  }

  if (isRecord(value) && typeof value._ === 'string') {
    return value._
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
