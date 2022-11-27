# Simple TCP Port Forwarding Server

## Documentation

[https://gibme-npm.github.io/port-forwarder/](https://gibme-npm.github.io/port-forwarder/)

## Sample Code

### Static Forwarding

```typescript
import PortForwarder from '@gibme/port-forwarder';

(async () => {
    const server = new PortForwarder({ 
        port: 12345,
        remote: {
            ip: 'remotehost',
            port: 22
        }
    });
    
    await server.start();
})()
```

### Dynamic Forwarding

```typescript
import PortForwarder from '@gibme/port-forwarder';

(async () => {
    const server = new PortForwarder({ port: 12345 });
    
    server.on('connection', async (socket) => {
        if (await server.forward(socket, 'remotehost', 22)) {
            console.log('ok');
        } else {
            console.log('failed');
        }
    });
    
    await server.start();
})()
```
