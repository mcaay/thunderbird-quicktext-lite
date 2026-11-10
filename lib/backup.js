// Backup file format. Pure module.

export const BACKUP_FORMAT = "quicktext-lite";

export function createBackup(library) {
  return JSON.stringify({ format: BACKUP_FORMAT, version: library.version, items: library.items }, null, 2);
}

export function backupFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `quicktext-lite-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
