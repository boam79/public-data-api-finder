const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  info: (msg: string, data?: unknown) => {
    if (isDev) process.stderr.write(`[INFO] ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
  },
  warn: (msg: string, data?: unknown) => {
    process.stderr.write(`[WARN] ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
  },
  error: (msg: string, data?: unknown) => {
    process.stderr.write(`[ERROR] ${msg}${data ? " " + JSON.stringify(data) : ""}\n`);
  },
};
