import { homedir } from 'node:os'
import { isAbsolute, resolve as resolvePath } from 'node:path'

export function resolveKmzPath(pathLike: string): string {
  if (pathLike === '~') {
    return homedir()
  }

  if (pathLike.startsWith('~/')) {
    return resolvePath(homedir(), pathLike.slice(2))
  }

  if (isAbsolute(pathLike)) {
    return pathLike
  }

  return resolvePath(process.cwd(), pathLike)
}
