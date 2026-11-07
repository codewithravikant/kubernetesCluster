/**
 * Local host vitals for the Host tab (machine running the dashboard).
 * Reads the machine where the dashboard Express process runs.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function bytesToHuman(n) {
  const v = Number(n) || 0;
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)} TB`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} MB`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} KB`;
  return `${v} B`;
}

function readLinuxMeminfo() {
  try {
    const raw = fs.readFileSync("/proc/meminfo", "utf8");
    const map = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^(\w+):\s+(\d+)/);
      if (m) map[m[1]] = Number(m[2]) * 1024; // kB → bytes
    }
    const total = map.MemTotal || 0;
    const available =
      map.MemAvailable ||
      (map.MemFree || 0) + (map.Buffers || 0) + (map.Cached || 0);
    const free = map.MemFree || 0;
    const used = Math.max(0, total - available);
    return {
      totalBytes: total,
      availableBytes: available,
      freeBytes: free,
      usedBytes: used,
      usedPercent: total > 0 ? (used / total) * 100 : 0,
      availablePercent: total > 0 ? (available / total) * 100 : 0,
    };
  } catch {
    return null;
  }
}

function fallbackMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = Math.max(0, total - free);
  return {
    totalBytes: total,
    availableBytes: free,
    freeBytes: free,
    usedBytes: used,
    usedPercent: total > 0 ? (used / total) * 100 : 0,
    availablePercent: total > 0 ? (free / total) * 100 : 0,
  };
}

function pushDisk(disks, seen, { source, fstype, sizeB, usedB, availB, target }) {
  if (!target || seen.has(target)) return;
  if (fstype && /^(tmpfs|devtmpfs|squashfs|overlay|devfs|autofs)$/i.test(fstype)) {
    return;
  }
  seen.add(target);
  const usedPercent =
    sizeB > 0 ? Math.round(((sizeB - availB) / sizeB) * 1000) / 10 : 0;
  disks.push({
    mount: target,
    filesystem: source || "",
    fstype: fstype || "",
    sizeBytes: sizeB,
    usedBytes: usedB,
    availableBytes: availB,
    usedPercent,
    sizeHuman: bytesToHuman(sizeB),
    usedHuman: bytesToHuman(usedB),
    availableHuman: bytesToHuman(availB),
  });
}

async function readDiskMounts() {
  const seen = new Set();
  const disks = [];

  try {
    if (process.platform === "linux") {
      const { stdout } = await execFileAsync(
        "df",
        [
          "-B1",
          "--output=source,fstype,size,used,avail,pcent,target",
          "/",
          "/home",
          "/var",
        ],
        { timeout: 5000 }
      );
      for (const line of stdout.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 7) continue;
        const [source, fstype, size, used, avail, , ...rest] = parts;
        pushDisk(disks, seen, {
          source,
          fstype,
          sizeB: Number(size) || 0,
          usedB: Number(used) || 0,
          availB: Number(avail) || 0,
          target: rest.join(" ") || "/",
        });
      }
    } else {
      // macOS / BSD: POSIX df -k (1K blocks)
      const { stdout } = await execFileAsync("df", ["-k", "/"], {
        timeout: 5000,
      });
      for (const line of stdout.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const source = parts[0];
        const sizeK = Number(parts[1]) || 0;
        const usedK = Number(parts[2]) || 0;
        const availK = Number(parts[3]) || 0;
        const target = parts[parts.length - 1];
        pushDisk(disks, seen, {
          source,
          fstype: "",
          sizeB: sizeK * 1024,
          usedB: usedK * 1024,
          availB: availK * 1024,
          target,
        });
      }
    }
  } catch {
    /* df unavailable — leave disks empty */
  }

  return disks;
}

function readLoad() {
  try {
    const [one, five, fifteen] = os.loadavg();
    return { one, five, fifteen };
  } catch {
    return { one: 0, five: 0, fifteen: 0 };
  }
}

/**
 * Snapshot of the dashboard host (Docker / Minikube machine).
 */
export async function getHostStats() {
  const memory = readLinuxMeminfo() || fallbackMemory();
  const disks = await readDiskMounts();
  const root =
    disks.find((d) => d.mount === "/") || disks[0] || null;
  const cpus = os.cpus() || [];

  return {
    role: "host",
    label: "Dashboard host",
    description:
      "Machine where this dashboard process runs (Docker / Minikube host)",
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model?.trim() || null,
    uptimeSeconds: os.uptime(),
    load: readLoad(),
    memory: {
      ...memory,
      totalHuman: bytesToHuman(memory.totalBytes),
      availableHuman: bytesToHuman(memory.availableBytes),
      freeHuman: bytesToHuman(memory.freeBytes),
      usedHuman: bytesToHuman(memory.usedBytes),
    },
    diskRoot: root,
    disks,
    collectedAt: new Date().toISOString(),
  };
}
