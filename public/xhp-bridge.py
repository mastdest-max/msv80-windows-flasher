#!/usr/bin/env python3
"""Open the xHP adapter's raw port for this site.

Chrome cannot open that port itself. On the computer that has joined the
adapter Wi-Fi, run:

    python3 xhp-bridge.py

Then press Connect xHP Wi-Fi. Leave this window open while you use the car.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import socket
import struct

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
LISTEN = ("127.0.0.1", 8770)


def accept_key(request: bytes) -> bytes:
    key = ""
    for line in request.decode("latin1", "replace").split("\r\n"):
        if line.lower().startswith("sec-websocket-key:"):
            key = line.split(":", 1)[1].strip()
    digest = hashlib.sha1((key + GUID).encode()).digest()
    accept = base64.b64encode(digest).decode()
    return (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
    ).encode()


def frame(data: bytes, opcode: int) -> bytes:
    length = len(data)
    if length < 126:
        head = bytes([0x80 | opcode, length])
    elif length < 65536:
        head = bytes([0x80 | opcode, 126]) + struct.pack("!H", length)
    else:
        head = bytes([0x80 | opcode, 127]) + struct.pack("!Q", length)
    return head + data


async def read_frame(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    first, second = await reader.readexactly(2)
    opcode = first & 0x0F
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if second & 0x80 else b""
    payload = await reader.readexactly(length) if length else b""
    if mask:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    return opcode, payload


async def pipe_tcp(tcp: asyncio.StreamReader, web: asyncio.StreamWriter) -> None:
    while True:
        data = await tcp.read(4096)
        if not data:
            return
        web.write(frame(data, 2))
        await web.drain()


async def pipe_web(web_reader: asyncio.StreamReader, web_writer: asyncio.StreamWriter, tcp: asyncio.StreamWriter) -> None:
    while True:
        opcode, payload = await read_frame(web_reader)
        if opcode == 0x8:
            return
        if opcode == 0x9:
            web_writer.write(frame(payload, 0xA))
            await web_writer.drain()
            continue
        if opcode in (0x1, 0x2, 0x0) and payload:
            tcp.write(payload)
            await tcp.drain()


busy = asyncio.Lock()
worked: int | None = None
closed_ports: set[int] = set()
told_wifi = False


def unreachable(err: OSError) -> bool:
    win = getattr(err, "winerror", None)
    return win in (1231, 1232) or err.errno in (51, 64, 65, 101, 113)


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, targets: list[tuple[str, int]]) -> None:
    global worked, told_wifi
    tcp_writer = None
    try:
        request = await reader.readuntil(b"\r\n\r\n")
        writer.write(accept_key(request))
        await writer.drain()
        async with busy:
            order = sorted(targets, key=lambda item: 0 if item[1] == worked else 1)
            tcp_reader = None
            for host, port in order:
                if port in closed_ports:
                    continue
                try:
                    tcp_reader, tcp_writer = await asyncio.wait_for(asyncio.open_connection(host, port), 3)
                    sock = tcp_writer.get_extra_info("socket")
                    if sock is not None:
                        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                    worked = port
                    told_wifi = False
                    print(f"Adapter open at {host}:{port}")
                    break
                except ConnectionRefusedError:
                    closed_ports.add(port)
                    print(f"Port {port} is closed on this adapter. It will not be tried again.")
                    tcp_reader = None
                    tcp_writer = None
                except OSError as err:
                    tcp_reader = None
                    tcp_writer = None
                    if unreachable(err):
                        if not told_wifi:
                            told_wifi = True
                            print("Windows left the adapter Wi-Fi because that network has no internet.")
                            print("Turn off Connect automatically on your home Wi-Fi, join the adapter again, and press Connect.")
                            print("Leave the scanner plugged in.")
                    else:
                        print(f"No adapter at {host}:{port} ({err})")
            if tcp_reader is None or tcp_writer is None:
                writer.write(frame(b"The adapter port did not answer. Join its Wi-Fi and leave this running.", 1))
                await writer.drain()
                return
            writer.write(frame(b"ok", 1))
            await writer.drain()
            done, pending = await asyncio.wait(
                {
                    asyncio.create_task(pipe_tcp(tcp_reader, writer)),
                    asyncio.create_task(pipe_web(reader, writer, tcp_writer)),
                },
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                task.cancel()
            tcp_writer.close()
            try:
                await tcp_writer.wait_closed()
            except OSError:
                pass
            tcp_writer = None
    except (asyncio.IncompleteReadError, ConnectionError, OSError):
        pass
    finally:
        if tcp_writer is not None:
            tcp_writer.close()
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="192.168.4.1")
    parser.add_argument("--ports", default="23,35000")
    args = parser.parse_args()
    targets = [(args.host, int(port)) for port in args.ports.split(",") if port]
    server = await asyncio.start_server(lambda r, w: handle(r, w, targets), LISTEN[0], LISTEN[1])
    print(f"Bridge on {LISTEN[0]}:{LISTEN[1]}. Press Connect xHP Wi-Fi in Chrome. Ctrl+C to stop.")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nBridge stopped.")
