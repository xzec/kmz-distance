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
  kmlEntry: string
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
const DEFAULT_KML = 'doc.kml'
const DEFAULT_REFERENCE: ReferencePoint = {
  latitude: 48.13978407641908,
  longitude: 17.104469028329717,
}

void main()

async function main(): Promise<void> {
  const config = resolveConfig(process.argv.slice(2))

  try {
    const kmz = new AdmZip(config.kmzPath)

    const kmlEntry = findKmlEntry(kmz, config.kmlEntry)
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

    let furthest: FurthestCoordinate | null = null

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
        console.log(
          `   lat ${coordinate.latitude.toFixed(5)}, lon ${coordinate.longitude.toFixed(5)}${altitude}`,
        )
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

function resolveConfig(argv: string[]): Config {
  const envReference =
    parseReference(process.env.REF ?? process.env.REFERENCE ?? process.env.KMZ_REFERENCE) ?? null

  const config: Config = {
    kmzPath: process.env.KMZ_PATH ?? DEFAULT_KMZ,
    kmlEntry: process.env.KML_ENTRY ?? DEFAULT_KML,
    reference: envReference ?? DEFAULT_REFERENCE,
  }

  let referenceProvided = envReference !== null
  let expectRefValue = false

  argv.forEach((arg, index) => {
    if (expectRefValue) {
      const reference = parseReference(arg)
      if (!reference) {
        throw new Error(`Invalid --ref value at argument ${index + 3}`)
      }
      config.reference = reference
      referenceProvided = true
      expectRefValue = false
      return
    }

    if (arg.startsWith('--ref=')) {
      const reference = parseReference(arg.slice('--ref='.length))
      if (!reference) {
        throw new Error('Invalid --ref value, expected "lat,lon"')
      }
      config.reference = reference
      referenceProvided = true
      return
    }

    if (arg === '--ref') {
      expectRefValue = true
      return
    }

    if (arg.startsWith('--kmz=')) {
      config.kmzPath = arg.slice('--kmz='.length)
      return
    }

    if (arg.startsWith('--kml=')) {
      config.kmlEntry = arg.slice('--kml='.length)
      return
    }

    if (!arg.startsWith('--')) {
      if (config.kmzPath === DEFAULT_KMZ && !process.env.KMZ_PATH) {
        config.kmzPath = arg
        return
      }

      if (!referenceProvided) {
        const reference = parseReference(arg)
        if (!reference) {
          throw new Error(`Unexpected argument: ${arg}`)
        }
        config.reference = reference
        referenceProvided = true
        return
      }

      throw new Error(`Unexpected argument: ${arg}`)
    }

    throw new Error(`Unknown option: ${arg}`)
  })

  if (expectRefValue) {
    throw new Error('Missing value for --ref option')
  }

  return config
}

function findKmlEntry(kmz: AdmZip, preferredEntryName: string): IZipEntry | null {
  const direct = kmz.getEntry(preferredEntryName)
  if (direct) return direct

  return (
    kmz
      .getEntries()
      .find((entry: IZipEntry) => entry.entryName.toLowerCase().endsWith('.kml')) ?? null
  )
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
          lineStrings.length > 1
            ? `${breadcrumb.join(' / ')} (segment ${lineIndex + 1})`
            : breadcrumb.join(' / ')

        segments.push({ name: label || 'Unnamed route', coordinates })
      })
    }

    const folders = toArray<KmlNode>(container.Folder as KmlNode | KmlNode[] | undefined)
    folders.forEach((folder) => traverseContainer(folder, scopedAncestors))
  }
}

function collectLineStrings(node: KmlNode | undefined): KmlNode[] {
  if (!node) return []

  const direct = toArray<KmlNode>(node.LineString as KmlNode | KmlNode[] | undefined)
  const nested = toArray<KmlNode>(node.MultiGeometry as KmlNode | KmlNode[] | undefined).flatMap(
    (child) => collectLineStrings(child),
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
