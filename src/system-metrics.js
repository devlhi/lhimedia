import fs from 'node:fs';
import os from 'node:os';

function rounded(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function bytesToMegabytes(value) {
  return rounded(Number(value || 0) / 1024 / 1024);
}

function readText(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function linuxMemory() {
  const values = new Map();
  for (const line of readText('/proc/meminfo').split('\n')) {
    const match = /^(MemTotal|MemAvailable):\s+(\d+)\s+kB$/.exec(line);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  if (values.has('MemTotal') && values.has('MemAvailable')) {
    return { total: values.get('MemTotal'), free: values.get('MemAvailable') };
  }
  return null;
}

function diskUsage(targetPath) {
  if (typeof fs.statfsSync !== 'function') return null;
  try {
    const stat = fs.statfsSync(targetPath);
    const blockSize = Number(stat.bsize || stat.frsize || 0);
    const total = Number(stat.blocks || 0) * blockSize;
    const available = Number(stat.bavail || 0) * blockSize;
    if (!Number.isFinite(total) || total <= 0) return null;
    return { total, used: Math.max(0, total - available), free: available };
  } catch { return null; }
}

function percent(used, total) {
  return total > 0 ? rounded((used / total) * 100) : 0;
}

export function getSystemMetrics({ diskPath = process.cwd() } = {}) {
  const memory = linuxMemory() || { total: os.totalmem(), free: os.freemem() };
  const memoryUsed = Math.max(0, memory.total - memory.free);
  const disk = diskUsage(diskPath);
  const processMemory = process.memoryUsage();

  return {
    platform: process.platform,
    host: {
      cpuCount: os.cpus().length,
      loadAverage: os.loadavg().map((value) => rounded(value, 2)),
      uptimeSeconds: Math.floor(os.uptime()),
      memory: {
        totalMb: bytesToMegabytes(memory.total),
        usedMb: bytesToMegabytes(memoryUsed),
        freeMb: bytesToMegabytes(memory.free),
        usedPercent: percent(memoryUsed, memory.total),
      },
      disk: disk && {
        totalGb: rounded(disk.total / 1024 / 1024 / 1024),
        usedGb: rounded(disk.used / 1024 / 1024 / 1024),
        freeGb: rounded(disk.free / 1024 / 1024 / 1024),
        usedPercent: percent(disk.used, disk.total),
      },
    },
    application: {
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      rssMb: bytesToMegabytes(processMemory.rss),
      heapUsedMb: bytesToMegabytes(processMemory.heapUsed),
      heapTotalMb: bytesToMegabytes(processMemory.heapTotal),
    },
  };
}
