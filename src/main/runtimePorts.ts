import net from 'net'

function stripArgs(args: string[], names: string[]): string[] {
  const nextArgs: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]
    if (names.includes(current)) {
      index += 1
      continue
    }

    nextArgs.push(current)
  }

  return nextArgs
}

export function getPublicBindHost(args: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--host' && typeof args[index + 1] === 'string' && args[index + 1].trim()) {
      return args[index + 1].trim()
    }
  }

  return '127.0.0.1'
}

export function prepareUpstreamArgs(args: string[], upstreamPort: number): string[] {
  const withoutPort = stripArgs(args, ['--port', '-p'])
  const withoutHost = stripArgs(withoutPort, ['--host'])

  return [...withoutHost, '--host', '127.0.0.1', '--port', String(upstreamPort)]
}

export function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        if (!port) {
          reject(new Error('Failed to allocate a loopback port.'))
          return
        }

        resolve(port)
      })
    })
  })
}