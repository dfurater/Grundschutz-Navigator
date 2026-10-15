/*
 * Symlink-sicheres Lesen einer regulären Datei für die CI-Guards und die
 * Deploy-Prüfung.
 *
 * `O_NOFOLLOW` lehnt einen Symlink am Pfad ab, und Typprüfung wie Lesen laufen
 * über denselben Dateideskriptor, sodass zwischen Prüfung und Lesen keine
 * Lücke bleibt. `O_NONBLOCK` verhindert, dass eine FIFO das Öffnen blockiert,
 * bevor die Typprüfung sie ablehnen kann.
 *
 * Beide Varianten bilden Fehler gleich ab: Symlink und nicht reguläre Datei
 * werden zu `NotRegularFileError`, jeder andere Öffnungs- oder Lesefehler
 * bleibt der unveränderte Node-Fehler mit seinem `code`. Aufrufer übersetzen
 * diese Fehler bei Bedarf in ihre eigenen Fehlerklassen.
 */

import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';

const NO_FOLLOW_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

export class NotRegularFileError extends Error {
  /**
   * @param {string} path Gelesener Pfad.
   * @param {{ symlink: boolean }} details `symlink` ist wahr, wenn der Pfad ein Symlink ist.
   */
  constructor(path, { symlink }) {
    super(`${path} must be a regular file, not a symlink`);
    this.name = 'NotRegularFileError';
    this.path = path;
    this.symlink = symlink;
  }
}

function mapOpenError(error, path) {
  return error?.code === 'ELOOP' ? new NotRegularFileError(path, { symlink: true }) : error;
}

/**
 * Liest eine reguläre Datei asynchron, ohne einem Symlink zu folgen.
 *
 * @param {string} path
 * @returns {Promise<Buffer>}
 */
export async function readRegularFileNoFollow(path) {
  let handle;
  try {
    handle = await open(path, NO_FOLLOW_READ_FLAGS);
  } catch (error) {
    throw mapOpenError(error, path);
  }
  try {
    if (!(await handle.stat()).isFile()) {
      throw new NotRegularFileError(path, { symlink: false });
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Synchrone Variante von `readRegularFileNoFollow` für den Build-Schritt in
 * `vite.config.ts`.
 *
 * @param {string} path
 * @returns {Buffer}
 */
export function readRegularFileNoFollowSync(path) {
  let fd;
  try {
    fd = openSync(path, NO_FOLLOW_READ_FLAGS);
  } catch (error) {
    throw mapOpenError(error, path);
  }
  try {
    if (!fstatSync(fd).isFile()) {
      throw new NotRegularFileError(path, { symlink: false });
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
