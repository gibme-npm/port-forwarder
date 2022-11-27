// Copyright (c) 2016-2022, Brandon Lehmann <brandonlehmann@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { EventEmitter } from 'events';
import TCPServer, { createServer } from '@gibme/tcp-server';
import { createConnection, Socket, isIP } from 'net';
import LazyStorage from '@gibme/lazy-storage';
import { networkInterfaces as osNetworkInterfaces } from 'os';

export interface IP {
    ip: string;
}

export interface Port {
    port: number;
}

export interface EndPoint extends Port, IP {}

export interface IForwardSession extends EndPoint {
    forward: EndPoint;
}

export interface OptionalPortForwarderOptions extends IP {
    timeout: number;
    keepalive: boolean;
    remote: EndPoint;
}

export interface PortForwarderOptions extends Port, Partial<OptionalPortForwarderOptions> {}

export interface PortForwarderOptionsFinal extends Port, OptionalPortForwarderOptions {}

/** @ignore */
const networkInterfaces = (): string[] => {
    const interfaces = osNetworkInterfaces();

    const addresses: string[] = ['0.0.0.0'];

    Object.keys(interfaces)
        .forEach(iface => {
            interfaces[iface]?.forEach(address =>
                addresses.push(address.address));
        });

    return addresses.sort();
};

/**
 * Simple TCP port forwarding service with tracking
 */
export default class PortForwarder extends EventEmitter {
    public readonly options: PortForwarderOptionsFinal;
    public readonly server: TCPServer;
    public readonly interfaces: string[] = networkInterfaces();
    public readonly sessions: LazyStorage;

    /**
     * Creates a new instance of the port forwarding service
     *
     * @param options
     */
    constructor (options: PortForwarderOptions) {
        super();

        options.ip ||= '0.0.0.0';
        options.timeout ||= 15 * 60_000;
        options.keepalive ??= false;

        if (isIP(options.ip) === 0) {
            throw new Error(`${options.ip} is not a valid IP address`);
        }

        if (!this.interfaces.includes(options.ip)) {
            throw new Error(`${options.ip} is not a locally bound IP address`);
        }

        this.options = options as any;

        this.sessions = new LazyStorage({ stdTTL: 0 });

        this.server = createServer({
            pauseOnConnect: true,
            keepAlive: options.keepalive
        });

        this.server.on('listening', () => this.emit('listening', options.ip, options.port));
        this.server.on('close', () => this.emit('close'));
        this.server.on('error', error => this.emit('error', error));
        this.server.on('connection', async (socket: Socket) => {
            this.emit('connection', socket, this.options.port);

            if (this.options.remote) {
                await this.forward(socket, this.options.remote.ip, this.options.remote.port);
            }
        });
        this.sessions.on('error', error => this.emit('error', error));
    }

    public on (event: 'error', listener: (error: Error, ...args: any[]) => void): this;

    public on (event: 'listening', listener: (ip: string, port: number) => void): this;

    public on (event: 'close', listener: () => void): this;

    public on (event: 'connection', listener: (socket: Socket, port: number) => void): this;

    public on (event: 'forward', listener: (
        remoteAddress: string, remotePort: number, forwardAddress: string, forwardPort: number) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    /**
     * Returns our listening port
     */
    public get port (): number {
        return this.options.port;
    }

    /**
     * Returns our listening interface
     */
    public get ip (): string {
        return this.options.ip;
    }

    /**
     * Returns out timeout
     */
    public get timeout (): number {
        return this.options.timeout;
    }

    /**
     * Creates a connection to the specified IP and port and then pipes it
     * back and forth to the specified socket
     *
     * @param socket
     * @param ip
     * @param port
     * @param timeout
     * @param keepAlive
     */
    public async forward (
        socket: Socket,
        ip: string,
        port: number,
        timeout = this.timeout,
        keepAlive = this.options.keepalive
    ): Promise<boolean> {
        const hangup = async (conn: Socket): Promise<void> => {
            this.sessions.del({ ip: socket.remoteAddress, port: socket.remotePort });

            await this.hangup(conn);
        };

        socket.setTimeout(timeout);
        socket.setKeepAlive(keepAlive);

        return new Promise((resolve, reject) => {
            if (!socket.remoteAddress || !socket.remotePort || !socket.isPaused()) {
                return resolve(false);
            }

            const connection = createConnection({
                host: ip,
                port,
                keepAlive,
                timeout
            }, () => {
                if (!socket.remoteAddress || !socket.remotePort) {
                    return resolve(false);
                }

                connection.removeAllListeners('error');

                connection.on('error', async (error: Error) => {
                    await hangup(socket);

                    this.emit('error', error, ip, port);
                });

                connection.pipe(socket);

                socket.pipe(connection);

                socket.resume();

                const client: IForwardSession = {
                    ip: socket.remoteAddress,
                    port: socket.remotePort,
                    forward: {
                        ip,
                        port
                    }
                };

                this.sessions.set({ ip: socket.remoteAddress, port: socket.remotePort }, client);

                this.emit('forward', socket.remoteAddress, socket.remotePort, ip, port);

                return resolve(true);
            });

            // outgoing socket
            connection.once('error', error => {
                return reject(error);
            });
            connection.on('close', () => hangup(socket));
            connection.on('end', () => hangup(socket));
            connection.on('timeout', () => hangup(socket));

            // incoming socket
            socket.on('error', async (error: Error) => {
                await hangup(connection);

                this.emit('error', error, socket.remoteAddress, socket.remotePort);
            });
            socket.on('close', () => hangup(connection));
            socket.on('end', () => hangup(connection));
            socket.on('timeout', () => hangup(connection));
        });
    }

    /**
     * Returns the current connections to the server
     */
    public async getConnections (): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server.getConnections((error, count) => {
                if (error) {
                    return reject(error);
                }

                return resolve(count);
            });
        });
    }

    /**
     * Hangs up the specified socket
     *
     * @param socket
     * @private
     */
    private async hangup (socket: Socket): Promise<void> {
        return new Promise(resolve => {
            socket.end(() => {
                return resolve();
            });
        });
    }

    /**
     * Returns the list of current sessions
     */
    public list (): IForwardSession[] {
        const values = this.sessions.list<IForwardSession>()
            .values();

        const sessions: IForwardSession[] = [];

        for (const session of values) {
            sessions.push(session);
        }

        return sessions;
    }

    /**
     * Starts the server
     */
    public async start (): Promise<void> {
        return this.server.start(this.port, this.ip);
    }

    /**
     * Stops the server
     */
    public async stop (): Promise<void> {
        return this.server.stop();
    }
}

export { PortForwarder };
