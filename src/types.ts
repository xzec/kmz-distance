export type ReferencePoint = {
  latitude: number
  longitude: number
}

export type Coordinate = ReferencePoint & {
  altitude: number | null
}

export type RouteSegment = {
  name: string
  coordinates: Coordinate[]
}

export type Config = {
  kmzPath: string
  reference: ReferencePoint
  verbose: boolean
}

export type KmlNode = Record<string, unknown>

export type FurthestCoordinate = {
  distanceKm: number
  coordinate: Coordinate
  segment: RouteSegment
  index: number
}

export type CliFlags = {
  kmz?: string
  ref?: string
  verbose?: boolean
}

export type CliArguments = [string | undefined, string | undefined]

export type CliInputs = {
  flags: CliFlags
  positionals: CliArguments
}
