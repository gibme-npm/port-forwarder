# Simple TCP Port Forwarding Server

A lightweight TCP port forwarding service for Node.js with session tracking, keepalive support, and both static and dynamic forwarding modes.

## Requirements

- Node.js >= 22

## Installation

```bash
npm install @gibme/port-forwarder
```

or

```bash
yarn add @gibme/port-forwarder
```

## Documentation

[https://gibme-npm.github.io/port-forwarder/](https://gibme-npm.github.io/port-forwarder/)

## Usage

### Static Forwarding

Forward all incoming connections on a local port to a fixed remote host and port.

```typescript
import PortForwarder from '@gibme/port-forwarder';

const server = new PortForwarder({
    port: 12345,
    remote: {
        ip: 'remotehost',
        port: 22
    }
});

await server.start();
```

### Dynamic Forwarding

Handle each incoming connection individually and decide where to forward it at runtime.

```typescript
import PortForwarder from '@gibme/port-forwarder';

const server = new PortForwarder({ port: 12345 });

server.on('connection', async (socket) => {
    if (await server.forward(socket, 'remotehost', 22)) {
        console.log('Forwarding established');
    } else {
        console.log('Forwarding failed');
    }
});

await server.start();
```

### Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | *required* | Local port to listen on |
| `ip` | `string` | `'0.0.0.0'` | Local interface to bind to |
| `timeout` | `number` | `900000` (15 min) | Socket timeout in milliseconds |
| `keepalive` | `boolean` | `false` | Enable TCP keepalive on connections |
| `remote` | `{ ip: string, port: number }` | `undefined` | Remote endpoint for static forwarding |

### Events

| Event | Parameters | Description |
|---|---|---|
| `listening` | `(ip: string, port: number)` | Emitted when the server starts listening |
| `close` | | Emitted when the server closes |
| `connection` | `(socket: Socket, port: number)` | Emitted on each incoming connection |
| `forward` | `(remoteAddress, remotePort, forwardAddress, forwardPort)` | Emitted when a connection is forwarded |
| `error` | `(error: Error, ...args: any[])` | Emitted on error |

### Session Tracking

Active forwarding sessions can be listed at any time:

```typescript
const sessions = await server.list();

for (const session of sessions) {
    console.log(`${session.ip}:${session.port} -> ${session.forward.ip}:${session.forward.port}`);
}
```

### Stopping the Server

```typescript
await server.stop();
```

## License

MIT
