#!/usr/bin/env python3
"""Allocate a PTY and run the given command. Used by the dashboard exec socket."""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

def set_size(fd, rows, cols):
    rows = max(1, min(int(rows), 500))
    cols = max(1, min(int(cols), 500))
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def main():
    if len(sys.argv) < 2:
        sys.exit(2)
    stop = {"value": False}

    def handle_term(_signum, _frame):
        stop["value"] = True

    signal.signal(signal.SIGTERM, handle_term)
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.execvp(sys.argv[1], sys.argv[1:])
    set_size(fd, 24, 80)
    stdin = sys.stdin.buffer.fileno()
    stdout = sys.stdout.buffer
    resize_fd = 3
    pending = b""
    try:
        while not stop["value"]:
            watch = [fd, stdin]
            if resize_fd >= 0:
                watch.append(resize_fd)
            try:
                readable, _, _ = select.select(watch, [], [])
            except InterruptedError:
                continue
            if fd in readable:
                try:
                    data = os.read(fd, 65536)
                except OSError as err:
                    if err.errno == errno.EIO:
                        break
                    raise
                if not data:
                    break
                stdout.write(data)
                stdout.flush()
            if stdin in readable:
                data = os.read(stdin, 65536)
                if not data:
                    break
                os.write(fd, data)
            if resize_fd in readable:
                chunk = os.read(resize_fd, 256)
                if not chunk:
                    resize_fd = -1
                    continue
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    parts = line.split()
                    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                        set_size(fd, int(parts[1]), int(parts[0]))
    finally:
        try:
            os.kill(pid, 15)
        except OSError:
            pass
        os.waitpid(pid, 0)


if __name__ == "__main__":
    main()
