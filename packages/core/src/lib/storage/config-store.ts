export interface ConfigStoreStat {
  isDirectory: boolean;
}

export interface ConfigStoreDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export type MaybePromise<T> = T | Promise<T>;

export interface ConfigStore {
  readText(path: string): MaybePromise<string>;
  exists(path: string): MaybePromise<boolean>;
  writeTextAtomic(path: string, text: string): Promise<void>;
  stat(path: string): MaybePromise<ConfigStoreStat | null>;
  readDir?(path: string): MaybePromise<ConfigStoreDirEntry[]>;
}
